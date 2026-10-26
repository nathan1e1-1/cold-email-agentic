# Outreach-only Inbox and Board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Default the Inbox to threads where a cold-emailed contact replied (with an All-mail toggle), keep the Board outreach-only, and start recording `sends.thread_id` for a future exact-thread path.

**Architecture:** A pure `src/mail/outreach.ts` owns normalisation, the inbound-from-recipient predicate, and query building. `GmailMailboxAdapter.listThreads` gains an `outreachRecipients` mode (single query, cap 20, paginated; chunked overflow fallback). `Repository` gains `listColdRecipients()` and `recordSend(..., threadId?)`. `App` owns `inboxMode`; `BoardView` filters through the same predicate.

**Tech Stack:** TypeScript (strict), Vitest (`node:sqlite`), React, Gmail API via the existing `MailProvider`, `@tauri-apps/plugin-sql` repository.

**Spec:** `docs/specs/2026-10-21-outreach-inbox.md`

**Verification boundary:** tasks marked **[agent]** are unit-tested and run in CI; **[human]** tasks need the GUI and are verified by the user in `npm run tauri dev`.

**Quota constants (verified):** 6,000 units/min/user/project; `threads.list` = 10; `threads.get` = 40 (120 with `format=full`). Outreach page = 20 full threads ≈ 2,400 units.

---

### Task 1 — Schema + repository: `thread_id`, `ColdRecipient`, `listColdRecipients` **[agent]**

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/db/repository.ts`
- Modify: `src/db/nodeRepository.ts`
- Modify: `src/db/tauriRepository.ts`
- Test: `tests/db/repository.test.ts`

- [ ] **Step 1: Add the shared type** to `src/domain/types.ts`:

```ts
export interface ColdRecipient {
  email: string;
  lastSentAt: number;
}
```

- [ ] **Step 2: Add migration 3** to `src/db/schema.ts` and append it to `MIGRATIONS`:

```ts
const MIGRATION_3 = `
ALTER TABLE sends ADD COLUMN thread_id TEXT;
`;

export const MIGRATIONS: readonly string[] = [MIGRATION_1, MIGRATION_2, MIGRATION_3];
```

- [ ] **Step 3: Extend the `Repository` interface** (`src/db/repository.ts`):

```ts
recordSend(sentAt: number, kind: SendKind, toEmail: string, threadId?: string): Promise<void>;
/** Distinct cold recipients (lowercased), newest cold send first, excluding the account's own address. */
listColdRecipients(): Promise<ColdRecipient[]>;
```

Import `ColdRecipient` from `../domain/types` in `repository.ts`, `nodeRepository.ts`, and `tauriRepository.ts`.

- [ ] **Step 4: Implement in `nodeRepository.ts`** — replace `recordSend` and add `listColdRecipients`:

```ts
async recordSend(sentAt: number, kind: SendKind, toEmail: string, threadId?: string): Promise<void> {
  this.run(
    'INSERT INTO sends (sent_at,kind,to_email,thread_id) VALUES (?,?,?,?)',
    sentAt, kind, normEmail(toEmail), threadId ?? null,
  );
}

async listColdRecipients(): Promise<ColdRecipient[]> {
  const rows = this.all<{ email: string; last_sent_at: number }>(
    `SELECT lower(to_email) AS email, MAX(sent_at) AS last_sent_at
       FROM sends WHERE kind='cold'
      GROUP BY lower(to_email)
      ORDER BY last_sent_at DESC`,
  );
  const account = await this.getAccount();
  const own = account ? normEmail(account.ownEmail) : null;
  return rows
    .map((r) => ({ email: normEmail(r.email), lastSentAt: Number(r.last_sent_at) }))
    .filter((r) => r.email !== own);
}
```

- [ ] **Step 5: Mirror it in `tauriRepository.ts`** (await `this.all` / `this.getAccount`):

```ts
async recordSend(sentAt: number, kind: SendKind, toEmail: string, threadId?: string): Promise<void> {
  await this.db.execute(
    'INSERT INTO sends (sent_at,kind,to_email,thread_id) VALUES (?,?,?,?)',
    [sentAt, kind, normEmail(toEmail), threadId ?? null],
  );
}

async listColdRecipients(): Promise<ColdRecipient[]> {
  const rows = await this.all<{ email: string; last_sent_at: number }>(
    `SELECT lower(to_email) AS email, MAX(sent_at) AS last_sent_at
       FROM sends WHERE kind='cold'
      GROUP BY lower(to_email)
      ORDER BY last_sent_at DESC`,
  );
  const account = await this.getAccount();
  const own = account ? normEmail(account.ownEmail) : null;
  return rows
    .map((r) => ({ email: normEmail(r.email), lastSentAt: Number(r.last_sent_at) }))
    .filter((r) => r.email !== own);
}
```

- [ ] **Step 6: Add tests** to `tests/db/repository.test.ts`:

```ts
it('lists distinct cold recipients, newest first, excluding the account address', async () => {
  const repo = mk();
  await seedAccount(repo); // me@x.com
  await repo.recordSend(1000, 'cold', ' A@Z.com ', 'thr-1');
  await repo.recordSend(2000, 'cold', 'b@z.com', 'thr-2');
  await repo.recordSend(3000, 'cold', 'a@z.com', 'thr-3');
  await repo.recordSend(4000, 'reply', 'replyonly@z.com');
  await repo.recordSend(5000, 'cold', 'me@x.com', 'thr-self');

  expect(await repo.listColdRecipients()).toEqual([
    { email: 'a@z.com', lastSentAt: 3000 },
    { email: 'b@z.com', lastSentAt: 2000 },
  ]);
});

it('persists the sent thread id on the send row', async () => {
  const repo = mk();
  await repo.recordSend(1000, 'cold', 'a@z.com', 'thr-1');
  const db = (repo as unknown as { db: DatabaseSync }).db;
  const row = db.prepare('SELECT thread_id FROM sends ORDER BY id DESC LIMIT 1').get() as { thread_id: string };
  expect(row.thread_id).toBe('thr-1');
});
```

- [ ] **Step 7: Verify**

```bash
npm test -- tests/db/repository.test.ts
npm run typecheck
```

Expected: all pass; `user_version` is now 3 (the existing idempotency test already asserts `MIGRATIONS.length`).

---

### Task 2 — Pure outreach helpers **[agent]**

**Files:**
- Create: `src/mail/outreach.ts`
- Test: `tests/mail/outreach.test.ts`

- [ ] **Step 1: Write the failing tests** in `tests/mail/outreach.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  normalizeEmail, isOutreachThread, recentRecipientEmails,
  buildOutreachQuery, chunkRecipientQueries,
  OUTREACH_QUERY_BUDGET,
} from '../../src/mail/outreach';
import type { Thread } from '../../src/domain/types';

function thread(from: string, direction: 'inbound' | 'outbound' = 'inbound'): Thread {
  return {
    id: 't1', subject: 's', participants: [{ email: from }], labels: [],
    lastMessageAt: 1, snippet: '', inInbox: true,
    messages: [{
      id: 'm1', rfcMessageId: '', references: [], from: { email: from },
      to: [], cc: [], subject: 's', bodyText: '', hasListUnsubscribe: false,
      date: 1, direction,
    }],
  };
}

const recipients = new Set(['a@z.com', 'b@z.com']);

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  A@Z.com ')).toBe('a@z.com');
  });
});

describe('isOutreachThread', () => {
  it('matches an inbound message from a recipient, case-insensitively', () => {
    expect(isOutreachThread(thread('A@Z.com'), recipients)).toBe(true);
  });
  it('rejects outbound-only messages', () => {
    expect(isOutreachThread(thread('a@z.com', 'outbound'), recipients)).toBe(false);
  });
  it('rejects an unrelated sender', () => {
    expect(isOutreachThread(thread('stranger@z.com'), recipients)).toBe(false);
  });
});

describe('recentRecipientEmails', () => {
  it('keeps only sends inside the window', () => {
    const now = 100 * 86_400_000;
    const list = [
      { email: 'old@z.com', lastSentAt: now - 31 * 86_400_000 },
      { email: 'new@z.com', lastSentAt: now - 1 * 86_400_000 },
    ];
    expect(recentRecipientEmails(list, now)).toEqual(['new@z.com']);
  });
});

describe('buildOutreachQuery', () => {
  it('quotes, dedupes, and lowercases recipients', () => {
    expect(buildOutreachQuery(['A@Z.com', 'a@z.com', 'b@z.com']))
      .toBe('(from:"a@z.com" OR from:"b@z.com")');
  });
  it('drops invalid addresses and returns empty for no valid input', () => {
    expect(buildOutreachQuery(['not-an-email', 'a b@z.com'])).toBe('');
  });
});

describe('chunkRecipientQueries', () => {
  it('splits into queries no longer than the budget', () => {
    const many = Array.from({ length: 500 }, (_, i) => `person${i}@example.com`);
    const queries = chunkRecipientQueries(many);
    expect(queries.length).toBeGreaterThan(1);
    for (const q of queries) expect(q.length).toBeLessThanOrEqual(OUTREACH_QUERY_BUDGET);
  });
});
```

- [ ] **Step 2: Run and confirm red**

```bash
npm test -- tests/mail/outreach.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/mail/outreach.ts`**

```ts
import type { ColdRecipient, Thread } from '../domain/types';

export const OUTREACH_WINDOW_DAYS = 30;
export const OUTREACH_CAP = 20;
export const OUTREACH_QUERY_BUDGET = 6000;

const EMAIL = /^[^\s@"(),:;<>]+@[^\s@"(),:;<>]+\.[^\s@"(),:;<>]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isOutreachThread(thread: Thread, recipients: ReadonlySet<string>): boolean {
  return thread.messages.some(
    (m) => m.direction === 'inbound' && recipients.has(normalizeEmail(m.from.email)),
  );
}

export function recentRecipientEmails(
  recipients: ColdRecipient[], now: number, days = OUTREACH_WINDOW_DAYS,
): string[] {
  const cutoff = now - days * 86_400_000;
  return recipients.filter((r) => r.lastSentAt >= cutoff).map((r) => r.email);
}

export function uniqueRecipients(emails: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const email = normalizeEmail(raw);
    if (!EMAIL.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

export function buildOutreachQuery(emails: string[]): string {
  const valid = uniqueRecipients(emails);
  if (valid.length === 0) return '';
  return `(${valid.map((e) => `from:"${e}"`).join(' OR ')})`;
}

export function chunkRecipientQueries(
  emails: string[], budget = OUTREACH_QUERY_BUDGET,
): string[] {
  const valid = uniqueRecipients(emails);
  const queries: string[] = [];
  let chunk: string[] = [];
  for (const email of valid) {
    const candidate = buildOutreachQuery([...chunk, email]);
    if (chunk.length > 0 && candidate.length > budget) {
      queries.push(buildOutreachQuery(chunk));
      chunk = [];
    }
    chunk.push(email);
  }
  if (chunk.length > 0) queries.push(buildOutreachQuery(chunk));
  return queries;
}
```

- [ ] **Step 4: Verify green**

```bash
npm test -- tests/mail/outreach.test.ts
npm run typecheck
npm run lint
```

---

### Task 3 — `MailboxProvider` + `GmailMailboxAdapter` outreach mode **[agent]**

**Files:**
- Modify: `src/services/mailbox.ts`
- Modify: `src/mail/mailProvider.ts`
- Modify: `src/mail/gmailProvider.ts`
- Modify: `src/services/gmailMailboxAdapter.ts`
- Test: `tests/mail/gmailProvider.test.ts`
- Test: `tests/services/gmailMailboxAdapter.test.ts`

- [ ] **Step 1: Extend the interface** in `src/services/mailbox.ts`:

```ts
export interface ThreadQueryOptions {
  pageToken?: string;
  /** Present → outreach mode. Empty array means "no cold recipients yet". */
  outreachRecipients?: string[];
}

export interface SentNewEmail {
  message: Message;
  threadId: string;
}

export interface MailboxProvider {
  connect(): Promise<Account>;
  isConnected(): boolean;
  listThreads(opts?: ThreadQueryOptions): Promise<ThreadPage>;
  getThread(id: string): Promise<Thread | null>;
  send(threadId: string, body: string): Promise<Message>;
  sendNew(input: NewEmailInput): Promise<SentNewEmail>;
}
```

- [ ] **Step 2: Add `inInbox` to the mail provider**

In `src/mail/mailProvider.ts`, extend the `listThreads` options:

```ts
listThreads(opts: {
  sinceDays: number; cap: number; query?: string; pageToken?: string; inInbox?: boolean;
}): Promise<ListThreadsResult>;
```

In `src/mail/gmailProvider.ts`, replace the query construction inside `listThreads`:

```ts
const base = opts.inInbox === false
  ? [`newer_than:${opts.sinceDays}d`, '-in:spam', '-in:trash']
  : [`in:inbox newer_than:${opts.sinceDays}d`];
const q = encodeURIComponent([base.join(' '), opts.query].filter(Boolean).join(' '));
```

Add to `tests/mail/gmailProvider.test.ts`:

```ts
it('omits in:inbox and excludes spam/trash when inInbox is false', async () => {
  const http = router();
  await provider(http).listThreads({
    sinceDays: 30, cap: 20, query: '(from:"a@z.com")', inInbox: false,
  });
  const q = new URL(http.requests[0].url).searchParams.get('q') ?? '';
  expect(q).toContain('newer_than:30d');
  expect(q).toContain('-in:spam');
  expect(q).toContain('-in:trash');
  expect(q).not.toContain('in:inbox');
});

it('keeps in:inbox by default', async () => {
  const http = router();
  await provider(http).listThreads({ sinceDays: 90, cap: 20 });
  expect(new URL(http.requests[0].url).searchParams.get('q')).toContain('in:inbox');
});
```

Match the existing fixture/helper names in that test file (it already asserts on `q`).

- [ ] **Step 3: Write the failing adapter tests** (append to `tests/services/gmailMailboxAdapter.test.ts`). Give `fakeProvider` a `calls` array capturing `opts`:

```ts
it('outreach mode with no recipients makes no provider call', async () => {
  let calls = 0;
  const { provider } = fakeProvider({
    listThreads: async () => { calls++; return { threads: [thread], seededHistoryId: '1', nextPageToken: null }; },
  });
  const adapter = new GmailMailboxAdapter(() => provider);
  await adapter.connect();
  expect(await adapter.listThreads({ outreachRecipients: [] }))
    .toEqual({ threads: [], nextPageToken: null });
  expect(calls).toBe(0);
});

it('outreach mode passes the from-query, 30-day window, cap, and page token', async () => {
  const seen: unknown[] = [];
  const { provider } = fakeProvider({
    listThreads: async (opts) => { seen.push(opts); return { threads: [thread], seededHistoryId: '1', nextPageToken: 'next' }; },
  });
  const adapter = new GmailMailboxAdapter(() => provider);
  await adapter.connect();
  const page = await adapter.listThreads({
    outreachRecipients: ['sarah@acme.com'], pageToken: 'p2',
  });
  expect(seen[0]).toEqual({
    sinceDays: 30, cap: 20, query: '(from:"sarah@acme.com")', pageToken: 'p2', inInbox: false,
  });
  expect(page.nextPageToken).toBe('next');
});

it('skips an empty page when a next-page token exists', async () => {
  const seen: string[] = [];
  const { provider } = fakeProvider({
    listThreads: async (opts) => {
      seen.push(opts.pageToken ?? 'first');
      if (!opts.pageToken) {
        return { threads: [], seededHistoryId: '1', nextPageToken: 'p2' };
      }
      return { threads: [thread], seededHistoryId: '1', nextPageToken: 'p3' };
    },
  });
  const adapter = new GmailMailboxAdapter(() => provider);
  await adapter.connect();
  const page = await adapter.listThreads({ outreachRecipients: ['sarah@acme.com'] });
  expect(seen).toEqual(['first', 'p2']);
  expect(page.threads.map((t) => t.id)).toEqual(['t1']);
  expect(page.nextPageToken).toBe('p3');
});

it('outreach overflow merges, dedupes, sorts newest first, and caps at 20', async () => {
  const seen: unknown[] = [];
  const { provider } = fakeProvider({
    listThreads: async (opts) => {
      seen.push(opts);
      const base = (opts.query ?? '').length;
      return {
        threads: Array.from({ length: 3 }, (_, i) => ({
          ...thread,
          id: `t-${base}-${i}`,
          lastMessageAt: base + i,
        })),
        seededHistoryId: '1',
        nextPageToken: null,
      };
    },
  });
  const adapter = new GmailMailboxAdapter(() => provider);
  await adapter.connect();
  const many = Array.from({ length: 500 }, (_, i) => `person${i}@example.com`);
  const page = await adapter.listThreads({ outreachRecipients: many });

  expect(seen.length).toBeGreaterThan(1);
  expect(page.nextPageToken).toBeNull();
  expect(page.threads.length).toBeLessThanOrEqual(20);
  const ids = page.threads.map((t) => t.id);
  expect(new Set(ids).size).toBe(ids.length);
  const dates = page.threads.map((t) => t.lastMessageAt);
  expect(dates).toEqual([...dates].sort((a, b) => b - a));
});
```

- [ ] **Step 4: Run and confirm red**

```bash
npm test -- tests/services/gmailMailboxAdapter.test.ts tests/mail/gmailProvider.test.ts
```

- [ ] **Step 5: Implement in `gmailMailboxAdapter.ts`**

Imports (also import `ThreadQueryOptions` and `SentNewEmail` from `./mailbox`):
```ts
import type { MailboxProvider, NewEmailInput, SentNewEmail, ThreadPage, ThreadQueryOptions } from './mailbox';
import {
  buildOutreachQuery, chunkRecipientQueries,
  OUTREACH_CAP, OUTREACH_QUERY_BUDGET, OUTREACH_WINDOW_DAYS,
} from '../mail/outreach';
```

Replace `listThreads`:
```ts
async listThreads(opts?: ThreadQueryOptions): Promise<ThreadPage> {
  const provider = this.requireProvider();
  const recipients = opts?.outreachRecipients;

  if (recipients === undefined) {
    const page = await provider.listThreads({
      sinceDays: 90, cap: 20, pageToken: opts?.pageToken,
    });
    return { threads: page.threads, nextPageToken: page.nextPageToken ?? null };
  }

  const query = buildOutreachQuery(recipients);
  if (!query) return { threads: [], nextPageToken: null };

  if (query.length <= OUTREACH_QUERY_BUDGET) {
    const args = {
      sinceDays: OUTREACH_WINDOW_DAYS, cap: OUTREACH_CAP, query, inInbox: false,
    };
    let page = await provider.listThreads({ ...args, pageToken: opts?.pageToken });
    // A page can be empty while a token exists; skip up to 3 dead pages.
    for (let attempt = 0; page.threads.length === 0 && page.nextPageToken && attempt < 3; attempt++) {
      page = await provider.listThreads({ ...args, pageToken: page.nextPageToken });
    }
    return { threads: page.threads, nextPageToken: page.nextPageToken ?? null };
  }

  const queries = chunkRecipientQueries(recipients);
  const perChunk = Math.max(1, Math.floor(OUTREACH_CAP / queries.length));
  const seen = new Set<string>();
  const merged: Thread[] = [];
  for (const chunk of queries) {
    if (merged.length >= OUTREACH_CAP) break;
    const { threads } = await provider.listThreads({
      sinceDays: OUTREACH_WINDOW_DAYS, cap: perChunk, query: chunk, inInbox: false,
    });
    for (const thread of threads) {
      if (seen.has(thread.id)) continue;
      seen.add(thread.id);
      merged.push(thread);
    }
  }
  merged.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  return { threads: merged.slice(0, OUTREACH_CAP), nextPageToken: null };
}
```

Replace `sendNew` return:
```ts
async sendNew(input: NewEmailInput): Promise<SentNewEmail> {
  const provider = this.requireProvider();
  const ownEmail = this.account?.ownEmail ?? '';
  const result = await provider.send({
    to: [input.to],
    subject: input.subject,
    bodyText: input.bodyText,
    listUnsubscribeMailto: input.listUnsubscribeMailto,
  });
  return {
    threadId: result.threadId,
    message: {
      id: result.messageId,
      rfcMessageId: '',
      references: [],
      from: { email: ownEmail },
      to: [input.to],
      cc: [],
      subject: input.subject,
      bodyText: input.bodyText,
      hasListUnsubscribe: Boolean(input.listUnsubscribeMailto),
      date: Date.now(),
      direction: 'outbound',
    },
  };
}
```

Update the existing `sendNew` test to destructure:
```ts
const { message, threadId } = await adapter.sendNew({ ... });
expect(message.subject).toBe('Hello');
expect(threadId).toBe('t1');
```

- [ ] **Step 6: Verify**

```bash
npm test -- tests/services/gmailMailboxAdapter.test.ts tests/mail/gmailProvider.test.ts
npm run typecheck
npm run lint
```

---

### Task 4 — Record the sent thread ID from Outreach **[agent]**

**Files:**
- Modify: `src/views/OutreachView.tsx`

- [ ] **Step 1: Capture the result** at the `mailbox.sendNew` call (currently line ~112). Replace the awaited call and the `recordSend`:

```ts
const { threadId } = await mailbox.sendNew({
  to: { name: name.trim() || undefined, email: email.trim() },
  subject: subject.trim() || '(no subject)',
  bodyText: fullBody,
  listUnsubscribeMailto: `mailto:${ownEmail}?subject=unsubscribe`,
});
await repo.upsertContact({ name: name.trim(), email: email.trim(), notes: context.trim(), doNotContact: false });
await repo.recordSend(Date.now(), 'cold', email.trim(), threadId);
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck
npm run lint
npm test
```

---

### Task 5 — `App`: inbox mode, fetch, persist filter **[agent/human]**

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add mode state and the fetch helper**

```ts
// module scope, above `function App()`
type InboxMode = 'outreach' | 'all';

// inside App, with the other state
const [inboxMode, setInboxMode] = useState<InboxMode>('outreach');
```

Add imports:
```ts
import { isOutreachThread, recentRecipientEmails } from './mail/outreach';
```

- [ ] **Step 2: Replace `persistThreads`** with an outreach-only version (keeps the account upsert):

```ts
async function persistThreads(r: Repository, acc: Account, list: Thread[]): Promise<void> {
  const accountRow = await r.upsertAccount({
    provider: 'gmail', email: acc.email, ownEmail: acc.ownEmail, tokenRef: 'gmail', createdAt: Date.now(),
  });
  // Full, unwindowed set: older leads must keep their cards.
  const recipients = new Set((await r.listColdRecipients()).map((c) => c.email));
  for (const thread of list) {
    if (!isOutreachThread(thread, recipients)) continue;
    const saved = await r.upsertThread({ ...thread, accountId: accountRow.rowId });
    for (const message of thread.messages) await r.upsertMessage(saved.rowId, message);
    await ensureCardForThread(r, saved.rowId);
  }
}
```

- [ ] **Step 3: Add `fetchInbox`** (recipients are read fresh on every fetch):

```ts
const fetchInbox = useCallback(async (
  box: MailboxProvider, r: Repository, mode: InboxMode, pageToken?: string,
): Promise<ThreadPage> => {
  if (mode === 'all') return box.listThreads({ pageToken });
  // Windowed set — used ONLY to build the Gmail query.
  const recipients = recentRecipientEmails(await r.listColdRecipients(), Date.now());
  return box.listThreads({ pageToken, outreachRecipients: recipients });
}, []);
```

Import `type ThreadPage` from `./services/mailbox`.

- [ ] **Step 4: Rewire `connect()`** — get the repo before listing so outreach recipients exist:

```ts
const r = await getRepository();
setRepo(r);
setBusy('Loading threads…');
const page = await fetchInbox(box, r, inboxMode);
setThreads(page.threads);
setNextPageToken(page.nextPageToken);
setBusy(null);
await persistThreads(r, acc, page.threads);
setBoardVersion((v) => v + 1);
```

(Keep the existing error handling and `openThread` call.)

- [ ] **Step 5: Rewire `loadMore`**

```ts
const loadMore = useCallback(async () => {
  if (!mailbox || !repo || !nextPageToken) return;
  setBusy('Loading more…');
  try {
    const page = await fetchInbox(mailbox, repo, inboxMode, nextPageToken);
    setThreads((prev) => [...prev, ...page.threads]);
    setNextPageToken(page.nextPageToken);
    if (account) {
      await persistThreads(repo, account, page.threads);
      setBoardVersion((v) => v + 1);
    }
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  } finally {
    setBusy(null);
  }
}, [mailbox, repo, account, inboxMode, nextPageToken, fetchInbox]);
```

- [ ] **Step 6: Add the mode switch handler**

```ts
const switchInboxMode = useCallback(async (mode: InboxMode) => {
  if (!mailbox || !repo) return;
  setInboxMode(mode);
  setSelected(null); setSelectedId(null); setThreads([]); setNextPageToken(null);
  setBusy('Loading threads…'); setError(null);
  try {
    const page = await fetchInbox(mailbox, repo, mode);
    setThreads(page.threads);
    setNextPageToken(page.nextPageToken);
    if (account) await persistThreads(repo, account, page.threads);
    setBoardVersion((v) => v + 1);
    if (page.threads.length > 0) await openThread(mailbox, page.threads[0].id);
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  } finally {
    setBusy(null);
  }
}, [mailbox, repo, account, fetchInbox, openThread]);
```

- [ ] **Step 7: Pass mode to `ThreadList`** (see Task 6) and use `inboxMode` in the empty state.

- [ ] **Step 8: Verify**

```bash
npm run typecheck
npm run lint
npm run build
```

---

### Task 6 — `ThreadList`: segmented toggle + empty state **[human]**

**Files:**
- Modify: `src/components/ThreadList.tsx`
- Modify: `src/App.css` (optional, reuse existing chip classes)

- [ ] **Step 1: Extend props**

```ts
interface Props {
  threads: Thread[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  mode: 'outreach' | 'all';
  onModeChange: (mode: 'outreach' | 'all') => void;
  emptyText: string;
}
```

- [ ] **Step 2: Render the toggle and title** in `list-head` / below it:

```tsx
<div className="list-head">
  {mode === 'outreach' ? 'Outreach replies' : 'Inbox'} <span className="count">{visible.length}</span>
</div>
<div className="list-search">
  <button
    type="button"
    className={mode === 'outreach' ? 'chip active' : 'chip ghost'}
    onClick={() => onModeChange('outreach')}
  >
    Outreach replies
  </button>
  <button
    type="button"
    className={mode === 'all' ? 'chip active' : 'chip ghost'}
    onClick={() => onModeChange('all')}
  >
    All mail
  </button>
</div>
<div className="list-search">
  <input type="search" ... />
</div>
```

- [ ] **Step 3: Empty state** after the `<ul>`:

```tsx
{visible.length === 0 && <p className="hint">{emptyText}</p>}
```

- [ ] **Step 4: Wire from `App`**:

```tsx
<ThreadList
  ...
  mode={inboxMode}
  onModeChange={(m) => void switchInboxMode(m)}
  emptyText={
    inboxMode === 'outreach'
      ? 'No replies from your outreach yet — email someone from Outreach.'
      : 'No mail to show.'
  }
/>
```

- [ ] **Step 5: Verify** `npm run typecheck && npm run lint && npm run build`; manually check the toggle in `npm run tauri dev`.

---

### Task 7 — `BoardView`: outreach-only **[agent/human]**

**Files:**
- Modify: `src/views/BoardView.tsx`

- [ ] **Step 1: Filter both threads and cards through the shared predicate**

```ts
import { isOutreachThread } from '../mail/outreach';
import type { Card } from '../domain/types';

const load = useCallback(async () => {
  if (!repo) return;
  // Full, unwindowed set: a lead from six weeks ago still belongs on the Board.
  const [threads, cards, recipients] = await Promise.all([
    repo.listThreads(), repo.listCards(), repo.listColdRecipients(),
  ]);
  const set = new Set(recipients.map((r) => r.email));
  const visible = threads.filter((t) => isOutreachThread(t, set));
  const visibleIds = new Set(visible.map((t) => t.rowId));
  return { threads: visible, cards: cards.filter((c) => visibleIds.has(c.threadRowId)) };
}, [repo]);
```

Use `load()` in both the effect and `reload()`; `onDragEnd` still calls `repo.moveCard` then `reload()`.

- [ ] **Step 2: Verify** `npm run typecheck && npm run lint && npm run build`.

---

### Task 8 — Full verification + manual checklist **[agent/human]**

- [ ] **Step 1: Run everything**

```bash
npm test
npm run typecheck
npm run lint
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 2: Manual (`npm run tauri dev`)**
  - Fresh account with no cold sends → Inbox shows the outreach empty state.
  - Send a cold email to yourself (or a test address), reply from that address → the reply appears under **Outreach replies**.
  - Toggle **All mail** → unrelated mail appears; toggle back → only outreach remains.
  - With >20 outreach replies, **Load more** appends a page.
  - After browsing All mail, the Board contains no cards for unrelated threads.
  - A thread opened from All mail still renders and can be replied to.

- [ ] **Step 3: Commit/PR only when the user asks.**

---

## Self-review notes

- Spec coverage: recipients source (T1), window/query/predicate (T2), cap+pagination+overflow+`inInbox:false`+empty-page skip (T3), thread_id recording (T1/T3/T4), two recipient sets + outreach-only persistence (T5), UI toggle/empty state (T6), Board (T7), tests/manual (T8).
- **Two sets:** `fetchInbox` windows recipients for the query only; `persistThreads` and `BoardView` use the full `listColdRecipients()` set.
- Quota re-verified against the live page: 6,000 units/min/user, `threads.get` 40 (120 full) — cap 20 stands.
- `listThreads()` with no arguments keeps All-mail behaviour for `scripts/draft.ts` and existing tests.
- `ColdRecipient` lives in `domain/types.ts` so `mail/outreach.ts` does not import from `db/`.
