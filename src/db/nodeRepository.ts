import { DatabaseSync } from 'node:sqlite';
import { migrate } from './schema';
import type { Repository, RepoAccount, RepoThread } from './repository';
import type { Account, Card, CardStatus, ColdRecipient, Contact, Draft, Message, SendKind, Thread } from '../domain/types';
import { j, mapAccount, mapCard, mapContact, mapDraft, mapMessage, mapThread, normEmail, toBool } from './mappers';
import * as SQL from './sql';

export class NodeRepository implements Repository {
  private db: DatabaseSync;
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    migrate(this.db);
  }

  private one<T>(sql: string, ...args: any[]): T | null {
    const row = this.db.prepare(sql).get(...args) as T | undefined;
    return row ?? null;
  }
  private all<T>(sql: string, ...args: any[]): T[] {
    return this.db.prepare(sql).all(...args) as T[];
  }
  private run(sql: string, ...args: any[]) {
    return this.db.prepare(sql).run(...args);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.db.exec('BEGIN');
    try {
      const result = await fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async upsertAccount(a: Account & { tokenRef: string; createdAt: number }): Promise<RepoAccount> {
    const existing = this.one<{ id: number }>(SQL.SQL_FIND_ACCOUNT_ID);
    if (existing) {
      this.run(
        SQL.SQL_UPDATE_ACCOUNT,
        a.provider, a.email, a.ownEmail, a.displayName ?? null, a.tokenRef, existing.id,
      );
      return mapAccount(this.one<any>(SQL.SQL_SELECT_ACCOUNT_BY_ID, existing.id)!);
    }
    const info = this.run(
      SQL.SQL_INSERT_ACCOUNT,
      a.provider, a.email, a.ownEmail, a.displayName ?? null, a.tokenRef, a.createdAt,
    );
    return mapAccount(this.one<any>(SQL.SQL_SELECT_ACCOUNT_BY_ID, Number(info.lastInsertRowid))!);
  }

  async getAccount(): Promise<RepoAccount | null> {
    const row = this.one<any>(SQL.SQL_SELECT_FIRST_ACCOUNT);
    return row ? mapAccount(row) : null;
  }

  async upsertThread(t: Thread & { accountId: number }): Promise<RepoThread> {
    this.run(
      SQL.SQL_UPSERT_THREAD,
      t.accountId, t.id, t.subject, j(t.participants), j(t.labels), t.lastMessageAt,
      t.snippet, toBool(t.inInbox),
    );
    return (await this.getThreadByProviderId(t.id))!;
  }

  async getThreadByProviderId(id: string): Promise<RepoThread | null> {
    const row = this.one<any>(SQL.SQL_SELECT_THREAD_BY_PROVIDER_ID, id);
    return row ? mapThread(row) : null;
  }

  async listThreads(): Promise<RepoThread[]> {
    return this.all<any>(SQL.SQL_LIST_THREADS).map((r) => mapThread(r));
  }

  async deleteMessages(providerMessageIds: string[]): Promise<void> {
    await this.transaction(async () => {
      for (const id of providerMessageIds) this.run(SQL.SQL_DELETE_MESSAGE, id);
    });
  }

  async deleteThreadByProviderId(providerThreadId: string): Promise<void> {
    await this.transaction(async () => {
      const row = this.one<{ id: number }>(SQL.SQL_FIND_THREAD_ID, providerThreadId);
      if (!row) return;
      this.run(SQL.SQL_DELETE_DRAFTS_BY_THREAD, row.id);
      this.run(SQL.SQL_DELETE_CARDS_BY_THREAD, row.id);
      this.run(SQL.SQL_DELETE_MESSAGES_BY_THREAD, row.id);
      this.run(SQL.SQL_DELETE_THREAD_BY_ROW_ID, row.id);
    });
  }

  async upsertMessage(threadRowId: number, m: Message): Promise<void> {
    this.run(
      SQL.SQL_UPSERT_MESSAGE,
      threadRowId, m.id, m.rfcMessageId, j(m.references), j(m.from), j(m.to), j(m.cc),
      m.subject, m.bodyText, m.bodyHtml ?? null, toBool(m.hasListUnsubscribe), m.date, m.direction,
    );
  }

  async listMessages(threadRowId: number): Promise<Message[]> {
    return this.all<any>(SQL.SQL_LIST_MESSAGES, threadRowId)
      .map((r) => mapMessage(r));
  }

  async createCard(threadRowId: number, status: CardStatus, now: number): Promise<Card> {
    return this.transaction(async () => {
      const existing = await this.getCardByThread(threadRowId);
      if (existing) return existing;
      this.run(SQL.SQL_SHIFT_CARDS_FOR_INSERT, status);
      const info = this.run(
        SQL.SQL_INSERT_CARD,
        threadRowId, status, now,
      );
      return mapCard(this.one<any>(SQL.SQL_SELECT_CARD_BY_ID, Number(info.lastInsertRowid))!);
    });
  }

  async getCardByThread(threadRowId: number): Promise<Card | null> {
    const row = this.one<any>(SQL.SQL_SELECT_CARD_BY_THREAD, threadRowId);
    return row ? mapCard(row) : null;
  }

  async listCards(): Promise<Card[]> {
    return this.all<any>(SQL.SQL_LIST_CARDS).map((r) => mapCard(r));
  }

  async moveCard(cardId: number, status: CardStatus, index: number, now: number): Promise<void> {
    await this.transaction(async () => {
      const card = this.one<{ status: CardStatus; position: number }>(
        SQL.SQL_SELECT_CARD_POSITION, cardId,
      );
      if (!card) throw new Error(`Card not found: ${cardId}`);
      const from = card.status;
      const fromPos = card.position;
      const to = Math.max(0, index);

      if (from === status) {
        if (to === fromPos) {
          this.run(SQL.SQL_TOUCH_CARD, now, cardId);
          return;
        }
        if (to < fromPos) {
          this.run(
            SQL.SQL_SHIFT_CARDS_UP_RANGE,
            status, to, fromPos,
          );
        } else {
          this.run(
            SQL.SQL_SHIFT_CARDS_DOWN_RANGE,
            status, fromPos, to,
          );
        }
        this.run(SQL.SQL_SET_CARD_POSITION, to, now, cardId);
      } else {
        this.run(SQL.SQL_CLOSE_CARD_GAP, from, fromPos);
        this.run(SQL.SQL_OPEN_CARD_GAP, status, to);
        this.run(SQL.SQL_MOVE_CARD_STATUS, status, to, now, cardId);
      }
    });
  }

  async upsertContact(c: Omit<Contact, 'id'>): Promise<Contact> {
    const email = normEmail(c.email);
    this.run(
      SQL.SQL_UPSERT_CONTACT,
      c.name, email, c.notes ?? '', toBool(c.doNotContact), Date.now(),
    );
    return (await this.getContactByEmail(email))!;
  }

  async getContactByEmail(email: string): Promise<Contact | null> {
    const row = this.one<any>(SQL.SQL_SELECT_CONTACT_BY_EMAIL, normEmail(email));
    return row ? mapContact(row) : null;
  }

  async listContacts(): Promise<Contact[]> {
    return this.all<any>(SQL.SQL_LIST_CONTACTS).map((r) => mapContact(r));
  }

  async setDoNotContact(email: string, value: boolean): Promise<void> {
    this.run(SQL.SQL_SET_DO_NOT_CONTACT, toBool(value), normEmail(email));
  }

  async createDraft(d: Omit<Draft, 'id' | 'isChosen'>): Promise<Draft> {
    const info = this.run(
      SQL.SQL_INSERT_DRAFT,
      d.cardId, d.contactId, d.body, d.model, d.tone, d.instruction, d.createdAt,
    );
    return mapDraft(this.one<any>(SQL.SQL_SELECT_DRAFT_BY_ID, Number(info.lastInsertRowid))!);
  }

  async listDrafts(cardId: number): Promise<Draft[]> {
    return this.all<any>(SQL.SQL_LIST_DRAFTS, cardId)
      .map((r) => mapDraft(r));
  }

  async chooseDraft(draftId: number, cardId: number): Promise<void> {
    this.run(SQL.SQL_CHOOSE_DRAFT, draftId, cardId);
  }

  async recordSend(sentAt: number, kind: SendKind, toEmail: string, threadId?: string): Promise<void> {
    this.run(
      SQL.SQL_INSERT_SEND,
      sentAt, kind, normEmail(toEmail), threadId ?? null,
    );
  }

  async listColdRecipients(): Promise<ColdRecipient[]> {
    const rows = this.all<{ email: string; last_sent_at: number }>(
      SQL.SQL_LIST_COLD_RECIPIENTS,
    );
    return rows.map((r) => ({ email: normEmail(r.email), lastSentAt: Number(r.last_sent_at) }));
  }

  async listColdThreadIds(): Promise<string[]> {
    return this.all<{ thread_id: string }>(
      SQL.SQL_LIST_COLD_THREAD_IDS,
    ).map((r) => r.thread_id);
  }

  async countSendsSince(sinceTs: number, kind: SendKind): Promise<number> {
    const row = this.one<{ n: number }>(
      SQL.SQL_COUNT_SENDS_SINCE, kind, sinceTs)!;
    return Number(row.n);
  }

  async hasColdSendTo(email: string): Promise<boolean> {
    const row = this.one<{ n: number }>(
      SQL.SQL_HAS_COLD_SEND_TO, normEmail(email))!;
    return Number(row.n) > 0;
  }

  async getSetting(key: string): Promise<string | null> {
    const row = this.one<{ value: string }>(SQL.SQL_GET_SETTING, key);
    return row ? row.value : null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.run(
      SQL.SQL_UPSERT_SETTING, key, value,
    );
  }
}
