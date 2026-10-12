import { DatabaseSync } from 'node:sqlite';
import { migrate } from './schema';
import type { Repository, RepoAccount, RepoThread } from './repository';
import type { Account, Address, Card, CardStatus, Contact, Draft, Message, SendKind, Thread } from '../domain/types';

const bool = (n: number | null | undefined) => n === 1;
const toBool = (b: boolean) => (b ? 1 : 0);
const j = (v: unknown) => JSON.stringify(v ?? null);
const pj = <T,>(s: string | null, fallback: T): T => (s ? (JSON.parse(s) as T) : fallback);

export class NodeRepository implements Repository {
  private db: DatabaseSync;
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    migrate(this.db as any);
  }

  private one<T>(sql: string, ...args: any[]): T | null {
    const row = this.db.prepare(sql).get(...args) as T | undefined;
    return row ?? null;
  }
  private all<T>(sql: string, ...args: any[]): T[] {
    return this.db.prepare(sql).all(...args) as T[];
  }
  private run(sql: string, ...args: any[]) {
    this.db.prepare(sql).run(...args);
  }

  async upsertAccount(a: Account & { tokenRef: string; createdAt: number }): Promise<RepoAccount> {
    this.run(
      `INSERT INTO accounts (provider,email,own_email,display_name,token_ref,history_id,created_at)
       VALUES (?,?,?,?,?,NULL,?)
       ON CONFLICT(email) DO UPDATE SET provider=excluded.provider,
         own_email=excluded.own_email,display_name=excluded.display_name,token_ref=excluded.token_ref`,
      a.provider, a.email, a.ownEmail, a.displayName ?? null, a.tokenRef, a.createdAt,
    );
    const row = this.one<any>('SELECT * FROM accounts ORDER BY id DESC LIMIT 1')!;
    return this.mapAccount(row);
  }

  async getAccount(): Promise<RepoAccount | null> {
    const row = this.one<any>('SELECT * FROM accounts ORDER BY id ASC LIMIT 1');
    return row ? this.mapAccount(row) : null;
  }

  async setHistoryId(historyId: string): Promise<void> {
    this.run('UPDATE accounts SET history_id=?', historyId);
  }

  async upsertThread(t: Thread & { accountId: number; hasOwnReply: boolean }): Promise<RepoThread> {
    this.run(
      `INSERT INTO threads (account_id,provider_thread_id,subject,participants_json,labels_json,
         last_message_at,snippet,has_own_reply,in_inbox)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(provider_thread_id) DO UPDATE SET subject=excluded.subject,
         participants_json=excluded.participants_json,labels_json=excluded.labels_json,
         last_message_at=excluded.last_message_at,snippet=excluded.snippet,
         has_own_reply=excluded.has_own_reply,in_inbox=excluded.in_inbox`,
      t.accountId, t.id, t.subject, j(t.participants), j(t.labels), t.lastMessageAt,
      t.snippet, toBool(t.hasOwnReply), toBool(t.inInbox),
    );
    return (await this.getThreadByProviderId(t.id))!;
  }

  async getThreadByProviderId(id: string): Promise<RepoThread | null> {
    const row = this.one<any>('SELECT * FROM threads WHERE provider_thread_id=?', id);
    return row ? this.mapThread(row) : null;
  }

  async listThreads(): Promise<RepoThread[]> {
    return this.all<any>('SELECT * FROM threads ORDER BY last_message_at DESC').map((r) => this.mapThread(r));
  }

  async deleteMessages(providerMessageIds: string[]): Promise<void> {
    for (const id of providerMessageIds) this.run('DELETE FROM messages WHERE provider_message_id=?', id);
  }

  async upsertMessage(threadRowId: number, m: Message): Promise<void> {
    this.run(
      `INSERT INTO messages (thread_id,provider_message_id,rfc_message_id,references_json,
         from_json,to_json,cc_json,subject,body_text,body_html,has_list_unsubscribe,date,direction)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(provider_message_id) DO UPDATE SET rfc_message_id=excluded.rfc_message_id,
         references_json=excluded.references_json,from_json=excluded.from_json,to_json=excluded.to_json,
         cc_json=excluded.cc_json,subject=excluded.subject,body_text=excluded.body_text,
         body_html=excluded.body_html,has_list_unsubscribe=excluded.has_list_unsubscribe,
         date=excluded.date,direction=excluded.direction`,
      threadRowId, m.id, m.rfcMessageId, j(m.references), j(m.from), j(m.to), j(m.cc),
      m.subject, m.bodyText, m.bodyHtml ?? null, toBool(m.hasListUnsubscribe), m.date, m.direction,
    );
  }

  async listMessages(threadRowId: number): Promise<Message[]> {
    return this.all<any>('SELECT * FROM messages WHERE thread_id=? ORDER BY date ASC', threadRowId)
      .map((r) => this.mapMessage(r));
  }

  async createCard(threadRowId: number, status: CardStatus, position: number, now: number): Promise<Card> {
    this.run('INSERT INTO cards (thread_id,status,position,updated_at) VALUES (?,?,?,?)',
      threadRowId, status, position, now);
    return (await this.getCardByThread(threadRowId))!;
  }

  async getCardByThread(threadRowId: number): Promise<Card | null> {
    const row = this.one<any>('SELECT * FROM cards WHERE thread_id=?', threadRowId);
    return row ? this.mapCard(row) : null;
  }

  async listCards(): Promise<Card[]> {
    return this.all<any>('SELECT * FROM cards').map((r) => this.mapCard(r));
  }

  async moveCard(cardId: number, status: CardStatus, position: number, now: number): Promise<void> {
    this.run('UPDATE cards SET status=?,position=?,updated_at=? WHERE id=?', status, position, now, cardId);
  }

  async upsertContact(c: Omit<Contact, 'id'>): Promise<Contact> {
    this.run(
      `INSERT INTO contacts (name,email,notes,do_not_contact,created_at) VALUES (?,?,?,?,?)
       ON CONFLICT(email) DO UPDATE SET name=excluded.name,notes=excluded.notes,
         do_not_contact=excluded.do_not_contact`,
      c.name, c.email, c.notes ?? '', toBool(c.doNotContact), Date.now(),
    );
    return (await this.getContactByEmail(c.email))!;
  }

  async getContactByEmail(email: string): Promise<Contact | null> {
    const row = this.one<any>('SELECT * FROM contacts WHERE email=?', email);
    return row ? this.mapContact(row) : null;
  }

  async setDoNotContact(email: string, value: boolean): Promise<void> {
    this.run('UPDATE contacts SET do_not_contact=? WHERE email=?', toBool(value), email);
  }

  async createDraft(d: Omit<Draft, 'id' | 'isChosen'>): Promise<Draft> {
    this.run(
      `INSERT INTO drafts (card_id,contact_id,body,model,tone,instruction,is_chosen,created_at)
       VALUES (?,?,?,?,?,?,0,?)`,
      d.cardId, d.contactId, d.body, d.model, d.tone, d.instruction, d.createdAt,
    );
    const row = this.one<any>('SELECT * FROM drafts ORDER BY id DESC LIMIT 1')!;
    return this.mapDraft(row);
  }

  async listDrafts(cardId: number): Promise<Draft[]> {
    return this.all<any>('SELECT * FROM drafts WHERE card_id=? ORDER BY created_at DESC', cardId)
      .map((r) => this.mapDraft(r));
  }

  async chooseDraft(draftId: number, cardId: number): Promise<void> {
    this.run('UPDATE drafts SET is_chosen=0 WHERE card_id=?', cardId);
    this.run('UPDATE drafts SET is_chosen=1 WHERE id=?', draftId);
  }

  async recordSend(sentAt: number, kind: SendKind, toEmail: string): Promise<void> {
    this.run('INSERT INTO sends (sent_at,kind,to_email) VALUES (?,?,?)', sentAt, kind, toEmail);
  }

  async countSendsSince(sinceTs: number, kind: SendKind): Promise<number> {
    const row = this.one<{ n: number }>(
      'SELECT COUNT(*) AS n FROM sends WHERE kind=? AND sent_at>=?', kind, sinceTs)!;
    return Number(row.n);
  }

  async hasColdSendTo(email: string): Promise<boolean> {
    const row = this.one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sends WHERE kind='cold' AND to_email=?", email)!;
    return Number(row.n) > 0;
  }

  async getSetting(key: string): Promise<string | null> {
    const row = this.one<{ value: string }>('SELECT value FROM settings WHERE key=?', key);
    return row ? row.value : null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.run(
      `INSERT INTO settings (key,value) VALUES (?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value,
    );
  }

  private mapAccount(r: any): RepoAccount {
    return { rowId: r.id, provider: r.provider, email: r.email, ownEmail: r.own_email,
      displayName: r.display_name ?? undefined, tokenRef: r.token_ref,
      historyId: r.history_id ?? null, createdAt: r.created_at };
  }
  private mapThread(r: any): RepoThread {
    return { rowId: r.id, accountId: r.account_id, id: r.provider_thread_id, subject: r.subject,
      participants: pj<Address[]>(r.participants_json, []), labels: pj<string[]>(r.labels_json, []),
      messages: [], lastMessageAt: r.last_message_at, snippet: r.snippet,
      inInbox: bool(r.in_inbox), hasOwnReply: bool(r.has_own_reply) };
  }
  private mapMessage(r: any): Message {
    return { id: r.provider_message_id, rfcMessageId: r.rfc_message_id,
      references: pj<string[]>(r.references_json, []), from: pj<Address>(r.from_json, { email: '' }),
      to: pj<Address[]>(r.to_json, []), cc: pj<Address[]>(r.cc_json, []), subject: r.subject,
      bodyText: r.body_text, bodyHtml: r.body_html ?? undefined,
      hasListUnsubscribe: bool(r.has_list_unsubscribe), date: r.date, direction: r.direction };
  }
  private mapCard(r: any): Card {
    return { id: r.id, threadRowId: r.thread_id, status: r.status, position: r.position, updatedAt: r.updated_at };
  }
  private mapContact(r: any): Contact {
    return { id: r.id, name: r.name, email: r.email, notes: r.notes, doNotContact: bool(r.do_not_contact) };
  }
  private mapDraft(r: any): Draft {
    return { id: r.id, cardId: r.card_id, contactId: r.contact_id, body: r.body, model: r.model,
      tone: r.tone, instruction: r.instruction, isChosen: bool(r.is_chosen), createdAt: r.created_at };
  }
}
