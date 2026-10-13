import type { Account, Message, Thread } from '../domain/types';

export interface MailboxProvider {
  connect(): Promise<Account>;
  isConnected(): boolean;
  listThreads(): Promise<Thread[]>;
  getThread(id: string): Promise<Thread | null>;
  send(threadId: string, body: string): Promise<Message>;
}
