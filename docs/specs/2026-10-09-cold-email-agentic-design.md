# ColdEmailAgentic — Design Spec

Date: 2026-10-09
Status: Approved (pending spec review)
Owner: nthnp

## 1. Purpose

A local, single-user macOS desktop app that:

1. Surfaces inbox email threads as a **manual kanban** with three columns:
   `haven't touched`, `in review`, `sent`.
2. Lets the user click a card and have an **AI agent draft a reply** at the
   bottom of the screen, with **Regenerate** and tone controls until the draft
   fits the desired tone.
3. Lets the user compose **cold outreach** emails to people they have never
   emailed before, using the same draft/regenerate flow.
4. **Sends** drafts through the app (draft first, then explicit confirm-send).

The app is free to run (free AI tier), private by default (local database,
tokens in the OS keychain), and has no backend server.

## 2. Locked Decisions

| # | Decision |
|---|---|
| 1 | Stack: **Tauri v2** shell + **React + TypeScript + Vite** UI |
| 2 | Architecture: **JS-centric**; official Tauri plugins, minimal Rust |
| 3 | Local persistence: **SQLite** (`tauri-plugin-sql`) |
| 4 | Secrets: **Stronghold** (`tauri-plugin-stronghold`); tokens never in frontend |
| 5 | OAuth: PKCE with loopback redirect (`tauri-plugin-oauth`) |
| 6 | HTTP: `tauri-plugin-http` (bypasses CORS) |
| 7 | Drag-and-drop: **dnd-kit** |
| 8 | AI default: **Gemini `gemini-2.5-flash`** (free AI Studio key); Groq + Ollama behind one interface |
| 9 | Mail scope: **Gmail first**, Outlook later, same interface |
| 10 | Card granularity: **one card per thread** |
| 11 | Sync scope: **inbox only, last 90 days, cap 200 threads**; refresh on launch + manual button; **no background polling** |
| 12 | Draft trigger: **auto-generate on first open, cached**; Regenerate explicit |
| 13 | Reconciliation: detect **own latest reply** in a thread → move card to `sent` |
| 14 | Gmail identity: **one account**, primary send-as, configurable display name |
| 15 | Contacts: light **`contacts` table for manually-entered cold contacts only** |
| 16 | Cold compose: **modal flow**; card appears in `sent` only after sending |
| 17 | Signature: settings-managed **plain-text**, blank by default |
| 18 | Offline/errors: **no offline send queue**; banners; refresh tokens auto-renew; re-auth prompt |
| 19 | Testing: **Vitest unit tests** for adapters, prompt builder, state transitions; no e2e in v1 |
| 20 | Repo: name `ColdEmailAgentic`, bundle id `com.nthnp.coldemailagentic`, **npm**, git repo in this folder |
| 21 | Reply threading: **proper threaded reply** for cards (`In-Reply-To`, `References`, same thread, `Re:`); cold = new thread |
| 22 | Outgoing body: **plain text** |
| 23 | Incoming rendering: **sanitized HTML** (DOMPurify), remote images blocked by default, plain-text toggle |
| 24 | Draft history: **keep every variant**, variant switcher, "chosen" marker |
| 25 | Tone presets: **Professional, Friendly, Concise, Direct, Match-their-tone** + free-text nudge |
| 26 | Prompt budget: **last ~5 messages or ~4k tokens**, strip signature/quoted blocks |
| 27 | Quoted history in replies: **none** |
| 28 | Provider interfaces: **frozen** (see §7) |

## 3. Scope

### In scope (v1)
- Gmail connect via OAuth (PKCE, loopback).
- Sync inbox threads (90 days, cap 200) into local SQLite cache.
- Manual kanban board with drag-and-drop across three columns.
- Thread reader pane with sanitized HTML / plain-text toggle.
- AI reply drafting: auto-generate once per card, regenerate, tone presets,
  free-text instruction, variant history.
- Cold compose modal (name, email, notes, one line of context) reusing the
  draft/regenerate panel.
- Draft-then-confirm-send via Gmail API.
- Settings: display name, signature, AI provider + key, account management.

### Out of scope (later)
- Outlook / Microsoft Graph (interface reserved).
- CSV / bulk lead import, sequences, follow-up scheduling.
- Contact discovery / enrichment.
- Analytics, tracking pixels, open/click tracking.
- Multi-account, send-as aliases.
- Hosting, multi-user, sharing.
- HTML outgoing bodies, quoted history, attachments.
- Background polling / notifications.

## 4. Non-Functional Requirements

- **Free to run**: default AI must operate within a free tier. No paid API
  usage in v1.
- **Private**: email contents stay on-device except requests to the chosen AI
  provider and the mail provider. No telemetry.
- **Local-first**: board renders from SQLite; no server round-trip for UI.
- **Performant**: board with 200 cards must render and drag smoothly (<16ms
  frame budget during drag).
- **Safe sending**: no email leaves the account without an explicit
  confirm-send action. No offline queue.
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
│  mail/    GmailProvider (MailProvider), syncService         │
│  ai/      GeminiProvider (AiProvider), promptBuilder        │
│  state/   kanbanService, cardStore, draftStore              │
│  db/      migrations, repositories (tauri-plugin-sql)       │
│  secrets/ stronghold wrapper                                │
└───────────────▲──────────────────────────────────────────┘
                │ Rust shell (minimal)
                │  tauri-plugin-oauth, tauri-plugin-http,
                │  tauri-plugin-sql, tauri-plugin-stronghold
```

### Design principles
- Every adapter implements a **frozen interface** (§7) so Outlook and other AI
  models are drop-in.
- UI components are presentational; all data access goes through the service
  layer.
- No business logic in Rust; Rust is wiring/plugins only.

## 6. Data Model (SQLite)

```
accounts(id PK, provider TEXT, email TEXT, display_name TEXT, token_ref TEXT, created_at)
threads(id PK, account_id FK, provider_thread_id TEXT UNIQUE, subject TEXT,
        participants_json TEXT, last_message_at INT, snippet TEXT, has_own_reply INT)
messages(id PK, thread_id FK, provider_message_id TEXT UNIQUE, from_json TEXT,
         to_json TEXT, cc_json TEXT, subject TEXT, body_text TEXT, body_html TEXT,
         date INT, direction TEXT CHECK(direction IN ('inbound','outbound')))
cards(id PK, thread_id FK UNIQUE, status TEXT CHECK(status IN
      ('untouched','review','sent')), position INT, updated_at INT)
contacts(id PK, name TEXT, email TEXT, notes TEXT, created_at INT)
drafts(id PK, card_id FK NULL, contact_id FK NULL, body TEXT, model TEXT,
       tone TEXT, instruction TEXT, is_chosen INT DEFAULT 0, created_at INT)
settings(key PK, value TEXT)
```

Rules:
- A `card` is created with `status='untouched'` for each new thread and is
  **never auto-overwritten** except `untouched|review → sent` when an outbound
  message is detected (decision 13) or the app sends.
- `position` orders cards within a column; rewritten on drop.
- `drafts` accumulate; `is_chosen` marks the selected variant.

## 7. Frozen Interfaces

```ts
type TonePreset =
  | 'professional' | 'friendly' | 'concise' | 'direct' | 'match';

type Direction = 'inbound' | 'outbound';

interface Message {
  id: string;
  from: { name?: string; email: string };
  to: { name?: string; email: string }[];
  subject: string;
  bodyText: string;
  date: number;
  direction: Direction;
}

interface Thread {
  id: string;                 // provider thread id
  subject: string;
  participants: { name?: string; email: string }[];
  messages: Message[];
  lastMessageAt: number;
  snippet: string;
}

interface DraftInput {
  threadId?: string;          // present for replies
  to: { name?: string; email: string }[];
  subject: string;
  bodyText: string;
  inReplyTo?: string;         // message-id for threading
  references?: string[];
}

interface Contact {
  id: string;
  name: string;
  email: string;
  notes?: string;
}

interface MailProvider {
  auth(): Promise<void>;                       // runs OAuth, stores token
  isAuthed(): Promise<boolean>;
  listThreads(opts: { sinceDays: number; cap: number }): Promise<Thread[]>;
  getThread(id: string): Promise<Thread>;
  createDraft(input: DraftInput): Promise<{ draftId: string }>;
  send(input: DraftInput): Promise<{ messageId: string; threadId: string }>;
  findOwnLatestReply?(threadId: string): Promise<{ isReply: boolean }>;
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
  generate(req: GenerateRequest): Promise<string>;
}
```

## 8. Key Flows

### 8.1 Sync
1. On launch and on manual Refresh, call `mail.listThreads({ sinceDays: 90, cap: 200 })`.
2. Upsert `threads` and `messages`; never touch existing `cards.status` or
   `position` except via reconciliation.
3. For each incoming thread, if no card exists, insert `untouched` at the top.
4. Reconciliation: if `findOwnLatestReply` reports the user's latest message is
   outbound, move the card to `sent`.

### 8.2 Board
- Three columns query `cards` joined to `threads`, ordered by `position`.
- Drag between columns updates `status` + `position` transactionally.
- Every email starts in `haven't touched`.

### 8.3 Reply drafting
1. Click a card → reader opens, thread fetched/rendered (sanitized HTML,
   images blocked; plain-text toggle).
2. If no cached draft exists for the card, auto-generate one via `AiProvider`
   and persist it. Cached drafts render instantly on re-open.
3. Draft panel (bottom): editable textarea, tone chips, free-text instruction,
   Regenerate, variant switcher.
4. Regenerate appends a new `drafts` row (never overwrites); switch/restore is
   free.

### 8.4 Cold compose
1. "New contact" → modal: name, email, notes, one line of context (stored as
   the contact's `notes` and used as the prompt instruction).
2. Same draft/regenerate panel; sending creates a **new thread** (no
   `In-Reply-To`/`References`).
3. Saving the contact writes to `contacts`.

### 8.5 Send (draft → confirm)
1. Draft panel → **Save as draft**: `mail.createDraft(DraftInput)` (proper
   threading headers for replies).
2. **Confirm-send** button → `mail.send(DraftInput)`.
3. On success: store the outbound message in `messages`, then:
   - **Reply**: mark the existing card `sent`.
   - **Cold**: insert the new `thread` and a `sent` card for it.
4. Show a confirmation; a failed send leaves local state unchanged and shows an
   error banner.

## 9. AI Prompting

- Single system prompt: role, brevity, no-hallucination, ground responses in
  thread facts, no fabricated commitments, plain text, append configured
  signature.
- `match` tone: include the most recent inbound message and instruct the model
  to mirror register, length, and greeting.
- Free-text instruction is appended to the system/user message.
- Context budget: last ~5 messages or ~4k tokens; strip signatures/quoted
  blocks.
- Output is plain text; leading/trailing whitespace trimmed.
- Provider errors (rate limit, auth) surface as non-blocking toasts; the
  cached prior draft remains.

## 10. Prerequisites (user actions)

1. **Install Rust toolchain** (`rustup`) — required by Tauri; not currently
   installed.
2. **Google Cloud project**: enable Gmail API; configure OAuth consent screen
   (External, Testing); create an OAuth **Desktop** client; capture client ID
   (+ secret if required by the flow).
3. **Google AI Studio** free API key for Gemini.
4. Later: Azure app registration for Outlook (Graph).

Step-by-step instructions will live in `docs/setup.md` (authored during
implementation).

## 11. Security & Compliance

- OAuth 2.0 with PKCE; loopback redirect; minimal scopes
  (`gmail.readonly`, `gmail.compose`, `gmail.send`, `userinfo.email`).
- Tokens stored only in Stronghold; never logged or sent to the renderer in
  plaintext beyond what the API requires.
- Local SQLite file only; no sync/backup service.
- Cold outreach is legally regulated: v1 includes a configurable unsubscribe
  line and a soft rate guard, and the UI warns that cold email carries legal
  obligations. No automated bulk sending.

## 12. Testing Strategy

- **Vitest** unit tests for:
  - `GmailProvider` and `AiProvider` adapters against mocked HTTP.
  - `promptBuilder` (tone presets, context trimming, signature append).
  - `kanbanService` transitions (legal/illegal moves, reconciliation).
  - DB repositories against an in-memory SQLite.
- Manual integration against a throwaway Gmail account.
- No e2e UI tests in v1.

## 13. Acceptance Criteria

- [ ] Fresh clone + `npm install` + `npm run tauri dev` launches the app on
      macOS after prerequisites.
- [ ] Connecting Gmail completes OAuth and caches inbox threads.
- [ ] New threads appear as `haven't touched` cards; drag moves persist across
      restarts.
- [ ] Clicking a card auto-generates a reply draft once and caches it.
- [ ] Regenerate produces a new variant; prior variants remain selectable.
- [ ] Tone chips and free-text instruction change the output.
- [ ] Cold compose creates a contact and sends a new thread.
- [ ] Confirm-send sends via Gmail and moves the card to `sent`.
- [ ] Replying in Gmail directly moves the card to `sent` on next sync.
- [ ] Unit test suite passes (`npm test`).

## 14. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Free AI tier rate limits | Cache drafts; bounded context; clear rate-limit errors; Groq/Ollama fallback |
| OAuth setup friction | `docs/setup.md` click-by-click; Testing consent screen |
| Tauri/Rust toolchain absent | Prerequisite step 0 installs `rustup` |
| Accidental sends | Draft-then-confirm; no offline queue |
| Cold email legal exposure | Unsubscribe line, soft rate guard, warning copy |
| Nested git repo inside home repo | Standalone repo initialized in project folder; parent unaffected |
