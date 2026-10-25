import type { Card } from '../domain/types';
import type { RepoThread, Repository } from '../db/repository';
import { isOutreachThread } from '../mail/outreach';

export interface BoardData {
  threads: RepoThread[];
  cards: Card[];
}

export async function loadBoard(repo: Repository): Promise<BoardData> {
  // Full, unwindowed set: older leads must keep their cards.
  const [threads, cards, recipients] = await Promise.all([
    repo.listThreads(),
    repo.listCards(),
    repo.listColdRecipients(),
  ]);
  const set = new Set(recipients.map((r) => r.email));
  // listThreads() omits messages; hydrate them for the inbound predicate.
  const hydrated = await Promise.all(
    threads.map(async (thread) => ({
      ...thread,
      messages: await repo.listMessages(thread.rowId),
    })),
  );
  const visible = hydrated.filter((thread) => isOutreachThread(thread, set));
  const visibleIds = new Set(visible.map((t) => t.rowId));
  return {
    threads: visible,
    cards: cards.filter((c) => visibleIds.has(c.threadRowId)),
  };
}
