import { describe, it, expect } from 'vitest';
import { NodeRepository } from '../../src/db/nodeRepository';
import { syncMailbox } from '../../src/mail/sync';
import type { MailProvider } from '../../src/mail/mailProvider';
import type { Direction, Thread } from '../../src/domain/types';

function makeThread(id: string, historyId: string, lastDirection: Direction = 'inbound'): Thread {
  return {
    id,
    subject: `S-${id}`,
    participants: [{ email: 'them@y.com' }, { email: 'me@x.com' }],
    messages: [
      {
        id: `${id}-m1`, rfcMessageId: `<${id}@y>`, references: [],
        from: { email: 'them@y.com' }, to: [{ email: 'me@x.com' }], cc: [],
        subject: `S-${id}`, bodyText: 'hi', hasListUnsubscribe: false, date: 1000, direction: lastDirection,
      },
    ],
    lastMessageAt: 1000, snippet: 'hi', inInbox: true, labels: ['INBOX'], historyId,
  };
}

function fakeProvider(overrides: Partial<MailProvider> = {}): MailProvider {
  return {
    auth: async () => {},
    isAuthed: async () => true,
    getProfile: async () => ({ emailAddress: 'me@x.com', historyId: '999' }),
    listThreads: async () => ({ threads: [makeThread('t1', '100'), makeThread('t2', '100')], seededHistoryId: '999', nextPageToken: null }),
    getThread: async (id) => makeThread(id, '100'),
    getThreadsByIds: async (ids) => ids.map((id) => makeThread(id, '1000')),
    listHistoryChanges: async () => ({ changedThreadIds: [], deletedThreadIds: [], nextHistoryId: '1000', expired: false }),
    send: async () => ({ messageId: 'm', threadId: 't' }),
    findOwnLatestReply: async () => ({ isReply: false }),
    trashThread: async () => {},
    untrashThread: async () => {},
    ...overrides,
  };
}

async function seedAccount(repo: NodeRepository, historyId: string | null) {
  const acc = await repo.upsertAccount({ provider: 'gmail', email: 'me@x.com', ownEmail: 'me@x.com',
    tokenRef: 't', createdAt: 1 });
  if (historyId) await repo.setHistoryId(acc.rowId, historyId);
  return acc;
}

describe('syncMailbox', () => {
  it('does a full sync on first run and seeds the historyId', async () => {
    const repo = new NodeRepository(':memory:');
    await seedAccount(repo, null);
    const result = await syncMailbox(repo, fakeProvider());
    expect(result).toEqual({ created: 2, updated: 0, skipped: 0, fullResync: true });
    expect((await repo.getAccount())?.historyId).toBe('999');
    expect((await repo.listCards()).length).toBe(2);
  });

  it('applies history deltas and advances the historyId', async () => {
    const repo = new NodeRepository(':memory:');
    await seedAccount(repo, '999');
    const provider = fakeProvider({
      listHistoryChanges: async () => ({
        changedThreadIds: ['t1'], deletedThreadIds: [], nextHistoryId: '1000', expired: false,
      }),
      getThreadsByIds: async (ids) => ids.map((id) => makeThread(id, '1000')),
    });
    const result = await syncMailbox(repo, provider);
    expect(result).toEqual({ created: 1, updated: 0, skipped: 0, fullResync: false });
    expect((await repo.getAccount())?.historyId).toBe('1000');
  });

  it('skips threads whose historyId is unchanged', async () => {
    const repo = new NodeRepository(':memory:');
    const acc = await seedAccount(repo, '999');
    await repo.upsertThread({ ...makeThread('t1', '1000'), accountId: acc.rowId });
    const provider = fakeProvider({
      listHistoryChanges: async () => ({
        changedThreadIds: ['t1'], deletedThreadIds: [], nextHistoryId: '1000', expired: false,
      }),
      getThreadsByIds: async () => [makeThread('t1', '1000')],
    });
    const result = await syncMailbox(repo, provider);
    expect(result.skipped).toBe(1);
  });

  it('falls back to a full sync when the historyId expired', async () => {
    const repo = new NodeRepository(':memory:');
    await seedAccount(repo, 'old');
    const provider = fakeProvider({
      listHistoryChanges: async () => ({
        changedThreadIds: [], deletedThreadIds: [], nextHistoryId: 'old', expired: true,
      }),
    });
    const result = await syncMailbox(repo, provider);
    expect(result.fullResync).toBe(true);
    expect(result.created).toBe(2);
  });

  it('reconciles a card to sent when the latest message is outbound', async () => {
    const repo = new NodeRepository(':memory:');
    await seedAccount(repo, null);
    const provider = fakeProvider({
      listThreads: async () => ({ threads: [makeThread('t1', '100', 'outbound')], seededHistoryId: '999', nextPageToken: null }),
    });
    await syncMailbox(repo, provider);
    const thr = await repo.getThreadByProviderId('t1');
    expect((await repo.getCardByThread(thr!.rowId))?.status).toBe('sent');
  });

  it('reports progress', async () => {
    const repo = new NodeRepository(':memory:');
    await seedAccount(repo, null);
    const calls: [number, number][] = [];
    await syncMailbox(repo, fakeProvider(), { onProgress: (d, t) => calls.push([d, t]) });
    expect(calls).toEqual([[1, 2], [2, 2]]);
  });
});
