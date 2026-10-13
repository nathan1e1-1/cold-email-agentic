import type { Account, Card, CardStatus, Contact, Draft, Message, SendKind, Thread } from '../domain/types';

export interface RepoAccount extends Account {
  rowId: number;
  tokenRef: string;
  historyId: string | null;
  createdAt: number;
}

export interface RepoThread extends Thread {
  rowId: number;
  accountId: number;
}

export interface Repository {
  transaction<T>(fn: () => Promise<T>): Promise<T>;

  upsertAccount(a: Account & { tokenRef: string; createdAt: number }): Promise<RepoAccount>;
  getAccount(): Promise<RepoAccount | null>;
  setHistoryId(accountId: number, historyId: string): Promise<void>;

  upsertThread(t: Thread & { accountId: number }): Promise<RepoThread>;
  getThreadByProviderId(providerThreadId: string): Promise<RepoThread | null>;
  listThreads(): Promise<RepoThread[]>;
  deleteMessages(providerMessageIds: string[]): Promise<void>;
  upsertMessage(threadRowId: number, m: Message): Promise<void>;
  listMessages(threadRowId: number): Promise<Message[]>;

  /** Inserts a card at the top (position 0) of the given column, shifting siblings. */
  createCard(threadRowId: number, status: CardStatus, now: number): Promise<Card>;
  getCardByThread(threadRowId: number): Promise<Card | null>;
  /** Cards ordered by (status, position). */
  listCards(): Promise<Card[]>;
  /** Moves a card to `index` within `status`, shifting siblings and closing the source gap. */
  moveCard(cardId: number, status: CardStatus, index: number, now: number): Promise<void>;

  upsertContact(c: Omit<Contact, 'id'>): Promise<Contact>;
  getContactByEmail(email: string): Promise<Contact | null>;
  setDoNotContact(email: string, value: boolean): Promise<void>;

  createDraft(d: Omit<Draft, 'id' | 'isChosen'>): Promise<Draft>;
  listDrafts(cardId: number): Promise<Draft[]>;
  chooseDraft(draftId: number, cardId: number): Promise<void>;

  recordSend(sentAt: number, kind: SendKind, toEmail: string): Promise<void>;
  countSendsSince(sinceTs: number, kind: SendKind): Promise<number>;
  hasColdSendTo(email: string): Promise<boolean>;

  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}
