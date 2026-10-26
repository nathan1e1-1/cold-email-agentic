import { describe, it, expect } from 'vitest';
import {
  groupOutlookThreads,
  parseOutlookMessage,
  type GraphMessage,
} from '../../src/mail/outlookParse';

const OWN = 'me@example.com';

function message(overrides: Partial<GraphMessage> = {}): GraphMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    subject: 'Hello',
    from: { emailAddress: { name: 'Sarah', address: 'sarah@acme.com' } },
    toRecipients: [{ emailAddress: { address: OWN } }],
    receivedDateTime: '2024-01-01T10:00:00Z',
    body: { contentType: 'text', content: 'Hi there' },
    ...overrides,
  };
}

describe('parseOutlookMessage', () => {
  it('marks mail from the account owner as outbound and others as inbound', () => {
    const outbound = parseOutlookMessage(
      message({ from: { emailAddress: { address: 'ME@Example.com' } } }),
      OWN,
    );
    expect(outbound.direction).toBe('outbound');

    const inbound = parseOutlookMessage(
      message({ from: { emailAddress: { address: 'sarah@acme.com' } } }),
      OWN,
    );
    expect(inbound.direction).toBe('inbound');
  });

  it('maps addresses and omits empty names', () => {
    const parsed = parseOutlookMessage(
      message({
        from: { emailAddress: { name: '  ', address: 'sender@x.com' } },
        ccRecipients: [{ emailAddress: { name: 'Bob', address: 'bob@x.com' } }],
      }),
      OWN,
    );
    expect(parsed.from).toEqual({ email: 'sender@x.com' });
    expect(parsed.to).toEqual([{ email: OWN }]);
    expect(parsed.cc).toEqual([{ name: 'Bob', email: 'bob@x.com' }]);
  });

  it('decodes and strips an HTML body', () => {
    const parsed = parseOutlookMessage(
      message({
        body: {
          contentType: 'html',
          content:
            '<html><head><style>body { color: red; }</style></head><body>' +
            '<script>alert("x")</script><p>Hello&nbsp;&amp;&nbsp;welcome</p>' +
            '<p>Line &lt;two&gt;</p></body></html>',
        },
      }),
      OWN,
    );
    expect(parsed.bodyText).toBe('Hello & welcome\nLine <two>');
  });

  it('falls back to bodyPreview when there is no body content', () => {
    const parsed = parseOutlookMessage(
      message({ body: null, bodyPreview: 'Preview text' }),
      OWN,
    );
    expect(parsed.bodyText).toBe('Preview text');

    const emptyContent = parseOutlookMessage(
      message({ body: { contentType: 'text', content: '' }, bodyPreview: 'Preview again' }),
      OWN,
    );
    expect(emptyContent.bodyText).toBe('Preview again');
  });

  it('converts html blocks and breaks to newlines and decodes entities', () => {
    const parsed = parseOutlookMessage(
      message({
        body: {
          contentType: 'html',
          content:
            '<p>Hello &quot;Bob&quot;</p><p>It&#39;s fine</p>' +
            '<p>line<br>break</p><p>last</p>',
        },
      }),
      OWN,
    );
    expect(parsed.bodyText).toBe('Hello "Bob"\nIt\'s fine\nline\nbreak\nlast');
  });

  it('keeps text bodies as-is', () => {
    const parsed = parseOutlookMessage(
      message({ body: { contentType: 'text', content: 'line one\nline two' } }),
      OWN,
    );
    expect(parsed.bodyText).toBe('line one\nline two');
  });

  it('detects List-Unsubscribe case-insensitively', () => {
    const parsed = parseOutlookMessage(
      message({
        internetMessageHeaders: [
          { name: 'list-unsubscribe', value: '<mailto:leave@x.com>' },
        ],
      }),
      OWN,
    );
    expect(parsed.hasListUnsubscribe).toBe(true);
  });

  it('treats empty and <> List-Unsubscribe values as false', () => {
    const empty = parseOutlookMessage(
      message({ internetMessageHeaders: [{ name: 'List-Unsubscribe', value: '' }] }),
      OWN,
    );
    expect(empty.hasListUnsubscribe).toBe(false);

    const placeholder = parseOutlookMessage(
      message({ internetMessageHeaders: [{ name: 'List-Unsubscribe', value: ' <> ' }] }),
      OWN,
    );
    expect(placeholder.hasListUnsubscribe).toBe(false);
  });

  it('parses references and message metadata', () => {
    const parsed = parseOutlookMessage(
      message({
        internetMessageId: '<m1@x.com>',
        internetMessageHeaders: [
          { name: 'References', value: '<a@x.com> <b@y.com>' },
        ],
        receivedDateTime: 'not-a-date',
        sentDateTime: '2024-02-02T08:30:00Z',
        subject: undefined,
      }),
      OWN,
    );
    expect(parsed.rfcMessageId).toBe('<m1@x.com>');
    expect(parsed.references).toEqual(['<a@x.com>', '<b@y.com>']);
    expect(parsed.subject).toBe('');
    expect(parsed.date).toBe(Date.parse('2024-02-02T08:30:00Z'));
  });
});

describe('groupOutlookThreads', () => {
  it('groups by conversation, sorts threads and messages, and dedupes participants', () => {
    const messages: GraphMessage[] = [
      message({
        id: 'a2',
        conversationId: 'convA',
        subject: 'Re: Hello',
        from: { emailAddress: { address: OWN } },
        toRecipients: [{ emailAddress: { address: 'SARAH@acme.com' } }],
        receivedDateTime: '2024-01-01T12:00:00Z',
        body: { contentType: 'text', content: 'Second reply body' },
      }),
      message({
        id: 'a1',
        conversationId: 'convA',
        subject: 'Hello',
        from: { emailAddress: { name: 'Sarah', address: 'sarah@acme.com' } },
        receivedDateTime: '2024-01-01T10:00:00Z',
        body: { contentType: 'text', content: 'First message' },
      }),
      message({
        id: 'b1',
        conversationId: 'convB',
        subject: 'Invoice',
        from: { emailAddress: { name: 'Marcus', address: 'marcus@vendor.io' } },
        receivedDateTime: '2024-01-01T11:00:00Z',
        body: { contentType: 'text', content: 'Invoice attached' },
      }),
      message({
        id: 'draft1',
        conversationId: 'convC',
        isDraft: true,
      }),
    ];

    const threads = groupOutlookThreads(messages, OWN);

    expect(threads.map((t) => t.id)).toEqual(['convA', 'convB']);
    expect(threads[0].messages.map((m) => m.id)).toEqual(['a1', 'a2']);
    expect(threads[0].subject).toBe('Hello');
    expect(threads[0].snippet).toBe('Second reply body');
    expect(threads[0].lastMessageAt).toBe(Date.parse('2024-01-01T12:00:00Z'));
    expect(threads[0].participants.map((p) => p.email)).toEqual([
      'sarah@acme.com',
      OWN,
    ]);
    expect(threads[0].inInbox).toBe(true);
    expect(threads[0].labels).toEqual([]);
    expect(threads[1].id).toBe('convB');
  });

  it('uses the first non-empty subject', () => {
    const threads = groupOutlookThreads(
      [
        message({
          id: 'n1',
          subject: '',
          receivedDateTime: '2024-01-01T10:00:00Z',
        }),
        message({
          id: 'n2',
          subject: 'Re: Real subject',
          receivedDateTime: '2024-01-01T11:00:00Z',
        }),
      ],
      OWN,
    );
    expect(threads[0].subject).toBe('Re: Real subject');
  });

  it('falls back to the message id when conversationId is absent and honors inInbox', () => {
    const threads = groupOutlookThreads(
      [message({ id: 'solo', conversationId: null })],
      OWN,
      { inInbox: false },
    );
    expect(threads.map((t) => t.id)).toEqual(['solo']);
    expect(threads[0].inInbox).toBe(false);
  });

  it('slices the snippet to 160 characters', () => {
    const threads = groupOutlookThreads(
      [message({ body: { contentType: 'text', content: 'x'.repeat(300) } })],
      OWN,
    );
    expect(threads[0].snippet).toHaveLength(160);
  });
});
