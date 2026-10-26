import { describe, it, expect } from 'vitest';
import { NodeRepository } from '../../src/db/nodeRepository';
import { loadBoard } from '../../src/services/board';
import type { Message } from '../../src/domain/types';

function msg(from: string, direction: 'inbound' | 'outbound'): Message {
  return {
    id: `m-${from}-${direction}`, rfcMessageId: '', references: [],
    from: { email: from }, to: [{ email: 'me@x.com' }], cc: [],
    subject: 's', bodyText: '', hasListUnsubscribe: false, date: 1, direction,
  };
}

describe('loadBoard', () => {
  it('includes only threads with an inbound message from a cold recipient', async () => {
    const repo = new NodeRepository(':memory:');
    const account = await repo.upsertAccount({
      provider: 'gmail', email: 'me@x.com', ownEmail: 'me@x.com', tokenRef: 't', createdAt: 1,
    });
    await repo.recordSend(1, 'cold', 'a@z.com');

    const thr1 = await repo.upsertThread({
      id: 'thr1', accountId: account.rowId, subject: '', participants: [{ email: 'a@z.com' }],
      labels: [], messages: [], lastMessageAt: 1, snippet: '', inInbox: true,
    });
    await repo.upsertMessage(thr1.rowId, msg('a@z.com', 'inbound'));

    const thr2 = await repo.upsertThread({
      id: 'thr2', accountId: account.rowId, subject: '', participants: [{ email: 'stranger@z.com' }],
      labels: [], messages: [], lastMessageAt: 2, snippet: '', inInbox: true,
    });
    await repo.upsertMessage(thr2.rowId, msg('stranger@z.com', 'inbound'));
    await repo.createCard(thr2.rowId, 'untouched', 2);

    const thr3 = await repo.upsertThread({
      id: 'thr3', accountId: account.rowId, subject: '', participants: [{ email: 'a@z.com' }],
      labels: [], messages: [], lastMessageAt: 3, snippet: '', inInbox: true,
    });
    await repo.upsertMessage(thr3.rowId, msg('a@z.com', 'outbound'));
    await repo.createCard(thr3.rowId, 'untouched', 3);

    const card1 = await repo.createCard(thr1.rowId, 'untouched', 1);

    const board = await loadBoard(repo);

    expect(board.threads.map((t) => t.id)).toEqual(['thr1']);
    expect(board.cards).toEqual([card1]);
  });

  it('includes known sent threads even when the inbound sender is an alias', async () => {
    const repo = new NodeRepository(':memory:');
    const account = await repo.upsertAccount({
      provider: 'gmail', email: 'me@x.com', ownEmail: 'me@x.com', tokenRef: 't', createdAt: 1,
    });
    await repo.recordSend(1, 'cold', 'primary@z.com', 'thr-known');

    const known = await repo.upsertThread({
      id: 'thr-known', accountId: account.rowId, subject: '', participants: [{ email: 'alias@z.com' }],
      labels: [], messages: [], lastMessageAt: 1, snippet: '', inInbox: true,
    });
    await repo.upsertMessage(known.rowId, msg('alias@z.com', 'inbound'));
    const knownCard = await repo.createCard(known.rowId, 'untouched', 1);

    const unknown = await repo.upsertThread({
      id: 'thr-known-2', accountId: account.rowId, subject: '', participants: [{ email: 'alias2@z.com' }],
      labels: [], messages: [], lastMessageAt: 2, snippet: '', inInbox: true,
    });
    await repo.upsertMessage(unknown.rowId, msg('alias2@z.com', 'inbound'));
    await repo.createCard(unknown.rowId, 'untouched', 2);

    const board = await loadBoard(repo);

    expect(board.threads.map((t) => t.id)).toEqual(['thr-known']);
    expect(board.cards.map((c) => c.id)).toEqual([knownCard.id]);
  });
});

  it('hides self-sent test threads when self is excluded', async () => {
    const repo = new NodeRepository(':memory:');
    const account = await repo.upsertAccount({
      provider: 'gmail', email: 'me@x.com', ownEmail: 'me@x.com', tokenRef: 't', createdAt: 1,
    });
    await repo.recordSend(1, 'cold', 'me@x.com', 'thr-self');
    await repo.recordSend(2, 'cold', 'a@z.com', 'thr-a');

    const self = await repo.upsertThread({
      id: 'thr-self', accountId: account.rowId, subject: '', participants: [{ email: 'me@x.com' }],
      labels: [], messages: [], lastMessageAt: 1, snippet: '', inInbox: true,
    });
    await repo.upsertMessage(self.rowId, msg('me@x.com', 'inbound'));
    await repo.createCard(self.rowId, 'untouched', 1);

    const other = await repo.upsertThread({
      id: 'thr-a', accountId: account.rowId, subject: '', participants: [{ email: 'a@z.com' }],
      labels: [], messages: [], lastMessageAt: 2, snippet: '', inInbox: true,
    });
    await repo.upsertMessage(other.rowId, msg('a@z.com', 'inbound'));
    const otherCard = await repo.createCard(other.rowId, 'untouched', 2);

    const withSelf = await loadBoard(repo, true);
    expect(withSelf.threads.map((t) => t.id).sort()).toEqual(['thr-a', 'thr-self']);

    const withoutSelf = await loadBoard(repo, false);
    expect(withoutSelf.threads.map((t) => t.id)).toEqual(['thr-a']);
    expect(withoutSelf.cards.map((c) => c.id)).toEqual([otherCard.id]);
  });
