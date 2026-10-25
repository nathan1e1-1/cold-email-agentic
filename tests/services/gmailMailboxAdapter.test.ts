import { describe, it, expect, vi } from 'vitest';
import { GmailMailboxAdapter } from '../../src/services/gmailMailboxAdapter';
import type { MailProvider, DraftInput } from '../../src/mail/mailProvider';
import type { Thread } from '../../src/domain/types';

const thread: Thread = {
  id: 't1',
  subject: 'Q3',
  participants: [
    { name: 'Sarah', email: 'sarah@acme.com' },
    { email: 'me@x.com' },
  ],
  messages: [
    {
      id: 'm1',
      rfcMessageId: '<m1@acme.com>',
      references: [],
      from: { name: 'Sarah', email: 'sarah@acme.com' },
      to: [{ email: 'me@x.com' }],
      cc: [],
      subject: 'Q3',
      bodyText: 'hi',
      hasListUnsubscribe: false,
      date: 1000,
      direction: 'inbound',
    },
  ],
  lastMessageAt: 1000,
  snippet: 'hi',
  inInbox: true,
  labels: ['INBOX'],
};

function fakeProvider(overrides: Partial<MailProvider> = {}): { provider: MailProvider; sent: DraftInput[] } {
  const sent: DraftInput[] = [];
  const provider: MailProvider = {
    auth: async () => {},
    isAuthed: async () => true,
    getProfile: async () => ({ emailAddress: 'me@x.com', historyId: '1' }),
    listThreads: async () => ({ threads: [thread], seededHistoryId: '1', nextPageToken: null }),
    getThread: async () => thread,
    getThreadsByIds: async () => [thread],
    listHistoryChanges: async () => ({
      changedThreadIds: [], deletedThreadIds: [], nextHistoryId: '1', expired: false,
    }),
    send: async (input) => {
      sent.push(input);
      return { messageId: 'sent1', threadId: input.threadId ?? 't1' };
    },
    findOwnLatestReply: async () => ({ isReply: false }),
    trashThread: async () => {},
    untrashThread: async () => {},
    ...overrides,
  };
  return { provider, sent };
}

describe('GmailMailboxAdapter', () => {
  it('connects and reports the account', async () => {
    const { provider } = fakeProvider();
    const adapter = new GmailMailboxAdapter(() => provider);
    expect(adapter.isConnected()).toBe(false);
    const account = await adapter.connect();
    expect(account.ownEmail).toBe('me@x.com');
    expect(adapter.isConnected()).toBe(true);
  });

  it('reuses an existing auth unless connect is forced', async () => {
    const auth = vi.fn(async () => {});
    const isAuthed = vi.fn(async () => true);
    const { provider } = fakeProvider({ auth, isAuthed });
    const adapter = new GmailMailboxAdapter(() => provider);
    await adapter.connect();
    expect(auth).not.toHaveBeenCalled();
    await adapter.connect(true);
    expect(auth).toHaveBeenCalledTimes(1);
  });

  it('lists threads', async () => {
    const { provider } = fakeProvider();
    const adapter = new GmailMailboxAdapter(() => provider);
    await adapter.connect();
    expect((await adapter.listThreads()).threads.map((t) => t.id)).toEqual(['t1']);
  });

  it('returns null when a thread cannot be fetched', async () => {
    const { provider } = fakeProvider({
      getThread: async () => {
        throw new Error('nope');
      },
    });
    const adapter = new GmailMailboxAdapter(() => provider);
    expect(await adapter.getThread('t1')).toBeNull();
  });

  it('maps a reply to a threaded DraftInput', async () => {
    const { provider, sent } = fakeProvider();
    const adapter = new GmailMailboxAdapter(() => provider);
    await adapter.connect();
    const message = await adapter.send('t1', 'Sounds good.');
    expect(message.direction).toBe('outbound');
    expect(message.to[0].email).toBe('sarah@acme.com');
    expect(sent[0]).toEqual({
      threadId: 't1',
      to: [{ name: 'Sarah', email: 'sarah@acme.com' }],
      subject: 'Re: Q3',
      bodyText: 'Sounds good.',
      inReplyTo: '<m1@acme.com>',
      references: ['<m1@acme.com>'],
    });
  });

  it('sends a new first-touch email', async () => {
    const { provider, sent } = fakeProvider();
    const adapter = new GmailMailboxAdapter(() => provider);
    await adapter.connect();
    const { message, threadId } = await adapter.sendNew({
      to: { name: 'Dana', email: 'dana@acme.com' },
      subject: 'Hello',
      bodyText: 'Hi Dana',
      listUnsubscribeMailto: 'mailto:me@x.com?subject=unsubscribe',
    });
    expect(message.subject).toBe('Hello');
    expect(threadId).toBe('t1');
    expect(message.direction).toBe('outbound');
    expect(message.to[0].email).toBe('dana@acme.com');
    expect(sent[0]).toMatchObject({
      subject: 'Hello',
      bodyText: 'Hi Dana',
      listUnsubscribeMailto: 'mailto:me@x.com?subject=unsubscribe',
    });
    expect(sent[0].threadId).toBeUndefined();
  });

  it('outreach mode with no recipients makes no provider call', async () => {
    let calls = 0;
    const { provider } = fakeProvider({
      listThreads: async () => { calls++; return { threads: [thread], seededHistoryId: '1', nextPageToken: null }; },
    });
    const adapter = new GmailMailboxAdapter(() => provider);
    await adapter.connect();
    expect(await adapter.listThreads({ outreachRecipients: [] }))
      .toEqual({ threads: [], nextPageToken: null });
    expect(calls).toBe(0);
  });

  it('outreach mode passes the from-query, 30-day window, cap, page token, and inInbox=false', async () => {
    const seen: unknown[] = [];
    const { provider } = fakeProvider({
      listThreads: async (opts) => { seen.push(opts); return { threads: [thread], seededHistoryId: '1', nextPageToken: 'next' }; },
    });
    const adapter = new GmailMailboxAdapter(() => provider);
    await adapter.connect();
    const page = await adapter.listThreads({
      outreachRecipients: ['sarah@acme.com'], pageToken: 'p2',
    });
    expect(seen[0]).toEqual({
      sinceDays: 30, cap: 20, query: '(from:"sarah@acme.com")', pageToken: 'p2', inInbox: false, inTrash: false,
    });
    expect(page.nextPageToken).toBe('next');
    expect(page.overflowed).toBeFalsy();
  });

  it('outreach mode passes inTrash when trashed is set', async () => {
    const seen: Parameters<MailProvider['listThreads']>[0][] = [];
    const { provider } = fakeProvider({
      listThreads: async (opts) => {
        seen.push(opts);
        return { threads: [thread], seededHistoryId: '1', nextPageToken: null };
      },
    });
    const adapter = new GmailMailboxAdapter(() => provider);
    await adapter.connect();
    await adapter.listThreads({ outreachRecipients: ['sarah@acme.com'], trashed: true });
    expect(seen[0]).toMatchObject({ inInbox: false, inTrash: true });
  });

  it('plain path honors trashed', async () => {
    const seen: Parameters<MailProvider['listThreads']>[0][] = [];
    const { provider } = fakeProvider({
      listThreads: async (opts) => {
        seen.push(opts);
        return { threads: [thread], seededHistoryId: '1', nextPageToken: null };
      },
    });
    const adapter = new GmailMailboxAdapter(() => provider);
    await adapter.connect();
    await adapter.listThreads({ trashed: true });
    expect(seen[0]).toMatchObject({ inTrash: true, inInbox: false, sinceDays: 30, cap: 20 });
  });

  it('trashes and untrashes threads through the provider', async () => {
    const calls: string[] = [];
    const { provider } = fakeProvider({
      trashThread: async (id) => { calls.push(`trash:${id}`); },
      untrashThread: async (id) => { calls.push(`untrash:${id}`); },
    });
    const adapter = new GmailMailboxAdapter(() => provider);
    await adapter.connect();
    await adapter.trashThread('t1');
    await adapter.untrashThread('t1');
    expect(calls).toEqual(['trash:t1', 'untrash:t1']);
  });

  it('skips an empty page when a next-page token exists', async () => {
    const seen: string[] = [];
    const { provider } = fakeProvider({
      listThreads: async (opts) => {
        seen.push(opts.pageToken ?? 'first');
        if (!opts.pageToken) {
          return { threads: [], seededHistoryId: '1', nextPageToken: 'p2' };
        }
        return { threads: [thread], seededHistoryId: '1', nextPageToken: 'p3' };
      },
    });
    const adapter = new GmailMailboxAdapter(() => provider);
    await adapter.connect();
    const page = await adapter.listThreads({ outreachRecipients: ['sarah@acme.com'] });
    expect(seen).toEqual(['first', 'p2']);
    expect(page.threads.map((t) => t.id)).toEqual(['t1']);
    expect(page.nextPageToken).toBe('p3');
  });

  it('outreach overflow merges, dedupes, sorts newest first, and caps at 20', async () => {
    const seen: Parameters<MailProvider['listThreads']>[0][] = [];
    let call = 0;
    const { provider } = fakeProvider({
      listThreads: async (opts) => {
        seen.push(opts);
        const c = call++;
        return {
          threads: Array.from({ length: 10 }, (_, i) => ({
            ...thread,
            id: `t-${c * 8 + i}`,
            lastMessageAt: c * 10 + i,
          })),
          seededHistoryId: '1',
          nextPageToken: null,
        };
      },
    });
    const adapter = new GmailMailboxAdapter(() => provider);
    await adapter.connect();
    const many = Array.from({ length: 500 }, (_, i) => `person${i}@example.com`);
    const page = await adapter.listThreads({ outreachRecipients: many, trashed: true });

    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((o) => o.sinceDays === 30 && o.inInbox === false && o.inTrash === true && o.cap > 0)).toBe(true);
    expect(page.nextPageToken).toBeNull();
    expect(page.overflowed).toBe(true);
    expect(page.threads.length).toBe(20);
    const ids = page.threads.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const dates = page.threads.map((t) => t.lastMessageAt);
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it('stops after skipping 3 dead pages', async () => {
    const seen: (string | undefined)[] = [];
    const { provider } = fakeProvider({
      listThreads: async (opts) => {
        seen.push(opts.pageToken);
        return {
          threads: [],
          seededHistoryId: '1',
          nextPageToken: `p${seen.length + 1}`,
        };
      },
    });
    const adapter = new GmailMailboxAdapter(() => provider);
    await adapter.connect();
    const page = await adapter.listThreads({ outreachRecipients: ['sarah@acme.com'] });

    expect(seen).toEqual([undefined, 'p2', 'p3', 'p4']);
    expect(page.threads).toEqual([]);
    expect(page.nextPageToken).toBe('p5');
  });
});
