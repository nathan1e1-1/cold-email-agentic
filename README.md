# ColdEmailAgentic

A local, single-user macOS desktop app for **cold outreach and inbox triage**, with an AI
agent that drafts the emails.

- **Compose** — type a recipient in the Inbox, and the agent drafts a first-touch email you can
  regenerate and tune before sending.
- **Board** — drag threads between *Haven't touched / In review / Sent* (persisted locally).
- **Inbox** — read threads like a real mail client and draft replies with tone chips and a
  nudge/regenerate loop.
- **Guardrails** — sends honor opt-outs and are rate-limited (25/day, 3/min).
- **Private & local** — email data lives in local SQLite; OAuth tokens and API keys live in
  a local `0600` file; no backend server.

## Requirements

- macOS (Apple Silicon), Node 20+, and the Rust toolchain (`rustup`).
- A Google Cloud **OAuth Desktop client** (Gmail API enabled).
- A free **Groq** key (default) and/or **Gemini** key for drafting.

Full click-by-click setup: **[docs/setup.md](docs/setup.md)**.

## Develop

```bash
npm install
npm run tauri dev
```

Then open **Settings** in the app's sidebar and paste your Google Client ID / secret and AI
key (or copy `.env.example` → `.env`).

## Build

```bash
npm run tauri build
```

Produces an unsigned `.app` under `src-tauri/target/release/bundle/` (the configured
target is `app`; add `dmg` to `bundle.targets` in `src-tauri/tauri.conf.json` if you want
an installer). Because it isn't signed/notarized, macOS Gatekeeper will warn on first
launch — right-click → Open.

## Test

```bash
npm test          # unit tests (Vitest)
npm run typecheck # tsc -b
npm run lint
```

The same checks run in CI on every pull request (`.github/workflows/ci.yml`).

## Known limitations

- The Inbox is **cold outreach + replies only**; there is no All-mail view, by design. See
  [Inbox simplification](docs/specs/2026-10-24-inbox-simplification.md).
- The `from:` query covers cold recipients from the **last 30 days**. Replies to **known
  cold threads** are additionally matched directly, which works for sends recorded with a
  Gmail thread id.
- Cold emails sent **from Gmail web** (not the app) have no local `sends` row and cannot be
  matched by either Inbox path. Sends recorded before the `thread_id` migration cannot be
  matched by the known-thread path; recent recipients may still be caught by the 30-day
  `from:` query.
- Auto-refresh runs while the window is visible (about every 60 seconds). Focus and
  visibility changes trigger the same throttled check. Background or hidden windows do not
  poll.
- AI drafting sends the thread and prompt content to the configured provider
  (Gemini or Groq).
- The app is local and single-user. There is no backend, multi-user auth, or app-level
  remote sync.

## License

Personal project; no license file included.
