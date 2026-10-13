# ColdEmailAgentic — Setup

Step-by-step prerequisites for running the app with a real Gmail account.

## 1. Install the Rust toolchain

Tauri needs Rust. Install via `rustup`:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustc --version && cargo --version
```

## 2. Create the Google OAuth client

1. [Google Cloud Console](https://console.cloud.google.com/) → create (or pick) a project.
2. **APIs & Services → Library** → enable the **Gmail API**.
3. Open **Google Auth Platform** (console.cloud.google.com/auth/overview) → **Get started** to register the app:
   - **App information**: app name + your email.
   - **Audience**: **External** (choose **Internal** instead if you have a Google Workspace account — no verification warning, no 100-user cap).
   - **Contact information**: your email. Agree and create.
   - On the **Branding** page, complete the required fields — **App name**, **User support email**, and **Developer contact information** (email). Google blocks publishing until branding is complete. (Logo, homepage, privacy, and terms links are optional for personal use.)
   - On the **Audience** page, set **Publishing status → Publish app** (**In production**). Unverified is fine for personal use (<100 users). *Do not leave it in "Testing"* — Testing refresh tokens expire in 7 days.
   - On the **Data Access** page, add scopes: `gmail.readonly`, `gmail.send`, `userinfo.email`.
   - **Verification is not required for personal use.** `gmail.readonly` is a *restricted* scope, but Google exempts **Personal Use apps (fewer than 100 users)** from verification: you can stay **In production, unverified** and click through the "unverified app" warning at sign-in. The security assessment for restricted scopes applies only to apps that store/transmit that data on a **server** — this app is local-only, so none is needed. (The 100-user cap stays until you'd ever verify; you don't need to.) You must still follow Google's API Services User Data Policy — see `PRIVACY.md`.
4. **Google Auth Platform → Clients → Create client**:
   - Application type: **Desktop app**. (No redirect URIs to register — desktop clients use the loopback flow with any `http://127.0.0.1:PORT`.)
   - Click **Create**, then copy the **Client ID** and **Client secret**. The secret is shown **only once** — copy it immediately.
5. Use them: for the draft script, pass them as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` env vars (see §6). The app stores the resulting tokens in the macOS Keychain.


> Security: the app requests only `gmail.readonly`, `gmail.send`, and `userinfo.email`. Tokens are stored in the macOS Keychain, never logged.

## 3. Free AI key (Gemini)

Create a free API key at [Google AI Studio](https://aistudio.google.com/apikey). Paste it into Settings.

> Privacy: the **free tier** of the Gemini API may use your content to improve Google's products, and human reviewers may read it. Do not send confidential content on the free tier. For fully private drafting, use **Ollama** (local) instead — Settings has a provider toggle.

## 4. Optional — Ollama (private mode)

Install [Ollama](https://ollama.com), then `ollama pull llama3.1`. Select Ollama as the AI provider in Settings to keep all content on-device.

## 5. Run the app

```bash
npm install
npm run tauri dev
```

In the app: **Connect Gmail** → grant access → your inbox threads appear.

## 6. Draft script (test the AI on real threads)

Before wiring the UI, you can generate drafts straight from your real inbox:

```bash
GOOGLE_CLIENT_ID=your-client-id \
GOOGLE_CLIENT_SECRET=your-client-secret \
GEMINI_API_KEY=your-gemini-key \
npm run draft
```

It opens your browser for Google consent (loopback on `127.0.0.1:8765`), fetches your most
recent threads, and prints an AI draft for each so you can judge the tone.

Optional env vars: `GMAIL_LIMIT` (default `3`), `TONE` (`professional` | `friendly` |
`concise` | `direct` | `match`, default `professional`), `OAUTH_PORT` (default `8765`),
`GEMINI_MODEL` (default `gemini-3.8-flash` — set this if Google retires the model again;
the error response names the current one).

