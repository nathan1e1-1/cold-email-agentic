import { describe, it, expect } from 'vitest';
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
    listThreads: async () => ({ threads: [thread], seededHistoryId: '1' }),
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
    ...overrides,
  };
  return { provider, sent };
}

describe('GmailMailboxAdapter', () => {
  it('connects and reports the account', async () => {
    const { provider } = fakeProvider();
    const adapter = new GmailMailboxAdapter(provider);
    expect(adapter.isConnected()).toBe(false);
    const account = await adapter.connect();
    expect(account.ownEmail).toBe('me@x.com');
    expect(adapter.isConnected()).toBe(true);
  });

  it('lists threads', async () => {
    const { provider } = fakeProvider();
    const adapter = new GmailMailboxAdapter(provider);
    expect((await adapter.listThreads()).map((t) => t.id)).toEqual(['t1']);
  });

  it('returns null when a thread cannot be fetched', async () => {
    const { provider } = fakeProvider({
      getThread: async () => {
        throw new Error('nope');
      },
    });
    const adapter = new GmailMailboxAdapter(provider);
    expect(await adapter.getThread('t1')).toBeNull();
  });

  it('maps a reply to a threaded DraftInput', async () => {
    const { provider, sent } = fakeProvider();
    const adapter = new GmailMailboxAdapter(provider);
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
});
