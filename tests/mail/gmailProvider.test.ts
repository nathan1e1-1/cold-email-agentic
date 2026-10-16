import { describe, it, expect } from 'vitest';
import { GmailProvider } from '../../src/mail/gmailProvider';
import { utf8ToBase64Url } from '../../src/mail/encoding';
import type { Authenticator } from '../../src/mail/oauth';
import type { GmailThreadResource } from '../../src/mail/gmailParse';
import { FakeHttpClient } from './fakeHttp';

const auth: Authenticator = {
  auth: async () => {},
  isAuthed: async () => true,
  getAccessToken: async () => 'TOKEN',
};

function threadRes(id: string, from: string, subject: string): GmailThreadResource {
  return {
    id,
    historyId: '500',
    messages: [
      {
        id: `${id}-m1`,
        threadId: id,
        labelIds: ['INBOX'],
        internalDate: '1000',
        payload: {
          headers: [
            { name: 'From', value: from },
            { name: 'To', value: 'me@x.com' },
            { name: 'Subject', value: subject },
            { name: 'Message-ID', value: `<${id}@x>` },
          ],
          parts: [{ mimeType: 'text/plain', body: { data: utf8ToBase64Url('body') } }],
        },
      },
    ],
  };
}

function router(): FakeHttpClient {
  return new FakeHttpClient().onRequest((req) => {
    const u = req.url;
    if (u.endsWith('/profile')) {
      return { status: 200, body: JSON.stringify({ emailAddress: 'me@x.com', historyId: '999' }) };
    }
    if (u.includes('/threads?')) {
      return { status: 200, body: JSON.stringify({ threads: [{ id: 't1' }, { id: 't2' }] }) };
    }
    if (u.includes('/threads/t1')) {
      return { status: 200, body: JSON.stringify(threadRes('t1', 'Sarah <sarah@acme.com>', 'Q3')) };
    }
    if (u.includes('/threads/t2')) {
      return { status: 200, body: JSON.stringify(threadRes('t2', 'Marcus <m@n.io>', 'Invoice')) };
    }
    if (u.includes('/messages/send')) {
      return { status: 200, body: JSON.stringify({ id: 'sent1', threadId: 't1' }) };
    }
    return { status: 404, body: '{}' };
  });
}

function provider(
  http: FakeHttpClient,
  overrides: Partial<{
    concurrency: number;
    maxRetries: number;
    backoffMs: number;
    throttleMs: number;
    sleep: (ms: number) => Promise<void>;
  }> = {},
) {
  return new GmailProvider({ http, auth, ownEmail: 'me@x.com', concurrency: 2, throttleMs: 0, ...overrides });
}

describe('GmailProvider', () => {
  it('reads the profile', async () => {
    const p = provider(router());
    expect(await p.getProfile()).toEqual({ emailAddress: 'me@x.com', historyId: '999' });
  });

  it('lists threads (parsed) and seeds historyId, with bearer auth', async () => {
    const http = router();
    const result = await provider(http).listThreads({ sinceDays: 90, cap: 200 });
    expect(result.threads.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(result.threads[0].subject).toBe('Q3');
    expect(result.seededHistoryId).toBe('999');
    expect(http.requests.every((r) => r.headers?.Authorization === 'Bearer TOKEN')).toBe(true);
    expect(new URL(http.requests[0].url).searchParams.get('q')).toContain('newer_than:90d');
  });

  it('appends a custom query to the thread search', async () => {
    const http = router();
    await provider(http).listThreads({ sinceDays: 90, cap: 5, query: 'is:unread -category:promotions' });
    const q = new URL(http.requests[0].url).searchParams.get('q') ?? '';
    expect(q).toContain('is:unread -category:promotions');
  });

  it('gets a single thread', async () => {
    const t = await provider(router()).getThread('t1');
    expect(t.id).toBe('t1');
    expect(t.messages[0].direction).toBe('inbound');
  });

  it('gets threads by ids', async () => {
    const threads = await provider(router()).getThreadsByIds(['t1', 't2']);
    expect(threads.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('reports history deltas', async () => {
    const http = new FakeHttpClient().onRequest(() => ({
      status: 200,
      body: JSON.stringify({
        historyId: '1000',
        history: [
          { messagesAdded: [{ message: { threadId: 't1' } }] },
          { messagesDeleted: [{ message: { threadId: 't9' } }] },
        ],
      }),
    }));
    const delta = await provider(http).listHistoryChanges({ historyId: '500' });
    expect(delta.expired).toBe(false);
    expect(delta.changedThreadIds).toEqual(['t1']);
    expect(delta.deletedThreadIds).toEqual(['t9']);
    expect(delta.nextHistoryId).toBe('1000');
  });

  it('flags an expired historyId on 404', async () => {
    const http = new FakeHttpClient().onRequest(() => ({ status: 404, body: '{}' }));
    const delta = await provider(http).listHistoryChanges({ historyId: 'old' });
    expect(delta.expired).toBe(true);
  });

  it('sends a threaded message with raw MIME', async () => {
    const http = router();
    const result = await provider(http).send({
      threadId: 't1',
      to: [{ email: 'sarah@acme.com' }],
      subject: 'Re: Q3',
      bodyText: 'Sounds good.',
      inReplyTo: '<t1@x>',
      references: ['<t1@x>'],
    });
    expect(result).toEqual({ messageId: 'sent1', threadId: 't1' });
    const req = http.requests.find((r) => r.url.includes('/messages/send'))!;
    expect(req.method).toBe('POST');
    const body = JSON.parse(req.body as string) as { raw: string; threadId: string };
    expect(body.threadId).toBe('t1');
    expect(body.raw).not.toMatch(/[+/=]/);
  });

  it('detects the latest message being outbound', async () => {
    const http = new FakeHttpClient().onRequest(() => ({
      status: 200,
      body: JSON.stringify(threadRes('t1', 'me@x.com', 'Q3')),
    }));
    expect(await provider(http).findOwnLatestReply('t1')).toEqual({ isReply: true });
  });

  it('surfaces the Gmail error reason when a call fails', async () => {
    const http = new FakeHttpClient().onRequest(() => ({
      status: 403,
      body: JSON.stringify({
        error: { code: 403, status: 'PERMISSION_DENIED', message: 'Gmail API has not been used in project 123 or it is disabled.' },
      }),
    }));
    await expect(provider(http).getThread('t1')).rejects.toThrow(/Gmail API has not been used in project 123/);
  });

  it('surfaces a listThreads error instead of returning an empty inbox', async () => {
    const http = new FakeHttpClient().onRequest(() => ({
      status: 403,
      body: JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Insufficient Permission' } }),
    }));
    await expect(provider(http).listThreads({ sinceDays: 90, cap: 10 })).rejects.toThrow(/Insufficient Permission/);
  });

  it('retries a quota error and then succeeds', async () => {
    const http = new FakeHttpClient()
      .queueResponse({
        status: 403,
        body: JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: "Quota exceeded for quota metric 'Total Query Cost'" } }),
      })
      .queueResponse({ status: 200, body: JSON.stringify(threadRes('t1', 'sarah@acme.com', 'Q3')) });
    const p = provider(http, { sleep: async () => {} });
    expect((await p.getThread('t1')).id).toBe('t1');
    expect(http.requests.length).toBe(2);
  });

  it('gives up after maxRetries on a sustained quota error', async () => {
    const http = new FakeHttpClient();
    for (let i = 0; i < 3; i++) {
      http.queueResponse({ status: 403, body: JSON.stringify({ error: { message: 'Quota exceeded' } }) });
    }
    const p = provider(http, { maxRetries: 2, sleep: async () => {} });
    await expect(p.getThread('t1')).rejects.toThrow(/Quota exceeded/);
    expect(http.requests.length).toBe(3);
  });

  it('waits out a per-minute quota window before retrying', async () => {
    const delays: number[] = [];
    const http = new FakeHttpClient()
      .queueResponse({
        status: 403,
        body: JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: "Quota exceeded for quota metric 'Total Query Cost'" } }),
      })
      .queueResponse({ status: 200, body: JSON.stringify(threadRes('t1', 'sarah@acme.com', 'Q3')) });
    const p = provider(http, { backoffMs: 3000, sleep: async (ms) => { delays.push(ms); } });
    expect((await p.getThread('t1')).id).toBe('t1');
    expect(delays).toEqual([3000]);
  });
});
