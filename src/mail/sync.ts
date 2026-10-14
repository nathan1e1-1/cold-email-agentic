import type { Repository } from '../db/repository';
import type { Thread } from '../domain/types';
import { ensureCardForThread, applyReconcile } from '../services/kanban';
import type { MailProvider } from './mailProvider';

export interface SyncOptions {
  sinceDays?: number;
  cap?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  fullResync: boolean;
}

async function upsertThreadAndMessages(
  repo: Repository,
  accountId: number,
  thread: Thread,
): Promise<'created' | 'updated' | 'skipped'> {
  const stored = await repo.getThreadByProviderId(thread.id);

  if (
    stored &&
    stored.historyId != null &&
    thread.historyId != null &&
    stored.historyId === thread.historyId
  ) {
    await ensureCardForThread(repo, stored.rowId);
    return 'skipped';
  }

  const saved = await repo.upsertThread({ ...thread, accountId });
  for (const message of thread.messages) {
    await repo.upsertMessage(saved.rowId, message);
  }
  await ensureCardForThread(repo, saved.rowId);
  const last = thread.messages[thread.messages.length - 1];
  if (last) await applyReconcile(repo, saved.rowId, last.direction);

  return stored ? 'updated' : 'created';
}

async function fullSync(
  repo: Repository,
  provider: MailProvider,
  accountId: number,
  sinceDays: number,
  cap: number,
  onProgress?: SyncOptions['onProgress'],
): Promise<SyncResult> {
  const { threads, seededHistoryId } = await provider.listThreads({ sinceDays, cap });
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (let i = 0; i < threads.length; i++) {
    const outcome = await upsertThreadAndMessages(repo, accountId, threads[i]);
    if (outcome === 'created') created++;
    else if (outcome === 'updated') updated++;
    else skipped++;
    onProgress?.(i + 1, threads.length);
  }
  await repo.setHistoryId(accountId, seededHistoryId);
  return { created, updated, skipped, fullResync: true };
}

export async function syncMailbox(
  repo: Repository,
  provider: MailProvider,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const account = await repo.getAccount();
  if (!account) throw new Error('syncMailbox: no account');

  const sinceDays = opts.sinceDays ?? 90;
  const cap = opts.cap ?? 200;

  if (!account.historyId) {
    return fullSync(repo, provider, account.rowId, sinceDays, cap, opts.onProgress);
  }

  const delta = await provider.listHistoryChanges({ historyId: account.historyId });
  if (delta.expired) {
    return fullSync(repo, provider, account.rowId, sinceDays, cap, opts.onProgress);
  }

  const threads = await provider.getThreadsByIds(delta.changedThreadIds);
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (let i = 0; i < threads.length; i++) {
    const outcome = await upsertThreadAndMessages(repo, account.rowId, threads[i]);
    if (outcome === 'created') created++;
    else if (outcome === 'updated') updated++;
    else skipped++;
    opts.onProgress?.(i + 1, threads.length);
  }
  await repo.setHistoryId(account.rowId, delta.nextHistoryId);
  return { created, updated, skipped, fullResync: false };
}
