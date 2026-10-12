import type { Repository } from '../db/repository';
import type { Card, CardStatus } from '../domain/types';

export async function ensureCardForThread(
  repo: Repository, threadRowId: number, position: number, now = Date.now(),
): Promise<Card> {
  const existing = await repo.getCardByThread(threadRowId);
  if (existing) return existing;
  return repo.createCard(threadRowId, 'untouched', position, now);
}

export async function moveCard(
  repo: Repository, cardId: number, status: CardStatus, position: number, now = Date.now(),
): Promise<void> {
  await repo.moveCard(cardId, status, position, now);
}

export async function markSentReconciled(repo: Repository, cardId: number, now = Date.now()): Promise<void> {
  await repo.moveCard(cardId, 'sent', 0, now);
}

export async function reopenOnInbound(repo: Repository, threadRowId: number, now = Date.now()): Promise<void> {
  const card = await repo.getCardByThread(threadRowId);
  if (card && card.status === 'sent') await repo.moveCard(card.id, 'untouched', 0, now);
}
