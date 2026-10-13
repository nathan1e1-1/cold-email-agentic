import { describe, it, expect } from 'vitest';
import { NodeRepository } from '../../src/db/nodeRepository';
import {
  ensureCardForThread, moveCard, reopenOnInbound, markSentReconciled,
  computeDirection, reconcile, applyReconcile,
} from '../../src/services/kanban';

async function setup() {
  const repo = new NodeRepository(':memory:');
  const acc = await repo.upsertAccount({ provider: 'gmail', email: 'me@x.com', ownEmail: 'me@x.com',
    tokenRef: 't', createdAt: 1 });
  const thr = await repo.upsertThread({ id: 'thr1', accountId: acc.rowId, subject: '', participants: [],
    labels: [], messages: [], lastMessageAt: 1, snippet: '', inInbox: true });
  return { repo, threadRowId: thr.rowId };
}

describe('computeDirection', () => {
  it('is outbound when the sender matches ownEmail (case-insensitive)', () => {
    expect(computeDirection({ email: 'ME@X.com' }, 'me@x.com')).toBe('outbound');
    expect(computeDirection({ email: ' me@x.com ' }, 'me@x.com')).toBe('outbound');
  });
  it('is inbound for other senders', () => {
    expect(computeDirection({ email: 'them@y.com' }, 'me@x.com')).toBe('inbound');
  });
});

describe('reconcile', () => {
  it('marks a non-sent card sent when the latest message is outbound', () => {
    expect(reconcile('outbound', 'untouched')).toBe('sent');
    expect(reconcile('outbound', 'review')).toBe('sent');
    expect(reconcile('outbound', 'sent')).toBe('sent');
  });
  it('reopens a sent card on a new inbound', () => {
    expect(reconcile('inbound', 'sent')).toBe('untouched');
  });
  it('leaves other states unchanged on inbound', () => {
    expect(reconcile('inbound', 'untouched')).toBe('untouched');
    expect(reconcile('inbound', 'review')).toBe('review');
  });
});

describe('kanban', () => {
  it('creates a new card as untouched and never resets an existing one', async () => {
    const { repo, threadRowId } = await setup();
    const c1 = await ensureCardForThread(repo, threadRowId);
    expect(c1.status).toBe('untouched');
    await moveCard(repo, c1.id, 'review', 0);
    const c2 = await ensureCardForThread(repo, threadRowId);
    expect(c2.id).toBe(c1.id);
    expect(c2.status).toBe('review');
  });

  it('marks a card sent on reconciliation', async () => {
    const { repo, threadRowId } = await setup();
    const c = await ensureCardForThread(repo, threadRowId);
    await markSentReconciled(repo, c.id);
    expect((await repo.getCardByThread(threadRowId))?.status).toBe('sent');
  });

  it('reopens a sent card to untouched when a new inbound arrives', async () => {
    const { repo, threadRowId } = await setup();
    const c = await ensureCardForThread(repo, threadRowId);
    await moveCard(repo, c.id, 'sent', 0);
    await reopenOnInbound(repo, threadRowId);
    expect((await repo.getCardByThread(threadRowId))?.status).toBe('untouched');
  });

  it('leaves review cards alone on inbound', async () => {
    const { repo, threadRowId } = await setup();
    const c = await ensureCardForThread(repo, threadRowId);
    await moveCard(repo, c.id, 'review', 0);
    await reopenOnInbound(repo, threadRowId);
    expect((await repo.getCardByThread(threadRowId))?.status).toBe('review');
  });

  it('applyReconcile moves a card to sent on the latest outbound', async () => {
    const { repo, threadRowId } = await setup();
    await ensureCardForThread(repo, threadRowId);
    await applyReconcile(repo, threadRowId, 'outbound');
    expect((await repo.getCardByThread(threadRowId))?.status).toBe('sent');
  });
});
