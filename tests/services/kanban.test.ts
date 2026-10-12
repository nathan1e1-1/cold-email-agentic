import { describe, it, expect } from 'vitest';
import { NodeRepository } from '../../src/db/nodeRepository';
import {
  ensureCardForThread, moveCard, reopenOnInbound, markSentReconciled,
} from '../../src/services/kanban';

async function setup() {
  const repo = new NodeRepository(':memory:');
  const acc = await repo.upsertAccount({ provider: 'gmail', email: 'me@x.com', ownEmail: 'me@x.com',
    tokenRef: 't', createdAt: 1 });
  const thr = await repo.upsertThread({ id: 'thr1', accountId: acc.rowId, subject: '', participants: [],
    labels: [], messages: [], lastMessageAt: 1, snippet: '', inInbox: true, hasOwnReply: false });
  return { repo, threadRowId: thr.rowId };
}

describe('kanban', () => {
  it('creates a new card as untouched and never resets an existing one', async () => {
    const { repo, threadRowId } = await setup();
    const c1 = await ensureCardForThread(repo, threadRowId, 5);
    expect(c1.status).toBe('untouched');
    await moveCard(repo, c1.id, 'review', 0);
    const c2 = await ensureCardForThread(repo, threadRowId, 5);
    expect(c2.id).toBe(c1.id);
    expect(c2.status).toBe('review');
  });

  it('marks a card sent on reconciliation', async () => {
    const { repo, threadRowId } = await setup();
    const c = await ensureCardForThread(repo, threadRowId, 5);
    await markSentReconciled(repo, c.id);
    expect((await repo.getCardByThread(threadRowId))?.status).toBe('sent');
  });

  it('reopens a sent card to untouched when a new inbound arrives', async () => {
    const { repo, threadRowId } = await setup();
    const c = await ensureCardForThread(repo, threadRowId, 5);
    await moveCard(repo, c.id, 'sent', 0);
    await reopenOnInbound(repo, threadRowId);
    expect((await repo.getCardByThread(threadRowId))?.status).toBe('untouched');
  });

  it('leaves review cards alone on inbound', async () => {
    const { repo, threadRowId } = await setup();
    const c = await ensureCardForThread(repo, threadRowId, 5);
    await moveCard(repo, c.id, 'review', 0);
    await reopenOnInbound(repo, threadRowId);
    expect((await repo.getCardByThread(threadRowId))?.status).toBe('review');
  });
});
