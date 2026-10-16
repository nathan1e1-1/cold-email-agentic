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
}

export interface MailboxProvider {
  connect(): Promise<Account>;
  isConnected(): boolean;
  listThreads(opts?: { pageToken?: string }): Promise<ThreadPage>;
  getThread(id: string): Promise<Thread | null>;
  send(threadId: string, body: string): Promise<Message>;
  sendNew(input: NewEmailInput): Promise<Message>;
}
