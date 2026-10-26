import type { Card } from '../domain/types';
import type { RepoThread, Repository } from '../db/repository';
import { isRelevantThread } from '../mail/outreach';

export interface BoardData {
  threads: RepoThread[];
  cards: Card[];
}

export async function loadBoard(repo: Repository, includeSelf = true): Promise<BoardData> {
  const account = includeSelf ? null : await repo.getAccount();
  const exclude = account?.ownEmail;
  // Full, unwindowed set: older leads must keep their cards.
  const [threads, cards, recipients, coldThreadIds] = await Promise.all([
    repo.listThreads(),
    repo.listCards(),
    repo.listColdRecipients(),
    repo.listColdThreadIds(exclude),
  ]);
  const set = new Set(recipients.map((r) => r.email));
  if (exclude) set.delete(exclude.trim().toLowerCase());
  const known = new Set(coldThreadIds);
  // listThreads() omits messages; hydrate them for the inbound predicate.
  const hydrated = await Promise.all(
    threads.map(async (thread) => ({
      ...thread,
      messages: await repo.listMessages(thread.rowId),
    })),
  );
  const visible = hydrated.filter((thread) => isRelevantThread(thread, set, known));
  const visibleIds = new Set(visible.map((t) => t.rowId));
  return {
    threads: visible,
    cards: cards.filter((c) => visibleIds.has(c.threadRowId)),
  };
}
