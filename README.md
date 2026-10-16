# ColdEmailAgentic

A local, single-user macOS desktop app for **cold outreach and inbox triage**, with an AI
agent that drafts the emails.

- **Outreach** — add a contact (name, email, one line of context), and the agent drafts a
  first-touch email (subject + body) you can regenerate and tune before sending.
- **Board** — drag threads between *Haven't touched / In review / Sent* (persisted locally).
- **Inbox** — read threads like a real mail client and draft replies with tone chips and a
  nudge/regenerate loop.
- **Compliance guardrails** — cold sends require a mailing address, honor opt-outs, are
  rate-limited (25/day, 3/min), and carry a `mailto:` unsubscribe.
- **Private & local** — email data lives in local SQLite; OAuth tokens live in the macOS
  Keychain; no backend server.

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

Produces an unsigned `.app` (and `.dmg`) under `src-tauri/target/release/bundle/`. Because
it isn't signed/notarized, macOS Gatekeeper will warn on first launch — right-click → Open.

## Test

```bash
npm test          # unit tests (Vitest)
npm run typecheck # tsc -b
npm run lint
```

The same checks run in CI on every pull request (`.github/workflows/ci.yml`).

## License

Personal project; no license file included.
