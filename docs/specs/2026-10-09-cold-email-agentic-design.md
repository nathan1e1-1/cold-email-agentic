# ColdEmailAgentic — Design Spec

Date: 2026-10-09
Version: 2 (revised after review)
Status: Approved
Owner: nthnp

## Revision notes (v2)

v2 addresses a full review of v1. All v1 decisions remain unless superseded
below. Superseded items are marked **[v2]**.

- OAuth consent screen changed from Testing → **In production** (Testing =
  7-day refresh-token expiry).
- Send path changed from `createDraft` → `send` to **local-only draft →
  `messages.send`(raw MIME)**.
- `Message` gains `rfcMessageId`, `references`, `cc`; `accounts` gains
  `own_email`; `direction` is computed.
- Secret storage changed from Stronghold → **macOS Keychain (`keyring`)**.
- Privacy claims corrected; provider privacy disclosure + Ollama private mode.
- Cold-email guardrails: required mailing address, numeric rate limits,
  duplicate-send warning.
- Sync reworked: **`historyId` incremental sync** + tracked-thread refresh.
- Sent cards reopen on new inbound; auto-draft junk heuristics added.
- MIME construction spec'd; repository interface + Node test DB; CSP/HTTP
  allowlist/external links; prompt-injection handling.

## 1. Purpose

A local, single-user macOS desktop app that:

1. Surfaces inbox email threads as a **manual kanban** with three columns:
   `haven't touched`, `in review`, `sent`.
2. Lets the user click a card and have an **AI agent draft a reply** at the
   bottom of the screen, with **Regenerate** and tone controls until the draft
   fits the desired tone.
3. Lets the user compose **cold outreach** emails to people they have never
   emailed before, using the same draft/regenerate flow.
4. **Sends** drafts through the app (local draft first, then explicit
   confirm-send).

The app is free to run (free AI tier) and has no backend server. Email data is
stored locally on device; content is sent off-device only to the chosen mail
provider (Gmail) and the chosen AI provider, whose data-handling differs (see
§11). [v2]

## 2. Locked Decisions

| # | Decision |
|---|---|
| 1 | Stack: **Tauri v2** shell + **React + TypeScript + Vite** UI |
| 2 | Architecture: **JS-centric**; official Tauri plugins, minimal Rust |
| 3 | Local persistence: **SQLite** (`tauri-plugin-sql`) |
| 4 | Secrets: **macOS Keychain via `keyring`** (`keyring-core` + `apple-native-keyring-store`), called from the Rust layer; tokens never in frontend. **[v2]** |
| 5 | OAuth: PKCE with loopback redirect (`tauri-plugin-oauth`) |
| 6 | HTTP: `tauri-plugin-http` (bypasses CORS), **allowlisted to Google domains only** **[v2]** |
| 7 | Drag-and-drop: **dnd-kit** |
| 8 | AI default: **Gemini `gemini-2.5-flash`** (free AI Studio key); Groq + **Ollama** behind one interface; **Ollama = private mode** **[v2]** |
| 9 | Mail scope: **Gmail first**, Outlook later, same interface |
| 10 | Card granularity: **one card per thread** |
| 11 | Sync: **incremental via `historyId`**, full-sync fallback, tracked-thread refresh; **refresh on launch + manual button; no background polling** **[v2]** |
| 12 | Draft trigger: **auto-generate on first open, cached**; Regenerate explicit; **skipped for junk senders** **[v2]** |
| 13 | Reconciliation: detect **own latest reply** in a thread → move card to `sent`; **a new inbound after `sent` moves the card back to `untouched`** **[v2]** |
| 14 | Gmail identity: **one account**, primary send-as, configurable display name; **account stores `own_email`** **[v2]** |
| 15 | Contacts: light **`contacts` table for manually-entered cold contacts only**, **unique by email** **[v2]** |
| 16 | Cold compose: **modal flow**; card appears in `sent` only after sending |
| 17 | Signature: settings-managed **plain-text**, blank by default |
| 18 | Offline/errors: **no offline send queue**; banners; refresh tokens auto-renew; re-auth prompt |
| 19 | Testing: **Vitest unit tests** for adapters, prompt builder, MIME builder, state transitions; repository interface over DB, tested with `node:sqlite`; no e2e in v1 **[v2]** |
| 20 | Repo: name `ColdEmailAgentic`, bundle id `com.nthnp.coldemailagentic`, **npm**, git repo in this folder |
| 21 | Reply threading: **proper threaded reply** for cards (`In-Reply-To`, `References`, same thread, `Re:`); cold = new thread |
| 22 | Outgoing body: **plain text** |
| 23 | Incoming rendering: **sanitized HTML** (DOMPurify), remote images blocked by default, plain-text toggle |
| 24 | Draft history: **keep every variant**, variant switcher, "chosen" marker |
| 25 | Tone presets: **Professional, Friendly, Concise, Direct, Match-their-tone** + free-text nudge |
| 26 | Prompt budget: **last ~5 messages or ~4k tokens**, strip signature/quoted blocks |
| 27 | Quoted history in replies: **none** |
| 28 | Provider interfaces: **frozen** (see §7) |
| 29 | OAuth consent screen: **External + In production** (unverified; personal-use exemption <100 users). If the account is Google Workspace, use **Internal**. **[v2]** |
| 30 | Send path: **local-only draft in SQLite → `messages.send`(raw MIME)**; no Gmail draft created, no orphans. **[v2]** |
| 31 | Cold guardrails: **required mailing address**, block cold send when empty; **rate limit 25/day, 3/min**; unsubscribe line; duplicate-send warning **[v2]** |

## 3. Scope

### In scope (v1)
- Gmail connect via OAuth (PKCE, loopback), production consent screen.
- Incremental inbox sync (`historyId`, 90 days, cap 200) into local SQLite.
- Manual kanban board with drag-and-drop across three columns.
- Thread reader pane with sanitized HTML / plain-text toggle.
- AI reply drafting: auto-generate once per card (junk-aware), regenerate, tone
  presets, free-text instruction, variant history.
- Cold compose modal (name, email, notes, one line of context) reusing the
  draft/regenerate panel, with compliance guardrails.
- Local draft → confirm-send via Gmail `messages.send` (raw MIME).
- Settings: display name, own email, signature, mailing address, AI provider +
  key + privacy badge, account management, rate limits.

### Out of scope (later)
- Outlook / Microsoft Graph (interface reserved).
- CSV / bulk lead import, sequences, follow-up scheduling.
- Contact discovery / enrichment.
- Analytics, tracking pixels, open/click tracking.
- Multi-account, send-as aliases.
- Hosting, multi-user, sharing.
- HTML outgoing bodies, quoted history, attachments.
- Background polling / notifications.
- Creating drafts *in* Gmail (local drafts only in v1).

## 4. Non-Functional Requirements

- **Free to run**: default AI must operate within a free tier. No paid API
  usage in v1.
- **Local-first & honest privacy**: email data lives on-device; the board
  renders from SQLite with no server. Off-device transmission happens only to
  the mail provider and the selected AI provider. **[v2]** The app must not
  claim more privacy than the provider offers: free-tier Gemini content may be
  used to improve Google products and may be human-reviewed (see §11). The UI
  surfaces each provider's data-handling in Settings and via a badge on the
  draft panel.
- **Performant**: board with 200 cards renders and drags smoothly (<16ms frame
  budget). Sync uses incremental deltas and a concurrency cap of 5.
- **Safe sending**: no email leaves the account without an explicit
  confirm-send action. No offline queue. Cold sends are blocked without a
  mailing address and are rate-limited.
- **Recoverable**: tokens refresh automatically; expiry surfaces a re-auth
  prompt, never a silent failure.

## 5. Architecture

```
┌──────────────────────────────────────────────────────────┐
│ React + TS + Vite (renderer)                             │
│  Board (dnd-kit) │ Reader │ Draft panel │ Compose │ Settings │
└───────────────▲──────────────────────────────────────────┘
                │ Tauri commands / plugin APIs
┌───────────────┴──────────────────────────────────────────┐
│ TS service layer                                            │
│  mail/    GmailProvider (MailProvider), syncService, mime   │
│  ai/      GeminiProvider/OllamaProvider (AiProvider), prompt │
│  state/   kanbanService, cardStore, draftStore              │
│  db/      repository interface + tauri-sql impl + node test │
│  secrets/ keyring bridge (via Rust command)                 │
└───────────────▲──────────────────────────────────────────┘
                │ Rust shell (minimal)
                │  tauri-plugin-oauth, tauri-plugin-http (allowlist),
                │  tauri-plugin-sql, tauri-plugin-opener, keyring
```

### Design principles
- Every adapter implements a **frozen interface** (§7) so Outlook and other AI
  models are drop-in.
- UI components are presentational; all data access goes through the service
  layer.
- **Data access goes through a repository interface** so the same code runs in
  the app (`tauri-plugin-sql`) and in tests (`node:sqlite`). **[v2]**
- No business logic in Rust beyond secret storage, OAuth, and plugin wiring.

## 6. Data Model (SQLite)

```
accounts(id PK, provider TEXT, email TEXT, own_email TEXT, display_name TEXT,
         token_ref TEXT, history_id TEXT NULL, created_at INT)
threads(id PK, account_id FK, provider_thread_id TEXT UNIQUE, subject TEXT,
        participants_json TEXT, last_message_at INT, snippet TEXT,
        has_own_reply INT, in_inbox INT)
messages(id PK, thread_id FK, provider_message_id TEXT UNIQUE,
         rfc_message_id TEXT, references_json TEXT, from_json TEXT, to_json TEXT,
         cc_json TEXT, subject TEXT, body_text TEXT, body_html TEXT,
         date INT, direction TEXT CHECK(direction IN ('inbound','outbound')))
cards(id PK, thread_id FK UNIQUE, status TEXT CHECK(status IN
      ('untouched','review','sent')), position INT, updated_at INT)
contacts(id PK, name TEXT, email TEXT UNIQUE, notes TEXT, created_at INT)
drafts(id PK, card_id FK NULL, contact_id FK NULL, body TEXT, model TEXT,
       tone TEXT, instruction TEXT, is_chosen INT DEFAULT 0, created_at INT)
settings(key PK, value TEXT)
```

Rules:
- A `card` is created with `status='untouched'` for each new thread and is never
  auto-overwritten, **except**: `untouched|review → sent` when an outbound
  message is detected or the app sends (decision 13), and **`sent → untouched`
  when a new inbound message arrives after the send** (decision 13). [v2]
- **`direction` is computed** by comparing the message sender to
  `accounts.own_email` — never guessed from position. [v2]
- `threads.in_inbox` records whether the thread is currently in the inbox, so
  archived/cold threads can be retained and refreshed without being dropped.
  [v2]
- `position` orders cards within a column; rewritten on drop.
- `drafts` accumulate; `is_chosen` marks the selected variant.
- `contacts.email` is **unique** (dedupe). [v2]

## 7. Frozen Interfaces

```ts
type TonePreset =
  | 'professional' | 'friendly' | 'concise' | 'direct' | 'match';
type Direction = 'inbound' | 'outbound';

interface Address { name?: string; email: string }

interface Message {
  id: string;                 // provider-internal id
  rfcMessageId: string;       // RFC 822 Message-ID header  [v2]
  references: string[];       // RFC 822 References header  [v2]
  from: Address;
  to: Address[];
  cc: Address[];              // [v2]
  subject: string;
  bodyText: string;
  date: number;
  direction: Direction;       // computed from Account.ownEmail  [v2]
}

interface Thread {
  id: string;
  subject: string;
  participants: Address[];
  messages: Message[];
  lastMessageAt: number;
  snippet: string;
  inInbox: boolean;           // [v2]
}

interface Account {
  provider: 'gmail' | 'outlook';
  email: string;
  ownEmail: string;           // address used to compute direction  [v2]
  displayName?: string;
}

interface DraftInput {
  threadId?: string;
  to: Address[];
  cc?: Address[];
  subject: string;
  bodyText: string;
  inReplyTo?: string;         // Message-ID being replied to
  references?: string[];
}

interface Contact { id: string; name: string; email: string; notes?: string }

interface HistoryDelta {
  changedThreadIds: string[];
  nextHistoryId: string;
  expired: boolean;           // true when Gmail says historyId is too old
}

interface MailProvider {
  auth(): Promise<void>;
  isAuthed(): Promise<boolean>;
  listThreads(opts: { sinceDays: number; cap: number }): Promise<Thread[]>;
  listHistoryChanges(opts: { historyId: string }): Promise<HistoryDelta>;
  getThread(id: string): Promise<Thread>;
  getThreadsByIds(ids: string[]): Promise<Thread[]>;   // tracked refresh [v2]
  send(input: DraftInput): Promise<{ messageId: string; threadId: string }>;
  findOwnLatestReply(threadId: string): Promise<{ isReply: boolean }>;
}

type PrivacyClass = 'may-use-content' | 'local';

interface AiDescriptor {
  id: string;
  label: string;
  privacy: PrivacyClass;      // drives the privacy badge  [v2]
}

interface GenerateRequest {
  system: string;
  thread?: Thread;
  contact?: Contact;
  tone?: TonePreset;
  instruction?: string;
  priorDraft?: string;
}

interface AiProvider {
  descriptor: AiDescriptor;
  generate(req: GenerateRequest): Promise<string>;
}
```

## 8. Key Flows

### 8.1 Sync [v2]
1. On launch and on manual Refresh:
   - If `accounts.history_id` exists, call `listHistoryChanges({ historyId })`
     to get changed thread ids; if `expired`, fall back to a full
     `listThreads({ sinceDays: 90, cap: 200 })`.
   - Fetch changed threads with a **concurrency cap of 5** via `getThread` /
     `getThreadsByIds`.
2. Upsert `threads` and `messages`; update `in_inbox` and `has_own_reply`.
3. Additionally, **refresh every thread that has a card** (`getThreadsByIds`)
   even if it is no longer in the inbox, so cold/archived threads stay current.
4. New threads create `untouched` cards. Never overwrite existing `status` or
   `position` except via the reconciliation rules (8.6).
5. Persist the new `history_id`.

### 8.2 Board
- Three columns query `cards` joined to `threads`, ordered by `position`.
- Drag between columns updates `status` + `position` transactionally.
- Every email starts in `haven't touched`.

### 8.3 Reply drafting
1. Click a card → reader opens, thread rendered (sanitized HTML, images
   blocked; plain-text toggle).
2. If no cached draft exists **and** the thread is not junk (8.7), auto-generate
   one and persist it. Cached drafts render instantly on re-open.
3. Draft panel: editable textarea, tone chips, free-text instruction,
   Regenerate, variant switcher, provider **privacy badge**.
4. Regenerate appends a new `drafts` row (never overwrites).
5. Email content is passed to the model as **untrusted, delimited data** (8.9).

### 8.4 Cold compose
1. "New contact" → modal: name, email, notes, one line of context (stored as
   `notes`, used as the prompt instruction).
2. **Guardrails**: if a mailing address is unset, cold send is blocked; if the
   address was already emailed, show a duplicate warning; contact is deduped by
   email.
3. Same draft/regenerate panel; sending creates a **new thread** (no
   `In-Reply-To`/`References`).

### 8.5 Send (local draft → confirm)
1. The draft lives **only in SQLite** until sent. There is no Gmail draft. [v2]
2. **Confirm-send** → build RFC 2822 MIME (§8.8) → `mail.send(DraftInput)`.
3. On success: store the outbound message in `messages`, then:
   - **Reply**: mark the existing card `sent`.
   - **Cold**: insert the new thread and a `sent` card.
4. Failed send leaves local state unchanged and shows an error banner.

### 8.6 Reconciliation
- On sync: if `findOwnLatestReply` shows the user's latest message is outbound,
  move the card to `sent`.
- If a **new inbound** arrives after the card is `sent`, move it back to
  `untouched`. [v2]

### 8.7 Auto-draft junk heuristics [v2]
Skip auto-generation when: a `List-Unsubscribe` header is present; the From
address matches `no-reply`/`noreply`/`donotreply`/role patterns; or the thread
is categorized by Gmail as `promotions`/`social`/`updates`. Manual **Generate**
always remains available.

### 8.8 MIME construction [v2]
`buildMime(input: DraftInput): string` produces an RFC 2822 message:
- Headers: `From`, `To`, `Cc`, `Subject` (RFC 2047 encoded when non-ASCII),
  `Message-ID`, `Date`, `In-Reply-To`, `References`, `MIME-Version`,
  `Content-Type: text/plain; charset=utf-8`, `Content-Transfer-Encoding: base64`,
  plus `List-Unsubscribe`/`List-Unsubscribe-Post` for cold sends.
- Body serialized, then base64url-encoded for `messages.send`.
- Newline normalization to CRLF. Unit-tested independently.

### 8.9 Prompt-injection handling [v2]
- Email content is inserted into the prompt inside explicit delimiters and
  labeled as untrusted; the system prompt instructs the model to treat it as
  data and ignore any instructions inside it.
- Model output is **text only** and never triggers an action automatically; the
  human review + confirm-send step is the control boundary.

## 9. AI Prompting

- Single system prompt: role, brevity, no-hallucination, ground responses in
  thread facts, no fabricated commitments, plain text, append configured
  signature, and the §8.9 injection guard.
- `match` tone: include the most recent inbound message and instruct the model
  to mirror register, length, and greeting.
- Free-text instruction is appended to the system/user message.
- Context budget: last ~5 messages or ~4k tokens; strip signatures/quoted
  blocks.
- Provider errors (rate limit, auth) surface as non-blocking toasts; the cached
  prior draft remains.

## 10. Prerequisites (user actions)

1. **Install Rust toolchain** (`rustup`) — required by Tauri; not currently
   installed.
2. **Google Cloud project**: enable Gmail API; configure the OAuth consent
   screen as **External**; **publish to production** (stay unverified for
   personal use, <100 users; choose **Internal** instead if the account is
   Workspace); create an OAuth **Desktop** client; capture client ID.
3. **Google AI Studio** free API key for Gemini (with the §11 warning).
4. Optional: install **Ollama** and pull a model for private mode.
5. Later: Azure app registration for Outlook (Graph).

Step-by-step instructions will live in `docs/setup.md` (authored during
implementation).

## 11. Security, Privacy & Compliance

- OAuth 2.0 with PKCE; loopback redirect; minimal scopes (`gmail.readonly`,
  `gmail.compose`, `gmail.send`, `userinfo.email`).
- **Secrets**: OAuth tokens stored in the **macOS Keychain** via `keyring`,
  accessed only through a Rust command; never logged or exposed to the renderer
  as plaintext beyond API use. [v2]
- **Provider privacy disclosure** [v2]:
  - Free-tier **Gemini**: Google uses prompts/responses to improve its products
    and human reviewers may read them; the app must warn and show a
    `may-use-content` badge, and Settings must state it plainly.
  - **Ollama** (local): `local` badge; no off-device transmission.
  - Paid Gemini/Groq: document their terms when added.
- **Tauri security** [v2]: set a strict CSP; restrict the `http` plugin
  allowlist to `https://*.googleapis.com` and
  `https://generativelanguage.googleapis.com`; open links in email bodies via
  `tauri-plugin-opener` in the external browser, never in the webview.
- **Cold-email compliance** (hygiene, not legal advice) [v2]: require a
  **mailing address** setting and block cold sends without it; require an
  unsubscribe line; rate-limit to **25/day and 3/min**; warn on
  already-emailed addresses. No automated bulk sending.
- Local SQLite file only; no sync/backup service.

## 12. Testing Strategy [v2]

- **Vitest** unit tests for:
  - `GmailProvider` / AI adapters against mocked HTTP.
  - `promptBuilder` (tone presets, context trimming, signature, injection
    delimiters).
  - `buildMime` (RFC 2047 subjects, CRLF normalization, header assembly,
    base64url output).
  - `kanbanService` transitions (legal/illegal moves, `sent → untouched`
    reopen, reconciliation).
  - Synchronization logic (history delta handling, `expired` fallback, tracked
    threads).
- **DB tests** run through a repository interface backed by **`node:sqlite`**
  (no Tauri runtime required). The app uses `tauri-plugin-sql` behind the same
  interface.
- Manual integration against a throwaway Gmail account. No e2e UI tests in v1.

## 13. Acceptance Criteria

- [ ] Fresh clone + `npm install` + `npm run tauri dev` launches on macOS after
      prerequisites.
- [ ] Connecting Gmail completes OAuth **against a production consent screen**
      and caches inbox threads.
- [ ] New threads appear as `haven't touched` cards; drag moves persist across
      restarts.
- [ ] Clicking a card auto-generates a reply draft once and caches it; junk
      senders do not auto-generate but can be generated manually.
- [ ] Regenerate produces a new variant; prior variants remain selectable.
- [ ] Tone chips and free-text instruction change the output.
- [ ] Cold compose creates a contact, blocks send without a mailing address,
      warns on duplicate addresses, and sends a new thread.
- [ ] Confirm-send sends via Gmail `messages.send` and moves the card to `sent`;
      no draft is created in Gmail.
- [ ] A new inbound on a `sent` thread moves the card back to `untouched`.
- [ ] Replying in Gmail directly moves the card to `sent` on next sync.
- [ ] Sync after the first run uses `historyId` and refreshes only changed +
      tracked threads.
- [ ] The privacy badge reflects the active AI provider and Settings displays
      its data-handling terms.
- [ ] Unit test suite passes (`npm test`).

## 14. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Free AI tier rate limits | Cache drafts; bounded context; numeric send limits; Groq/Ollama fallback |
| Free-tier AI privacy exposure | Honest disclosure + `may-use-content` badge; Ollama private mode |
| OAuth setup friction | `docs/setup.md`; production consent screen; personal-use exemption |
| 7-day token expiry | Production publishing status (decision 29) |
| Tauri/Rust toolchain absent | Prerequisite step 0 installs `rustup` |
| Stronghold deprecation | Use macOS Keychain (`keyring`) instead (§11) |
| `historyId` too old | Detect `expired` → full resync |
| Accidental sends | Local draft + confirm-send; no offline queue; rate limits |
| Orphan/duplicate Gmail drafts | Local-only drafts; `messages.send` (decision 30) |
| Prompt injection | Delimit untrusted content; text-only output; human confirm |
| Cold email legal exposure | Mailing address required; unsubscribe; rate limits; warnings |
| Nested git repo inside home repo | Standalone repo in project folder; parent unaffected |
