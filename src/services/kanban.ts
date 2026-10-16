import type { Repository } from '../db/repository';
import { CARD_STATUSES, type Address, type Card, type CardStatus, type Direction } from '../domain/types';

export function computeDirection(from: Address, ownEmail: string): Direction {
  return from.email.trim().toLowerCase() === ownEmail.trim().toLowerCase() ? 'outbound' : 'inbound';
}

/** Pure status decision: latest outbound → sent; a new inbound on a sent card reopens it. */
export function reconcile(latestDirection: Direction, status: CardStatus): CardStatus {
  if (latestDirection === 'outbound' && status !== 'sent') return 'sent';
  if (latestDirection === 'inbound' && status === 'sent') return 'untouched';
  return status;
}

export async function ensureCardForThread(
  repo: Repository, threadRowId: number, now = Date.now(),
): Promise<Card> {
  const existing = await repo.getCardByThread(threadRowId);
  if (existing) return existing;
  return repo.createCard(threadRowId, 'untouched', now);
}

export async function moveCard(
  repo: Repository, cardId: number, status: CardStatus, index: number, now = Date.now(),
): Promise<void> {
  await repo.moveCard(cardId, status, index, now);
}

/** Applies the reconcile decision to a thread's card, moving it to the top of the target column. */
export async function applyReconcile(
  repo: Repository, threadRowId: number, latestDirection: Direction, now = Date.now(),
): Promise<void> {
  const card = await repo.getCardByThread(threadRowId);
  if (!card) return;
  const next = reconcile(latestDirection, card.status);
  if (next !== card.status) await repo.moveCard(card.id, next, 0, now);
}

export async function markSentReconciled(repo: Repository, cardId: number, now = Date.now()): Promise<void> {
  await repo.moveCard(cardId, 'sent', 0, now);
}

export async function reopenOnInbound(repo: Repository, threadRowId: number, now = Date.now()): Promise<void> {
  await applyReconcile(repo, threadRowId, 'inbound', now);
}

export function groupCardsByStatus(cards: Card[]): Record<CardStatus, Card[]> {
  const groups: Record<CardStatus, Card[]> = { untouched: [], review: [], sent: [] };
  for (const card of cards) groups[card.status].push(card);
  for (const status of CARD_STATUSES) {
    groups[status].sort((a, b) => a.position - b.position || a.id - b.id);
  }
  return groups;
}
