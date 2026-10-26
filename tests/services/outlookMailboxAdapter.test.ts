import { describe, it, expect, vi } from 'vitest';
import {
  OutlookMailboxAdapter,
  type GraphProvider,
} from '../../src/services/outlookMailboxAdapter';
import type { GraphMessage } from '../../src/mail/outlookParse';

const OWN = 'me@x.com';

const FOLDERS = {
  inbox: 'folder-inbox',
  deleteditems: 'folder-deleteditems',
  junkemail: 'folder-junkemail',
  sentitems: 'folder-sentitems',
} as const;

type FolderName = keyof typeof FOLDERS;
type ListMessagesOpts = Parameters<GraphProvider['listMessages']>[0];
type SendMailInput = Parameters<GraphProvider['sendMail']>[0];

function fixture(overrides: Partial<GraphMessage> = {}): GraphMessage {
  const id = overrides.id ?? 'm1';
  return {
    id,
    conversationId: `conv-${id}`,
    subject: 'Hello',
    from: { emailAddress: { name: 'Sarah', address: 'sarah@acme.com' } },
    toRecipients: [{ emailAddress: { address: OWN } }],
    receivedDateTime: '2024-01-01T10:00:00Z',
    internetMessageId: `<${id}@acme.com>`,
    parentFolderId: FOLDERS.inbox,
    body: { contentType: 'text', content: `body ${id}` },
    ...overrides,
  };
}

function fakeGraph(overrides: Partial<GraphProvider> = {}) {
  const calls = {
    auth: vi.fn(async () => {}),
    isAuthed: vi.fn(async () => true),
    getProfile: vi.fn(async () => ({ emailAddress: OWN, displayName: 'Me' })),
    getFolderId: vi.fn(async (name: FolderName) => FOLDERS[name]),
    listMessages: vi.fn(async (_opts: ListMessagesOpts) => ({
      messages: [] as GraphMessage[],
      nextLink: null as string | null,
    })),
    getMessage: vi.fn(async (id: string) => fixture({ id })),
    listConversation: vi.fn(async (_id: string, _maxMessages?: number) => [] as GraphMessage[]),
    sendMail: vi.fn(async (_input: SendMailInput) => {}),
    reply: vi.fn(async (_messageId: string, _comment: string) => {}),
    move: vi.fn(async (_messageId: string, _destinationId: 'inbox' | 'deleteditems') => {}),
  };
  const provider: GraphProvider = { ...calls, ...overrides };
  return { provider, calls };
}

describe('OutlookMailboxAdapter', () => {
  it('connects, authenticating when needed and returning the account', async () => {
    const { provider, calls } = fakeGraph();
    calls.isAuthed.mockResolvedValue(false);
    const adapter = new OutlookMailboxAdapter(() => provider);

    expect(adapter.isConnected()).toBe(false);
    const account = await adapter.connect();

    expect(calls.auth).toHaveBeenCalledTimes(1);
    expect(account).toEqual({
      provider: 'outlook',
      email: OWN,
      ownEmail: OWN,
      displayName: 'Me',
    });
    expect(adapter.isConnected()).toBe(true);
  });

  it('reuses an existing auth unless connect is forced', async () => {
    const { provider, calls } = fakeGraph();
    const adapter = new OutlookMailboxAdapter(() => provider);

    await adapter.connect();
    expect(calls.auth).not.toHaveBeenCalled();

    await adapter.connect(true);
    expect(calls.auth).toHaveBeenCalledTimes(1);
  });

  it('lists all inbox mail with the default page size and passes the next link', async () => {
    const { provider, calls } = fakeGraph();
    calls.listMessages.mockResolvedValue({
      messages: [
        fixture({
          id: 'm1',
          conversationId: 'conv-a',
          receivedDateTime: '2024-01-01T10:00:00Z',
        }),
        fixture({
          id: 'm2',
          conversationId: 'conv-a',
          from: { emailAddress: { address: OWN } },
          receivedDateTime: '2024-01-01T11:00:00Z',
        }),
        fixture({
          id: 'm3',
          conversationId: 'conv-b',
          receivedDateTime: '2024-01-01T09:00:00Z',
        }),
      ],
      nextLink: 'https://graph.microsoft.com/v1.0/next',
    });

    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();
    const page = await adapter.listThreads();

    expect(calls.listMessages).toHaveBeenCalledWith({
      folder: 'inbox',
      top: 20,
      nextLink: undefined,
    });
    expect(page.threads.map((t) => t.id)).toEqual(['conv-a', 'conv-b']);
    expect(page.nextPageToken).toBe('https://graph.microsoft.com/v1.0/next');
  });

  it('filters outreach mail by sender and drops junk threads', async () => {
    const first = fixture({
      id: 'm1',
      conversationId: 'conv-a',
      receivedDateTime: '2024-01-01T10:00:00Z',
    });
    const reply = fixture({
      id: 'm2',
      conversationId: 'conv-a',
      subject: 'Re: Hello',
      from: { emailAddress: { address: OWN } },
      toRecipients: [{ emailAddress: { address: 'sarah@acme.com' } }],
      receivedDateTime: '2024-01-01T11:00:00Z',
    });
    const junk = fixture({
      id: 'm3',
      conversationId: 'conv-junk',
      receivedDateTime: '2024-01-01T12:00:00Z',
      internetMessageHeaders: [
        { name: 'List-Unsubscribe', value: '<mailto:leave@x.com>' },
      ],
    });
    const { provider, calls } = fakeGraph();
    calls.listMessages.mockResolvedValue({
      messages: [first, reply, junk],
      nextLink: 'next-1',
    });

    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();
    const page = await adapter.listThreads({ outreachRecipients: ['sarah@acme.com'] });

    const opts = calls.listMessages.mock.calls[0][0];
    expect(opts.folder).toBe('all');
    expect(opts.top).toBe(20);
    expect(opts.filter).toContain('receivedDateTime ge');
    expect(opts.filter).toContain("from/emailAddress/address eq 'sarah@acme.com'");
    expect(page.threads.map((t) => t.id)).toEqual(['conv-a']);
    expect(page.threads[0].messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(page.nextPageToken).toBe('next-1');
  });

  it('escapes apostrophes in recipient filters', async () => {
    const { provider, calls } = fakeGraph();
    calls.listMessages.mockResolvedValue({
      messages: [fixture({ id: 'm1', conversationId: 'conv-a' })],
      nextLink: null,
    });
    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();

    await adapter.listThreads({ outreachRecipients: ["a'b@example.com"] });

    const opts = calls.listMessages.mock.calls[0][0];
    expect(opts.filter).toContain("from/emailAddress/address eq 'a''b@example.com'");
  });

  it('normalizes and dedupes recipients before querying', async () => {
    const { provider, calls } = fakeGraph();
    calls.listMessages.mockResolvedValue({
      messages: [fixture({ id: 'm1', conversationId: 'conv-a' })],
      nextLink: null,
    });
    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();

    await adapter.listThreads({
      outreachRecipients: ['Sarah@Acme.com', 'sarah@acme.com', 'OTHER@X.com'],
    });

    expect(calls.listMessages).toHaveBeenCalledTimes(1);
    const filter = calls.listMessages.mock.calls[0][0].filter ?? '';
    expect(filter).toContain("from/emailAddress/address eq 'sarah@acme.com'");
    expect(filter).toContain("from/emailAddress/address eq 'other@x.com'");
    expect(filter).not.toContain('Sarah@Acme.com');
    expect(filter.match(/from\/emailAddress\/address eq/g)).toHaveLength(2);
  });

  it('uses the deleted-items folder and skips known threads in trash', async () => {
    const { provider, calls } = fakeGraph();
    calls.listMessages.mockResolvedValue({
      messages: [
        fixture({
          id: 'm1',
          conversationId: 'conv-trash',
          receivedDateTime: '2024-01-01T10:00:00Z',
        }),
      ],
      nextLink: null,
    });

    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();
    const page = await adapter.listThreads({
      outreachRecipients: ['a@z.com'],
      knownThreadIds: ['conv-known'],
      trashed: true,
    });

    const opts = calls.listMessages.mock.calls[0][0];
    expect(opts.folder).toBe('deleteditems');
    expect(opts.filter).toContain("from/emailAddress/address eq 'a@z.com'");
    expect(calls.listConversation).not.toHaveBeenCalled();
    expect(calls.getFolderId).not.toHaveBeenCalled();
    expect(page.threads.map((t) => t.id)).toEqual(['conv-trash']);
    expect(page.threads[0].inInbox).toBe(false);
  });

  it('merges known conversations on the first page only', async () => {
    const { provider, calls } = fakeGraph();
    calls.listMessages.mockResolvedValue({
      messages: [
        fixture({
          id: 'q1',
          conversationId: 'conv-query',
          receivedDateTime: '2024-01-01T10:00:00Z',
        }),
      ],
      nextLink: 'next',
    });
    calls.listConversation.mockResolvedValue([
      fixture({
        id: 'k1',
        conversationId: 'conv-known',
        receivedDateTime: '2024-01-01T11:00:00Z',
      }),
    ]);

    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();
    const first = await adapter.listThreads({
      outreachRecipients: ['sarah@acme.com'],
      knownThreadIds: ['conv-known'],
    });

    expect(calls.listConversation).toHaveBeenCalledTimes(1);
    expect(calls.listConversation.mock.calls[0]).toEqual(['conv-known', 250]);
    expect(first.threads.map((t) => t.id)).toEqual(['conv-known', 'conv-query']);
    expect(first.threads).toHaveLength(2);

    const second = await adapter.listThreads({
      outreachRecipients: ['sarah@acme.com'],
      knownThreadIds: ['conv-known'],
      pageToken: 'next',
    });

    expect(calls.listConversation).toHaveBeenCalledTimes(1);
    expect(second.threads.map((t) => t.id)).toEqual(['conv-query']);
  });

  it('skips blank, outbound-only, and junk known threads', async () => {
    const { provider, calls } = fakeGraph();
    calls.listConversation.mockImplementation(async (id) => {
      if (id === 'conv-outbound') {
        return [
          fixture({
            id: 'o1',
            conversationId: 'conv-outbound',
            from: { emailAddress: { address: OWN } },
          }),
        ];
      }
      if (id === 'conv-junk') {
        return [
          fixture({
            id: 'j1',
            conversationId: 'conv-junk',
            internetMessageHeaders: [
              { name: 'List-Unsubscribe', value: '<mailto:leave@x.com>' },
            ],
          }),
        ];
      }
      return [fixture({ id: 'g1', conversationId: 'conv-good' })];
    });

    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();
    const page = await adapter.listThreads({
      outreachRecipients: [],
      knownThreadIds: ['', 'conv-outbound', 'conv-junk', 'conv-good'],
    });

    expect(calls.listConversation.mock.calls.map(([id]) => id)).toEqual([
      'conv-outbound',
      'conv-junk',
      'conv-good',
    ]);
    expect(calls.listMessages).not.toHaveBeenCalled();
    expect(page.threads.map((t) => t.id)).toEqual(['conv-good']);
  });

  it('makes no provider calls when there are no recipients or known ids', async () => {
    const { provider, calls } = fakeGraph();
    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();

    const page = await adapter.listThreads({ outreachRecipients: [] });

    expect(calls.listMessages).not.toHaveBeenCalled();
    expect(calls.listConversation).not.toHaveBeenCalled();
    expect(calls.getFolderId).not.toHaveBeenCalled();
    expect(page).toEqual({ threads: [], nextPageToken: null });
  });

  it('caps outreach results at 20 threads', async () => {
    const { provider, calls } = fakeGraph();
    calls.listMessages.mockResolvedValue({
      messages: Array.from({ length: 25 }, (_, i) =>
        fixture({
          id: `m${i}`,
          conversationId: `conv-${i}`,
          receivedDateTime: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
        }),
      ),
      nextLink: null,
    });

    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();
    const page = await adapter.listThreads({ outreachRecipients: ['sarah@acme.com'] });

    expect(page.threads).toHaveLength(20);
  });

  it('excludes junk and deleted-folder messages from all-mail outreach', async () => {
    const { provider, calls } = fakeGraph();
    calls.listMessages.mockResolvedValue({
      messages: [
        fixture({
          id: 'm1',
          conversationId: 'conv-inbox',
          parentFolderId: FOLDERS.inbox,
        }),
        fixture({
          id: 'm2',
          conversationId: 'conv-junk',
          parentFolderId: FOLDERS.junkemail,
        }),
        fixture({
          id: 'm3',
          conversationId: 'conv-deleted',
          parentFolderId: FOLDERS.deleteditems,
        }),
      ],
      nextLink: null,
    });

    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();
    const page = await adapter.listThreads({ outreachRecipients: ['sarah@acme.com'] });

    expect(calls.listMessages.mock.calls[0][0].folder).toBe('all');
    expect(page.threads.map((t) => t.id)).toEqual(['conv-inbox']);
  });

  it('stops fetching chunks once the cap is reached', async () => {
    const { provider, calls } = fakeGraph();
    calls.listMessages.mockResolvedValue({
      messages: Array.from({ length: 20 }, (_, i) =>
        fixture({ id: `m${i}`, conversationId: `conv-${i}` }),
      ),
      nextLink: null,
    });

    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();
    const recipients = Array.from({ length: 11 }, (_, i) => `person${i}@example.com`);
    const page = await adapter.listThreads({ outreachRecipients: recipients });

    expect(calls.listMessages).toHaveBeenCalledTimes(1);
    expect(page.threads).toHaveLength(20);
  });

  it('skips an empty first page when a next link exists', async () => {
    const { provider, calls } = fakeGraph();
    calls.listMessages
      .mockResolvedValueOnce({ messages: [], nextLink: 'next-1' })
      .mockResolvedValueOnce({
        messages: [fixture({ id: 'm1', conversationId: 'conv-1' })],
        nextLink: null,
      });

    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();
    const page = await adapter.listThreads({ outreachRecipients: ['sarah@acme.com'] });

    expect(calls.listMessages).toHaveBeenCalledTimes(2);
    expect(calls.listMessages.mock.calls[1][0]).toEqual({ nextLink: 'next-1' });
    expect(page.threads.map((t) => t.id)).toEqual(['conv-1']);
    expect(page.nextPageToken).toBeNull();
  });

  it('returns only known threads when there are no outreach recipients', async () => {
    const known = fixture({
      id: 'k1',
      conversationId: 'conv-known',
      receivedDateTime: '2024-01-01T09:00:00Z',
    });
    const { provider, calls } = fakeGraph();
    calls.listConversation.mockResolvedValue([known]);

    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();
    const page = await adapter.listThreads({
      outreachRecipients: [],
      knownThreadIds: ['conv-known'],
    });

    expect(calls.listMessages).not.toHaveBeenCalled();
    expect(calls.listConversation.mock.calls[0][0]).toBe('conv-known');
    expect(page.threads.map((t) => t.id)).toEqual(['conv-known']);
    expect(page.nextPageToken).toBeNull();
  });

  it('merges multiple recipient chunks, dedupes threads, and flags overflow', async () => {
    const { provider, calls } = fakeGraph();
    calls.listMessages
      .mockResolvedValueOnce({
        messages: [
          fixture({
            id: 'm1',
            conversationId: 'conv-shared',
            receivedDateTime: '2024-01-01T10:00:00Z',
          }),
          fixture({
            id: 'm2',
            conversationId: 'conv-a',
            receivedDateTime: '2024-01-01T09:00:00Z',
          }),
        ],
        nextLink: null,
      })
      .mockResolvedValueOnce({
        messages: [
          fixture({
            id: 'm3',
            conversationId: 'conv-shared',
            from: { emailAddress: { address: OWN } },
            receivedDateTime: '2024-01-01T11:00:00Z',
          }),
          fixture({
            id: 'm4',
            conversationId: 'conv-b',
            receivedDateTime: '2024-01-01T08:00:00Z',
          }),
        ],
        nextLink: null,
      });

    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();
    const recipients = Array.from({ length: 11 }, (_, i) => `person${i}@example.com`);
    const page = await adapter.listThreads({ outreachRecipients: recipients });

    expect(calls.listMessages).toHaveBeenCalledTimes(2);
    expect(calls.listMessages.mock.calls.map(([opts]) => opts.top)).toEqual([10, 10]);
    expect(calls.listMessages.mock.calls.map(([opts]) => opts.folder)).toEqual(['all', 'all']);
    expect(page.overflowed).toBe(true);
    expect(page.nextPageToken).toBeNull();
    const ids = page.threads.map((t) => t.id);
    expect(ids).toEqual(['conv-shared', 'conv-a', 'conv-b']);
    expect(new Set(ids).size).toBe(ids.length);
    expect(page.threads[0].messages.map((m) => m.id)).toEqual(['m1', 'm3']);
  });

  it('groups a conversation into a thread', async () => {
    const { provider, calls } = fakeGraph();
    calls.listConversation.mockResolvedValue([
      fixture({ id: 'm1', conversationId: 'conv-1' }),
    ]);
    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();

    const thread = await adapter.getThread('conv-1');

    expect(calls.listConversation.mock.calls[0]).toEqual(['conv-1', 250]);
    expect(thread?.id).toBe('conv-1');
    expect(thread?.messages.map((m) => m.id)).toEqual(['m1']);
  });

  it('returns null when a thread cannot be fetched', async () => {
    const { provider, calls } = fakeGraph();
    calls.listConversation.mockRejectedValue(new Error('boom'));
    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();

    expect(await adapter.getThread('conv-1')).toBeNull();
  });

  it('replies to the latest inbound message and returns a synthetic outbound message', async () => {
    const own = fixture({
      id: 'own',
      conversationId: 'conv-1',
      subject: 'Re: Q3',
      from: { emailAddress: { address: OWN } },
      receivedDateTime: '2024-01-01T12:00:00Z',
    });
    const earlyInbound = fixture({
      id: 'in1',
      conversationId: 'conv-1',
      subject: 'Q3',
      receivedDateTime: '2024-01-01T10:00:00Z',
    });
    const latestInbound = fixture({
      id: 'in2',
      conversationId: 'conv-1',
      subject: 'Re: Q3',
      from: { emailAddress: { name: 'Sarah', address: 'sarah@acme.com' } },
      receivedDateTime: '2024-01-01T11:00:00Z',
    });
    const { provider, calls } = fakeGraph();
    calls.listConversation.mockResolvedValue([own, earlyInbound, latestInbound]);

    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();
    const message = await adapter.send('conv-1', 'Sounds good.');

    expect(calls.reply).toHaveBeenCalledWith('in2', 'Sounds good.');
    expect(message).toMatchObject({
      from: { email: OWN },
      to: [{ name: 'Sarah', email: 'sarah@acme.com' }],
      subject: 'Re: Q3',
      bodyText: 'Sounds good.',
      direction: 'outbound',
    });
    expect(message.date).toBeGreaterThan(0);
  });

  it('refuses to reply when the conversation has no inbound message', async () => {
    const { provider, calls } = fakeGraph();
    calls.listConversation.mockResolvedValue([
      fixture({
        id: 'own',
        conversationId: 'conv-1',
        from: { emailAddress: { address: OWN } },
      }),
    ]);
    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();

    await expect(adapter.send('conv-1', 'Hello')).rejects.toThrow(
      'Outlook: no inbound message to reply to',
    );
  });

  it('sends a new email and returns an empty thread id', async () => {
    const { provider, calls } = fakeGraph();
    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();

    const { message, threadId } = await adapter.sendNew({
      to: { name: 'Dana', email: 'dana@acme.com' },
      subject: 'Hello',
      bodyText: 'Hi Dana',
    });

    expect(calls.sendMail).toHaveBeenCalledWith({
      to: ['dana@acme.com'],
      subject: 'Hello',
      bodyText: 'Hi Dana',
    });
    expect(threadId).toBe('');
    expect(message).toMatchObject({
      from: { email: OWN },
      to: [{ name: 'Dana', email: 'dana@acme.com' }],
      subject: 'Hello',
      bodyText: 'Hi Dana',
      direction: 'outbound',
    });
  });

  it('trashes archived threads that are not in the inbox', async () => {
    const { provider, calls } = fakeGraph();
    calls.listConversation.mockResolvedValue([
      fixture({ id: 'a1', conversationId: 'conv-1', parentFolderId: 'folder-archive' }),
      fixture({ id: 'a2', conversationId: 'conv-1', parentFolderId: 'folder-archive' }),
    ]);
    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();

    await adapter.trashThread('conv-1');

    expect(calls.listConversation).toHaveBeenCalledWith('conv-1', 250);
    expect(calls.move.mock.calls).toEqual([
      ['a1', 'deleteditems'],
      ['a2', 'deleteditems'],
    ]);
  });

  it('skips sent-items, deleted-items, and draft messages when trashing', async () => {
    const { provider, calls } = fakeGraph();
    calls.listConversation.mockResolvedValue([
      fixture({ id: 'm1', conversationId: 'conv-1', parentFolderId: FOLDERS.inbox }),
      fixture({ id: 'm2', conversationId: 'conv-1', parentFolderId: FOLDERS.sentitems }),
      fixture({ id: 'm3', conversationId: 'conv-1', parentFolderId: FOLDERS.deleteditems }),
      fixture({
        id: 'm4',
        conversationId: 'conv-1',
        parentFolderId: FOLDERS.inbox,
        isDraft: true,
      }),
    ]);
    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();

    await adapter.trashThread('conv-1');

    expect(calls.move.mock.calls).toEqual([['m1', 'deleteditems']]);
  });

  it('restores only deleted-items messages to the inbox when untrashing', async () => {
    const { provider, calls } = fakeGraph();
    calls.listConversation.mockResolvedValue([
      fixture({ id: 'm1', conversationId: 'conv-1', parentFolderId: FOLDERS.inbox }),
      fixture({ id: 'm2', conversationId: 'conv-1', parentFolderId: FOLDERS.deleteditems }),
      fixture({ id: 'm3', conversationId: 'conv-1', parentFolderId: FOLDERS.junkemail }),
    ]);
    const adapter = new OutlookMailboxAdapter(() => provider);
    await adapter.connect();

    await adapter.untrashThread('conv-1');

    expect(calls.listConversation).toHaveBeenCalledWith('conv-1', 250);
    expect(calls.move.mock.calls).toEqual([['m2', 'inbox']]);
  });
});
