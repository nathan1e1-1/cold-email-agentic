# Outreach-only Inbox and Board

Status: proposed · 2026-10-21

## Goal

The Inbox should default to conversations where someone I cold-emailed has
written back. A toggle reveals all mail. The Board (kanban) should contain only
outreach conversations — no cards for unrelated inbox mail.

## Non-goals

- Fetching exact sent threads by stored thread ID (we will start recording the ID,
  but nothing will read it yet).
- Alias / plus-address matching.
- Backfilling `thread_id` for sends made before this change.
- Dashboard changes.
- Deleting legacy DB rows/cards.

## Current behaviour (verified)

- Inbox: live Gmail `in:inbox newer_than:90d`, `threads.get?format=full`, cap 20,
  paginated with `pageToken`.
- Cold sends are recorded by `OutreachView.send()` as
  `sends(kind='cold', to_email)` plus a `contacts` upsert. `upsertContact` has
  exactly one call site — the same cold-send path — so `contacts` adds nothing
  that `sends` does not already have.
- Board: reads `repo.listThreads()` + `repo.listCards()`; every synced thread gets
  a card.
- The provider always prefixes `in:inbox`; the caller's `query` is appended
  (`src/mail/gmailProvider.ts:110`).
- Gmail quota (verified on the live quota page, 2026-10-21): **6,000
  units/min/user/project**; `threads.list` = 10; `threads.get` = 40 (**120**
  with `format=full`). Cap 20 full threads ≈ 2,400 units. (Older tables showed
  `threads.get` = 10 with no `full` multiplier; the current table does not.)

## Decisions

1. **Cold recipients = `sends WHERE kind='cold'`**, normalised and excluding the
   account's own address. Do not union `contacts`.
2. **Recipient window = 30 days** on the *send* date. Replies to older sends are
   visible in All mail but not in Outreach replies.
3. **Outreach reply window = 30 days** (`newer_than:30d` in the Gmail query).
4. **Cap 20 per page + pagination.** Not 50: 50 × 120 = 6,000 units, the whole
   per-minute budget. Pagination removes the silent ceiling without raising the
   per-load cost.
5. **One query on the normal path**, so Gmail's newest-first order and
   `pageToken` ordering are correct; no cross-chunk merge is needed.
6. **Overflow fallback only** when the query exceeds a ~6 KB budget: chunk the
   recipients, cap each chunk at `max(1, floor(20 / chunkCount))`, merge/dedupe,
   then sort by `lastMessageAt` (available after fetching) and keep 20. No
   pagination in this rare mode; the UI labels it "newest replies".
7. **One definition of an outreach thread** used by the query, the persistence
   filter, and the Board: a thread with an **inbound** message whose `from`
   address is a cold recipient. (`from:` and the predicate now agree; a thread
   we merely sent to, or a note to ourselves, no longer qualifies.)
8. **Persist outreach threads only.** Browsing All mail never creates cards.
   The Board filters legacy cards through the same predicate, so old irrelevant
   cards disappear without deleting rows.
9. **Record `sends.thread_id` now** for future exact-thread fetching.
10. **Two recipient sets.** The **full** `listColdRecipients()` set drives the
    predicate used by persistence and the Board. Only the **windowed** set
    (`recentRecipientEmails`, 30 days) is used to build the Gmail query. So a
    lead messaged six weeks ago keeps their card, and a reply opened from All
    mail to an older send still gets persisted and carded.
11. **Outreach ignores `in:inbox`.** `MailProvider.listThreads` gains
    `inInbox?: boolean` (default `true`). Outreach passes `false`, producing
    `newer_than:30d -in:spam -in:trash <from-query>` — so a reply archived in
    Gmail still appears. All mail keeps `in:inbox`.
12. **Skip empty pages.** If a page has zero threads but a `nextPageToken`, the
    adapter fetches up to 3 more pages before returning, so "Load more" never
    lands on a dead page. Fewer-than-cap pages are normal and still show
    "Load more" when a token exists.

## Data model

Migration 3:

```sql
ALTER TABLE sends ADD COLUMN thread_id TEXT;
```

`ColdRecipient` is added to `src/domain/types.ts` (shared by mail and db layers):

```ts
export interface ColdRecipient {
  email: string;      // lowercased, trimmed
  lastSentAt: number; // MAX(sent_at) for that address
}
```

Repository additions (`src/db/repository.ts`):

```ts
recordSend(sentAt: number, kind: SendKind, toEmail: string, threadId?: string): Promise<void>;
listColdRecipients(): Promise<ColdRecipient[]>;
```

`listColdRecipients` returns distinct addresses from `sends` where
`kind = 'cold'`, grouped by lowercased `to_email`, ordered by `lastSentAt` DESC,
with the account's `own_email` removed case-insensitively. If no account row
exists, nothing is excluded (there cannot be sends without an account in this
single-account app).

`GmailMailboxAdapter.sendNew` changes to return
`{ message: Message; threadId: string }` (type `SentNewEmail`, declared in
`src/services/mailbox.ts`); `OutreachView` passes `threadId` to `recordSend`.
Replies (`send`) already know their thread ID and are unchanged.

## Pure helpers — `src/mail/outreach.ts`

- `normalizeEmail(email: string): string` — trim + lowercase.
- `isOutreachThread(thread: Thread, recipients: ReadonlySet<string>): boolean` —
  true iff some message has `direction === 'inbound'` and
  `recipients.has(normalizeEmail(message.from.email))`.
- `recentRecipientEmails(recipients: ColdRecipient[], now: number, days = 30): string[]`
  — filter by `lastSentAt >= now - days * 86_400_000`, return the emails.
- `buildOutreachQuery(emails: string[]): string` — keep only addresses matching
  `/^[^\s@"(),:;<>]+@[^\s@"(),:;<>]+\.[^\s@"(),:;<>]+$/`, dedupe, and join as
  `(from:"a@x" OR from:"b@y")`. Empty input → `''`.
- Constants: `OUTREACH_WINDOW_DAYS = 30`, `OUTREACH_CAP = 20`,
  `OUTREACH_QUERY_BUDGET = 6000` (applied to the raw `from:` clause length, not
  the URL-encoded request).

## Mailbox API

`ThreadQueryOptions` is declared in `src/services/mailbox.ts`:

```ts
interface ThreadQueryOptions {
  pageToken?: string;
  outreachRecipients?: string[];
}
listThreads(opts?: ThreadQueryOptions): Promise<ThreadPage>;
```

`MailProvider.listThreads` gains `inInbox?: boolean` (default `true`):

```ts
listThreads(opts: {
  sinceDays: number; cap: number; query?: string; pageToken?: string; inInbox?: boolean;
}): Promise<ListThreadsResult>;
```

Gmail query construction:

```ts
const base = opts.inInbox === false
  ? [`newer_than:${opts.sinceDays}d`, '-in:spam', '-in:trash']
  : [`in:inbox newer_than:${opts.sinceDays}d`];
const q = [base.join(' '), opts.query].filter(Boolean).join(' ');
```

- **All mail** (`outreachRecipients === undefined`): `sinceDays: 90`, cap 20,
  `inInbox` default true, `pageToken` passthrough.
- **Outreach** (`outreachRecipients` present):
  - empty → `{ threads: [], nextPageToken: null }`, no Gmail call;
  - `buildOutreachQuery` within budget → `sinceDays: 30`, cap 20, `inInbox: false`,
    `query`, `pageToken` passthrough (pagination works);
  - over budget → chunked fetch per decision 6, `nextPageToken: null`.
    `perChunk = max(1, floor(20 / chunkCount))`; chunks are fetched sequentially,
    stopping once 20 threads have accumulated (so the total never exceeds 20).
- **Empty-page skip** (decision 12) applies to the single-query path: while
  `threads.length === 0 && nextPageToken && attempts < 3`, fetch the next page
  and replace the result. The adapter returns the last page it fetched.

## UI

- `App`: `inboxMode: 'outreach' | 'all'`, default `'outreach'`, not persisted.
- Connect and mode switches refetch; selection is cleared.
- `ThreadList` renders a segmented control in the list header
  (**Outreach replies** / **All mail**) and adjusts the header title/count.
- Empty outreach state: "No replies from your outreach yet — email someone from
  Outreach."
- "Load more" renders whenever `nextPageToken !== null`.
- `fetchInbox` is the **only** caller that windows recipients: it maps
  `recentRecipientEmails(...)` into `outreachRecipients` for the query.
- `persistThreads` builds its set from the **full** `listColdRecipients()`
  before upsert/cards.
- `BoardView` likewise loads the **full** `listColdRecipients()` and filters
  threads + cards through the same predicate.

## Error handling

- No cold recipients → empty state, zero Gmail calls.
- Invalid-looking addresses are dropped from the query.
- Overflow mode is labelled in the UI, not silent.

## Testing

- `tests/mail/outreach.test.ts`: normalisation; predicate (inbound only,
  case-insensitive, outbound-only rejected, unrelated sender rejected);
  recent-recipient filter; query quoting/dedupe/invalid-drop/empty; chunk split
  under budget.
- `tests/db/repository.test.ts`: `recordSend` persists `thread_id`;
  `listColdRecipients` is distinct, normalised, uses `MAX(sent_at)`, sorted, and
  excludes `own_email`.
- `tests/mail/gmailProvider.test.ts`: `inInbox: false` builds
  `newer_than:Nd -in:spam -in:trash` with no `in:inbox`; the default keeps
  `in:inbox`.
- `tests/services/gmailMailboxAdapter.test.ts`: empty recipients makes no
  provider call; outreach passes `query`, `sinceDays: 30`, `inInbox: false`;
  page token passthrough; an empty page with a token auto-advances (bounded);
  overflow merges, dedupes, sorts, and caps at 20.
- Manual (`npm run tauri dev`): toggle, empty state, pagination, Board after
  browsing All mail.

## Risks

- A recipient's client may break Gmail threading; `from:` still matches the
  reply as its own thread.
- Replies from an alias/plus-address are missed (same limitation in both paths).
- Replies to sends older than 30 days are hidden in Outreach replies.
- Legacy cards are hidden, not deleted.
