# ColdEmailAgentic — Plan 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the project skeleton and the pure-TypeScript core (domain types, SQLite schema + repository, settings, kanban state machine) with a passing test suite — no network, no UI.

**Architecture:** A Tauri v2 + React/TS app whose business logic lives in a framework-free TS service layer. All persistence goes through a single `Repository` interface with two implementations: `node:sqlite` (tests) and `tauri-plugin-sql` (app). This task only builds and tests the `node:sqlite` implementation.

**Tech Stack:** Node 24, npm, TypeScript, Vite, React, Vitest, `node:sqlite`, Tauri v2 (shell only in this plan).

**Spec:** `docs/specs/2026-10-09-cold-email-agentic-design.md` (v3).

---

## Prerequisites

- Node 24+ is installed (verified: `node -v` → v24.4.0).
- Rust toolchain via `rustup` (needed only for Task 8). If missing:
  `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
  then `source "$HOME/.cargo/env"` and `rustc --version`.

## File Structure

- `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` — project config
- `src/domain/types.ts` — frozen domain types (mirrors spec §7)
- `src/db/schema.ts` — SQL DDL + migration runner
- `src/db/repository.ts` — the `Repository` interface + row types
- `src/db/nodeRepository.ts` — `node:sqlite` implementation
- `src/services/settings.ts` — settings with defaults (spec §6 settings table)
- `src/services/kanban.ts` — card state machine (spec §6 rules, §8.2, §8.6)
- `tests/db/repository.test.ts`, `tests/services/settings.test.ts`, `tests/services/kanban.test.ts`
- `src-tauri/` — Tauri shell + security config (Task 8)

---

### Task 1: Scaffold project + test tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`

- [ ] **Step 1: Scaffold Vite React-TS in place**

Run:
```bash
npm create vite@latest . -- --template react-ts
```
Expected: if it warns the directory is not empty, choose **"Ignore files and continue"**. It creates `package.json`, `index.html`, `src/`, `tsconfig.json`, `vite.config.ts`.

- [ ] **Step 2: Install deps and Vitest**

Run:
```bash
npm install
npm install -D vitest @types/node
```
Expected: `node_modules/` populated, no peer-dep errors.

- [ ] **Step 3: Add the test script**

Modify `package.json` `"scripts"` to include:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Add vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: Verify the runner works**

Run:
```bash
npm test
```
Expected: Vitest runs and reports **"No test files found"** and exits 0 (no tests yet). If it errors about `node:sqlite` later, that's addressed in Task 4.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts index.html src
git commit -m "chore: scaffold vite react-ts + vitest"
```

---

### Task 2: Domain types

**Files:**
- Create: `src/domain/types.ts`

- [ ] **Step 1: Write the types**

Create `src/domain/types.ts` (mirrors spec §7; `id` on `Message`/`Thread` is the provider id, `id` on `Contact`/`Card`/`Draft` is the local row id):
```ts
export type TonePreset =
  | 'professional' | 'friendly' | 'concise' | 'direct' | 'match';
export type Direction = 'inbound' | 'outbound';
export type CardStatus = 'untouched' | 'review' | 'sent';
export type SendKind = 'reply' | 'cold';
export type PrivacyClass = 'may-use-content' | 'local';

export interface Address { name?: string; email: string }

export interface Message {
  id: string;
  rfcMessageId: string;
  references: string[];
  from: Address;
  to: Address[];
  cc: Address[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  hasListUnsubscribe: boolean;
  date: number;
  direction: Direction;
}

export interface Thread {
  id: string;
  subject: string;
  participants: Address[];
  messages: Message[];
  lastMessageAt: number;
  snippet: string;
  inInbox: boolean;
  labels: string[];
}

export interface Account {
  provider: 'gmail' | 'outlook';
  email: string;
  ownEmail: string;
  displayName?: string;
}

export interface Contact {
  id: number;
  name: string;
  email: string;
  notes?: string;
  doNotContact: boolean;
}

export interface Card {
  id: number;
  threadRowId: number;
  status: CardStatus;
  position: number;
  updatedAt: number;
}

export interface Draft {
  id: number;
  cardId: number | null;
  contactId: number | null;
  body: string;
  model: string;
  tone: TonePreset;
  instruction: string;
  isChosen: boolean;
  createdAt: number;
}

export const CARD_STATUSES: readonly CardStatus[] =
  ['untouched', 'review', 'sent'] as const;
export const TONE_PRESETS: readonly TonePreset[] =
  ['professional', 'friendly', 'concise', 'direct', 'match'] as const;
```

- [ ] **Step 2: Typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/domain/types.ts
git commit -m "feat: add frozen domain types"
```

---

### Task 3: SQLite schema + migration runner

**Files:**
- Create: `src/db/schema.ts`
- Test: `tests/db/repository.test.ts` (schema portion)

- [ ] **Step 1: Write the failing test**

Create `tests/db/repository.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../../src/db/schema';

describe('migrate', () => {
  it('creates all tables', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db as any);
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    for (const t of [
      'accounts', 'threads', 'messages', 'cards',
      'contacts', 'drafts', 'sends', 'settings',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('is idempotent', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db as any);
    expect(() => migrate(db as any)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/db/repository.test.ts`
Expected: FAIL — cannot find module `../../src/db/schema`.

- [ ] **Step 3: Write the schema + runner**

Create `src/db/schema.ts`:
```ts
export interface Sqlite {
  exec(sql: string): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  email TEXT NOT NULL,
  own_email TEXT NOT NULL,
  display_name TEXT,
  token_ref TEXT NOT NULL,
  history_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  provider_thread_id TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL DEFAULT '',
  participants_json TEXT NOT NULL DEFAULT '[]',
  labels_json TEXT NOT NULL DEFAULT '[]',
  last_message_at INTEGER NOT NULL DEFAULT 0,
  snippet TEXT NOT NULL DEFAULT '',
  has_own_reply INTEGER NOT NULL DEFAULT 0,
  in_inbox INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  provider_message_id TEXT NOT NULL UNIQUE,
  rfc_message_id TEXT NOT NULL DEFAULT '',
  references_json TEXT NOT NULL DEFAULT '[]',
  from_json TEXT NOT NULL DEFAULT '{}',
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT,
  has_list_unsubscribe INTEGER NOT NULL DEFAULT 0,
  date INTEGER NOT NULL DEFAULT 0,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound'))
);
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL UNIQUE REFERENCES threads(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('untouched','review','sent')),
  position INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL UNIQUE,
  notes TEXT NOT NULL DEFAULT '',
  do_not_contact INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER REFERENCES cards(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT 'professional',
  instruction TEXT NOT NULL DEFAULT '',
  is_chosen INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sent_at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('reply','cold')),
  to_email TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status, position);
CREATE INDEX IF NOT EXISTS idx_sends_time_kind ON sends(sent_at, kind);
CREATE INDEX IF NOT EXISTS idx_sends_to ON sends(to_email);
`;

export function migrate(db: Sqlite): void {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/db/repository.test.ts`
Expected: PASS (2 tests).
If Node errors with `--experimental-sqlite`, update `package.json` script to
`"test": "NODE_OPTIONS=--experimental-sqlite vitest run"` and rerun.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts tests/db/repository.test.ts
git commit -m "feat: add sqlite schema and migration runner"
```

---

### Task 4: Repository interface + node:sqlite implementation

**Files:**
- Create: `src/db/repository.ts`, `src/db/nodeRepository.ts`

- [ ] **Step 1: Write the interface**

Create `src/db/repository.ts`:
```ts
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
  hasOwnReply: boolean;
}

export interface Repository {
  upsertAccount(a: Account & { tokenRef: string; createdAt: number }): Promise<RepoAccount>;
  getAccount(): Promise<RepoAccount | null>;
  setHistoryId(historyId: string): Promise<void>;

  upsertThread(t: Thread & { accountId: number; hasOwnReply: boolean }): Promise<RepoThread>;
  getThreadByProviderId(providerThreadId: string): Promise<RepoThread | null>;
  listThreads(): Promise<RepoThread[]>;
  deleteMessages(providerMessageIds: string[]): Promise<void>;
  upsertMessage(threadRowId: number, m: Message): Promise<void>;
  listMessages(threadRowId: number): Promise<Message[]>;

  createCard(threadRowId: number, status: CardStatus, position: number, now: number): Promise<Card>;
  getCardByThread(threadRowId: number): Promise<Card | null>;
  listCards(): Promise<Card[]>;
  moveCard(cardId: number, status: CardStatus, position: number, now: number): Promise<void>;

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
```

- [ ] **Step 2: Implement it on node:sqlite**

Create `src/db/nodeRepository.ts`:
```ts
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
       ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,email=excluded.email,
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
```

- [ ] **Step 3: Commit**

```bash
git add src/db/repository.ts src/db/nodeRepository.ts
git commit -m "feat: add repository interface and node:sqlite implementation"
```

---

### Task 5: Repository tests

**Files:**
- Modify: `tests/db/repository.test.ts`

- [ ] **Step 1: Add round-trip tests**

Append to `tests/db/repository.test.ts`:
```ts
import { NodeRepository } from '../../src/db/nodeRepository';

describe('NodeRepository', () => {
  const mk = () => new NodeRepository(':memory:');

  it('persists an account and history id', async () => {
    const repo = mk();
    await repo.upsertAccount({ provider: 'gmail', email: 'me@x.com', ownEmail: 'me@x.com',
      tokenRef: 'gmail/token', createdAt: 1 });
    await repo.setHistoryId('h123');
    const acc = await repo.getAccount();
    expect(acc?.email).toBe('me@x.com');
    expect(acc?.historyId).toBe('h123');
  });

  it('upserts threads idempotently and lists them newest first', async () => {
    const repo = mk();
    const acc = await repo.upsertAccount({ provider: 'gmail', email: 'me@x.com',
      ownEmail: 'me@x.com', tokenRef: 't', createdAt: 1 });
    const t = { id: 'thr1', accountId: acc.rowId, subject: 'Hi', participants: [], labels: [],
      messages: [], lastMessageAt: 100, snippet: 's', inInbox: true, hasOwnReply: false };
    const a = await repo.upsertThread(t);
    const b = await repo.upsertThread({ ...t, subject: 'Hi2', lastMessageAt: 200 });
    expect(a.rowId).toBe(b.rowId);
    expect(b.subject).toBe('Hi2');
    expect((await repo.listThreads()).length).toBe(1);
  });

  it('stores messages with structured fields', async () => {
    const repo = mk();
    const acc = await repo.upsertAccount({ provider: 'gmail', email: 'me@x.com',
      ownEmail: 'me@x.com', tokenRef: 't', createdAt: 1 });
    const thr = await repo.upsertThread({ id: 'thr1', accountId: acc.rowId, subject: 'Hi',
      participants: [], labels: [], messages: [], lastMessageAt: 1, snippet: '', inInbox: true, hasOwnReply: false });
    await repo.upsertMessage(thr.rowId, {
      id: 'm1', rfcMessageId: '<m1@x>', references: ['<m0@x>'],
      from: { email: 'them@y.com' }, to: [{ email: 'me@x.com' }], cc: [], subject: 'Hi',
      bodyText: 'hello', bodyHtml: '<p>hello</p>', hasListUnsubscribe: true, date: 5, direction: 'inbound',
    });
    const [m] = await repo.listMessages(thr.rowId);
    expect(m.rfcMessageId).toBe('<m1@x>');
    expect(m.hasListUnsubscribe).toBe(true);
    expect(m.bodyHtml).toBe('<p>hello</p>');
  });

  it('creates and moves cards, and chooses a draft', async () => {
    const repo = mk();
    const acc = await repo.upsertAccount({ provider: 'gmail', email: 'me@x.com',
      ownEmail: 'me@x.com', tokenRef: 't', createdAt: 1 });
    const thr = await repo.upsertThread({ id: 'thr1', accountId: acc.rowId, subject: '', participants: [],
      labels: [], messages: [], lastMessageAt: 1, snippet: '', inInbox: true, hasOwnReply: false });
    const card = await repo.createCard(thr.rowId, 'untouched', 0, 10);
    await repo.moveCard(card.id, 'sent', 0, 20);
    expect((await repo.getCardByThread(thr.rowId))?.status).toBe('sent');
    const d1 = await repo.createDraft({ cardId: card.id, contactId: null, body: 'a', model: 'gemini',
      tone: 'professional', instruction: '', createdAt: 1 });
    const d2 = await repo.createDraft({ cardId: card.id, contactId: null, body: 'b', model: 'gemini',
      tone: 'friendly', instruction: 'shorter', createdAt: 2 });
    await repo.chooseDraft(d2.id, card.id);
    const drafts = await repo.listDrafts(card.id);
    expect(drafts.find((d) => d.id === d2.id)?.isChosen).toBe(true);
    expect(drafts.find((d) => d.id === d1.id)?.isChosen).toBe(false);
  });

  it('dedupes contacts and toggles do_not_contact', async () => {
    const repo = mk();
    await repo.upsertContact({ name: 'A', email: 'a@z.com', notes: '', doNotContact: false });
    await repo.upsertContact({ name: 'A2', email: 'a@z.com', notes: 'n', doNotContact: false });
    const c = await repo.getContactByEmail('a@z.com');
    expect(c?.name).toBe('A2');
    await repo.setDoNotContact('a@z.com', true);
    expect((await repo.getContactByEmail('a@z.com'))?.doNotContact).toBe(true);
  });

  it('records sends and answers rate/duplicate queries', async () => {
    const repo = mk();
    await repo.recordSend(1000, 'cold', 'x@z.com');
    await repo.recordSend(2000, 'cold', 'y@z.com');
    await repo.recordSend(3000, 'reply', 'x@z.com');
    expect(await repo.countSendsSince(1500, 'cold')).toBe(1);
    expect(await repo.hasColdSendTo('x@z.com')).toBe(true);
    expect(await repo.hasColdSendTo('reply-only@z.com')).toBe(false);
  });

  it('stores settings', async () => {
    const repo = mk();
    await repo.setSetting('rate_limit_per_day', '25');
    expect(await repo.getSetting('rate_limit_per_day')).toBe('25');
    expect(await repo.getSetting('missing')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test -- tests/db/repository.test.ts`
Expected: PASS (all tests).

- [ ] **Step 3: Commit**

```bash
git add tests/db/repository.test.ts
git commit -m "test: cover repository round-trips"
```

---

### Task 6: Settings service

**Files:**
- Create: `src/services/settings.ts`
- Test: `tests/services/settings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/services/settings.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { NodeRepository } from '../../src/db/nodeRepository';
import { SettingsService } from '../../src/services/settings';

describe('SettingsService', () => {
  it('returns documented defaults when unset', async () => {
    const s = new SettingsService(new NodeRepository(':memory:'));
    expect(await s.get('rate_limit_per_day')).toBe('25');
    expect(await s.get('rate_limit_per_minute')).toBe('3');
    expect(await s.get('ai_provider')).toBe('gemini');
    expect(await s.get('signature')).toBe('');
    expect(await s.get('mailing_address')).toBe('');
  });

  it('persists overrides over defaults', async () => {
    const repo = new NodeRepository(':memory:');
    const s = new SettingsService(repo);
    await s.set('mailing_address', '1 Main St');
    expect(await s.get('mailing_address')).toBe('1 Main St');
    const s2 = new SettingsService(repo);
    expect(await s2.get('mailing_address')).toBe('1 Main St');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/services/settings.test.ts`
Expected: FAIL — cannot find module `../../src/services/settings`.

- [ ] **Step 3: Implement**

Create `src/services/settings.ts`:
```ts
import type { Repository } from '../db/repository';

// Authoritative defaults from spec §6 "Settings keys".
export const SETTING_DEFAULTS: Record<string, string> = {
  display_name: '',
  own_email: '',
  signature: '',
  mailing_address: '',
  unsubscribe_line: '',
  unsubscribe_mailto: '',
  rate_limit_per_day: '25',
  rate_limit_per_minute: '3',
  ai_provider: 'gemini',
  ai_key_ref: '',
};

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export class SettingsService {
  constructor(private repo: Repository) {}

  async get(key: SettingKey): Promise<string> {
    const v = await this.repo.getSetting(key);
    return v ?? SETTING_DEFAULTS[key];
  }

  async getInt(key: SettingKey): Promise<number> {
    return Number(await this.get(key));
  }

  async set(key: SettingKey, value: string): Promise<void> {
    await this.repo.setSetting(key, value);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/services/settings.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/settings.ts tests/services/settings.test.ts
git commit -m "feat: add settings service with defaults"
```

---

### Task 7: Kanban state machine

**Files:**
- Create: `src/services/kanban.ts`
- Test: `tests/services/kanban.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/services/kanban.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { NodeRepository } from '../../src/db/nodeRepository';
import {
  ensureCardForThread, moveCard, reopenOnInbound, markSentReconciled,
} from '../../src/services/kanban';

async function setup() {
  const repo = new NodeRepository(':memory:');
  const acc = await repo.upsertAccount({ provider: 'gmail', email: 'me@x.com', ownEmail: 'me@x.com',
    tokenRef: 't', createdAt: 1 });
  const thr = await repo.upsertThread({ id: 'thr1', accountId: acc.rowId, subject: '', participants: [],
    labels: [], messages: [], lastMessageAt: 1, snippet: '', inInbox: true, hasOwnReply: false });
  return { repo, threadRowId: thr.rowId };
}

describe('kanban', () => {
  it('creates a new card as untouched and never resets an existing one', async () => {
    const { repo, threadRowId } = await setup();
    const c1 = await ensureCardForThread(repo, threadRowId, 5);
    expect(c1.status).toBe('untouched');
    await moveCard(repo, c1.id, 'review', 0);
    const c2 = await ensureCardForThread(repo, threadRowId, 5);
    expect(c2.id).toBe(c1.id);
    expect(c2.status).toBe('review');
  });

  it('marks a card sent on reconciliation', async () => {
    const { repo, threadRowId } = await setup();
    const c = await ensureCardForThread(repo, threadRowId, 5);
    await markSentReconciled(repo, c.id);
    expect((await repo.getCardByThread(threadRowId))?.status).toBe('sent');
  });

  it('reopens a sent card to untouched when a new inbound arrives', async () => {
    const { repo, threadRowId } = await setup();
    const c = await ensureCardForThread(repo, threadRowId, 5);
    await moveCard(repo, c.id, 'sent', 0);
    await reopenOnInbound(repo, threadRowId);
    expect((await repo.getCardByThread(threadRowId))?.status).toBe('untouched');
  });

  it('leaves review cards alone on inbound', async () => {
    const { repo, threadRowId } = await setup();
    const c = await ensureCardForThread(repo, threadRowId, 5);
    await moveCard(repo, c.id, 'review', 0);
    await reopenOnInbound(repo, threadRowId);
    expect((await repo.getCardByThread(threadRowId))?.status).toBe('review');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/services/kanban.test.ts`
Expected: FAIL — cannot find module `../../src/services/kanban`.

- [ ] **Step 3: Implement**

Create `src/services/kanban.ts`:
```ts
import type { Repository } from '../db/repository';
import type { Card, CardStatus } from '../domain/types';

export async function ensureCardForThread(
  repo: Repository, threadRowId: number, position: number, now = Date.now(),
): Promise<Card> {
  const existing = await repo.getCardByThread(threadRowId);
  if (existing) return existing;
  return repo.createCard(threadRowId, 'untouched', position, now);
}

export async function moveCard(
  repo: Repository, cardId: number, status: CardStatus, position: number, now = Date.now(),
): Promise<void> {
  await repo.moveCard(cardId, status, position, now);
}

export async function markSentReconciled(repo: Repository, cardId: number, now = Date.now()): Promise<void> {
  await repo.moveCard(cardId, 'sent', 0, now);
}

export async function reopenOnInbound(repo: Repository, threadRowId: number, now = Date.now()): Promise<void> {
  const card = await repo.getCardByThread(threadRowId);
  if (card && card.status === 'sent') await repo.moveCard(card.id, 'untouched', 0, now);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/services/kanban.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all tests pass (repository + settings + kanban).

- [ ] **Step 6: Commit**

```bash
git add src/services/kanban.ts tests/services/kanban.test.ts
git commit -m "feat: add kanban state machine with reconciliation"
```

---

### Task 8: Tauri shell + security config

**Files:**
- Create: `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`, `src-tauri/build.rs`
- Modify: `package.json`

- [ ] **Step 1: Verify Rust is installed**

Run: `rustc --version`
Expected: `rustc 1.xx.x`. If missing, install via `rustup` (see Prerequisites) before continuing.

- [ ] **Step 2: Add the Tauri CLI**

Run:
```bash
npm install -D @tauri-apps/cli@latest
```
Then add scripts to `package.json`:
```json
"tauri": "tauri"
```

- [ ] **Step 3: Initialize the Tauri shell**

Run:
```bash
npx tauri init --app-name ColdEmailAgentic --window-title ColdEmailAgentic \
  --frontend-dist ../dist --dev-url http://localhost:5173 \
  --before-dev-command "npm run dev" --before-build-command "npm run build"
```
Expected: creates `src-tauri/` with `Cargo.toml`, `tauri.conf.json`, `src/main.rs`, `build.rs`.

- [ ] **Step 4: Lock down the security config**

Edit `src-tauri/tauri.conf.json` so the `app.security` section is:
```json
"security": {
  "csp": "default-src 'self'; connect-src ipc: http://ipc.localhost; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'",
  "dangerousDisableAssetCspModification": false
}
```
(Network allowlisting for `tauri-plugin-http` is added in Plan 2 with the provider
hosts; no `http` plugin is installed yet, so nothing to scope here.)

- [ ] **Step 5: Verify the app launches**

Run:
```bash
npm run tauri dev
```
Expected: a window titled **ColdEmailAgentic** opens showing the default Vite
React page. Close it.

- [ ] **Step 6: Commit**

```bash
git add src-tauri package.json package-lock.json
git commit -m "chore: add tauri shell with locked-down csp"
```

---

## Self-Review

**Spec coverage (Plan 1 portion):**
- Spec §6 data model → Task 3 schema (all 8 tables, indexes, constraints). ✔
- Spec §6 settings keys → Task 6 `SETTING_DEFAULTS`. ✔
- Spec §6/§8.2/§8.6 card rules (create `untouched`, never reset, sent↔untouched) → Task 7. ✔
- Spec §7 domain types (`Message` incl. `bodyHtml`/`hasListUnsubscribe`, `Thread.labels`, `Contact.doNotContact`) → Task 2. ✔
- Spec §5 repository interface over `node:sqlite` → Tasks 4–5. ✔
- Spec §11 CSP → Task 8. (HTTP allowlist deferred to Plan 2 with real providers.) ✔

**Deferred to later plans (intentional):** `MailProvider`/`AiProvider` interfaces,
Gmail OAuth/sync (`historyId`), `buildMime`, `sendGuard`, prompt builder, all UI,
`tauri-plugin-sql` implementation, and setup docs.

**Placeholder scan:** none — every step has runnable code or an exact command.

**Type consistency:** `Card`, `Contact`, `Draft`, `Message`, `Thread` field names
match Task 2 → used unchanged in Tasks 4–7. Repository method names
(`getCardByThread`, `moveCard`, `countSendsSince`, `hasColdSendTo`) are identical
across interface, implementation, and tests.
