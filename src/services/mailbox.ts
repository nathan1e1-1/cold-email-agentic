import type { Account, Address, Message, Thread } from '../domain/types';

export interface NewEmailInput {
  to: Address;
  subject: string;
  bodyText: string;
  listUnsubscribeMailto?: string;
}

export interface ThreadPage {
  threads: Thread[];
  nextPageToken: string | null;
  overflowed?: boolean;
}

export interface ThreadQueryOptions {
  pageToken?: string;
  /** Present → outreach mode. Empty array means "no cold recipients yet". */
  outreachRecipients?: string[];
  /** Thread IDs we started (sends.thread_id); matched directly so alias/older replies are visible. */
  knownThreadIds?: string[];
  trashed?: boolean;
}

export interface SentNewEmail {
  message: Message;
  threadId: string;
}

export interface MailboxProvider {
  connect(force?: boolean): Promise<Account>;
  isConnected(): boolean;
  listThreads(opts?: ThreadQueryOptions): Promise<ThreadPage>;
  getThread(id: string): Promise<Thread | null>;
  send(threadId: string, body: string): Promise<Message>;
  sendNew(input: NewEmailInput): Promise<SentNewEmail>;
  trashThread(id: string): Promise<void>;
  untrashThread(id: string): Promise<void>;
}
