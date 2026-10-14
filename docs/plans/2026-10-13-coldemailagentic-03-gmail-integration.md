# ColdEmailAgentic — Plan 3: Gmail Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect a real Gmail account (OAuth + macOS Keychain), read threads, send a threaded reply, and wire it into the existing screen — behind `sendGuard`.

**Architecture:** A real `GmailProvider` (spec `MailProvider`) over an injectable `HttpClient` (Tauri HTTP in the app, a fake in tests), a `GmailMailboxAdapter` exposing the UI's `MailboxProvider`, a `syncService` (first-run full sync + `historyId` deltas + per-thread skip), and a small Rust keychain command. OAuth is PKCE + loopback.

**Tech Stack:** TypeScript (strict), Vitest, existing `Repository`/`SettingsService`/`src/mail/*`, Tauri v2 (`tauri-plugin-oauth`, `tauri-plugin-http`, `keyring` crate), React.

**Spec:** `docs/specs/2026-10-09-cold-email-agentic-design.md` (v3) — §8.1, §8.5, §10, §11.

**Verification boundary:** tasks marked **[agent]** are unit-tested and run in CI; tasks marked **[human]** require the Google client + GUI and are verified by the user running the app.

---

## Task 0 — `docs/setup.md` **[agent]**

**Files:** Create `docs/setup.md`.

Write the click-by-click prerequisites:
1. Install Rust (`rustup`).
2. Google Cloud: create a project → enable **Gmail API** → OAuth consent screen **External**, publish to **In production** (unverified is fine for personal use, <100 users; use **Internal** if Workspace) → create an OAuth **Desktop** client → copy the **client ID**.
3. Scopes requested by the app: `gmail.readonly`, `gmail.send`, `userinfo.email`.
4. Google AI Studio: create a free API key (with the §11 privacy warning).
5. Optional: install **Ollama** for private mode.

Verify: `npm run lint` still passes (docs don't affect it); commit.

---

## Task 1 — Keychain secret store (Rust + JS) **[agent/human]**

**Files:** Modify `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`; create `src/services/secrets.ts`.

- Add the `keyring` crate; implement three Tauri commands: `secret_set(key, value)`, `secret_get(key) -> Option<String>`, `secret_delete(key)` using the macOS Keychain service `com.nthnp.coldemailagentic`.
- `src/services/secrets.ts` wraps `invoke` with `getSecret/setSecret/deleteSecret`.
- **Verify [agent]:** `cargo check --manifest-path src-tauri/Cargo.toml` passes; `npm run typecheck` passes.
- **Verify [human]:** in the app, setting then reading a secret round-trips.

---

## Task 2 — OAuth PKCE module **[agent]**

**Files:** Create `src/mail/oauth.ts`; test `tests/mail/oauth.test.ts`.

- `createPkce()` → `{ verifier, challenge }` (S256, base64url of SHA-256).
- `buildAuthUrl({ clientId, redirectUri, challenge, scopes })`.
- `exchangeCode({ code, verifier, clientId, redirectUri }, http)` → tokens via injected `HttpClient`; `refreshAccessToken({ refreshToken, clientId }, http)`.
- Tests (mocked HTTP + a fixed verifier): challenge matches a known vector; auth URL contains PKCE params; token responses parse; refresh parses.

---

## Task 3 — HttpClient (Tauri + fake) **[agent]**

**Files:** Create `src/mail/httpClient.ts` (interface — already implied by Plan 2 usage), `src/mail/tauriHttp.ts` (impl via `@tauri-apps/plugin-http`), and a `FakeHttpClient` in `tests/mail/fakeHttp.ts`.

- Interface: `request({ method, url, headers, body? }) -> { status, body }`.
- `TauriHttpClient` delegates to the plugin `fetch`.
- **Verify [agent]:** `FakeHttpClient` supports queued responses; used by Tasks 2/4 tests.

---

## Task 4 — `GmailProvider` **[agent]**

**Files:** Create `src/mail/gmailProvider.ts`; test `tests/mail/gmailProvider.test.ts`.

Implements the spec `MailProvider` (defined in `src/mail/mailProvider.ts`) over `HttpClient` + a token provider:
- `getProfile()` → `{ emailAddress, historyId }`.
- `listThreads({ sinceDays, cap })` → `{ threads, seededHistoryId }` (messages.list → threads.get each, concurrency 5, parse via `gmailParse`).
- `getThread(id)` → parse `threads.get`.
- `listHistoryChanges({ historyId })` → deltas; HTTP 404 → `expired: true`.
- `getThreadsByIds(ids)` → parse each.
- `send(DraftInput)` → `buildMime` → `messages.send` with `raw` + `threadId`; returns `{ messageId, threadId }`.
- `findOwnLatestReply(threadId)` → latest message direction.
- Tests (FakeHttpClient): URLs/headers correct; parsing via fixtures; 404 → expired; send builds the expected request body; pagination.

---

## Task 5 — `GmailMailboxAdapter` **[agent]**

**Files:** Create `src/services/gmailMailboxAdapter.ts`; test `tests/services/gmailMailboxAdapter.test.ts`.

Implements the UI `MailboxProvider` over a `MailProvider`: `connect()` (runs OAuth), `isConnected()`, `listThreads()` (maps `listThreads` result), `getThread(id)`, `send(threadId, body)` (maps to `DraftInput` with `to`/`subject`/`inReplyTo`/`references` derived from the thread).
- Tests with a fake `MailProvider`.

---

## Task 6 — Per-thread `historyId` (migration 2) **[agent]**

**Files:** Modify `src/db/schema.ts`, `src/db/repository.ts`, `src/db/nodeRepository.ts`, `src/mail/gmailParse.ts`; tests updated.

- Add `MIGRATION_2` adding `threads.history_id TEXT`.
- `RepoThread` gains `historyId: string | null`; `upsertThread` stores it; `mapThread` reads it.
- `parseThread` surfaces `historyId` (from the thread resource).
- Tests: migration bumps `user_version` to 2 and adds the column; round-trip.

---

## Task 7 — `syncService` **[agent]**

**Files:** Create `src/mail/sync.ts`; test `tests/mail/sync.test.ts`.

- First run: `listThreads` → upsert threads/messages → `ensureCardForThread` → store account `historyId` + per-thread `historyId`.
- Subsequent: `listHistoryChanges` → fetch changed threads (concurrency 5); on `expired`, full resync; **skip threads whose stored `historyId` is unchanged**.
- Reconciliation via `applyReconcile`.
- `onProgress?: (done, total) => void`.
- Tests: fake `MailProvider` + `NodeRepository` (first run, delta, expired fallback, per-thread skip, reconcile).

---

## Task 8 — UI wiring: toggle, progress, guarded send **[agent/human]**

**Files:** Modify `src/App.tsx`, `src/App.css`; create `src/services/providerFactory.ts`.

- Account toggle: **Mock** vs **Gmail (connect)**; provider chosen by `providerFactory`.
- Progress UI during sync (threads fetched / total).
- Send path runs `sendGuard(repo, settings, { kind, toEmail, now })` before `provider.send`; blocks with a message on failure; records a `sends` row on success.
- **Verify [agent]:** typecheck/lint/build.
- **Verify [human]:** steps below.

---

## Task 9 — Live verification **[human]**

1. Create the Google client per `docs/setup.md`.
2. `npm run tauri dev` → **Connect Gmail** → consent → the header shows your address.
3. The thread list renders real inbox threads; open one and read it.
4. Send a **threaded reply to yourself**; confirm it appears in the same Gmail thread.
5. Try a cold compose without a mailing address → blocked by `sendGuard`.

---

## Self-Review
- **Spec coverage:** §8.1 sync (Task 7), §8.5 send + guard (Tasks 4, 8), §10 prerequisites (Task 0), §11 keychain + scopes + token lifecycle (Tasks 1, 2).
- **Deferred:** `historyId` deltas are implemented (Task 7) but the per-thread skip is an optimization on the full-list path; AI drafting and the full kanban UI are later plans.
- **Type consistency:** `MailProvider`/`DraftInput`/`HistoryDelta` come from Plan 2's spec shape; `MailboxProvider` is the existing UI interface.
