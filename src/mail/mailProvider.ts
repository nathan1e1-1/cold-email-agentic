import type { Address, Thread } from '../domain/types';

export interface DraftInput {
  threadId?: string;
  to: Address[];
  cc?: Address[];
  subject: string;
  bodyText: string;
  inReplyTo?: string;
  references?: string[];
  listUnsubscribeMailto?: string;
}

export interface HistoryDelta {
  changedThreadIds: string[];
  deletedThreadIds: string[];
  nextHistoryId: string;
  expired: boolean;
}

export interface ListThreadsResult {
  threads: Thread[];
  seededHistoryId: string;
}

export interface GmailProfile {
  emailAddress: string;
  historyId: string;
}

export interface MailProvider {
  auth(): Promise<void>;
  isAuthed(): Promise<boolean>;
  getProfile(): Promise<GmailProfile>;
  listThreads(opts: { sinceDays: number; cap: number; query?: string }): Promise<ListThreadsResult>;
  getThread(id: string): Promise<Thread>;
  getThreadsByIds(ids: string[]): Promise<Thread[]>;
  listHistoryChanges(opts: { historyId: string }): Promise<HistoryDelta>;
  send(input: DraftInput): Promise<{ messageId: string; threadId: string }>;
  findOwnLatestReply(threadId: string): Promise<{ isReply: boolean }>;
}
