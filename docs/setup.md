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
   - On the **Data Access** page, add scopes: `gmail.readonly`, `gmail.send`, `gmail.modify`, `userinfo.email`.
   - **Verification is not required for personal use.** `gmail.readonly` is a *restricted* scope, but Google exempts **Personal Use apps (fewer than 100 users)** from verification: you can stay **In production, unverified** and click through the "unverified app" warning at sign-in. The security assessment for restricted scopes applies only to apps that store/transmit that data on a **server** — this app is local-only, so none is needed. (The 100-user cap stays until you'd ever verify; you don't need to.) You must still follow Google's API Services User Data Policy — see `PRIVACY.md`.
4. **Google Auth Platform → Clients → Create client**:
   - Application type: **Desktop app**. (No redirect URIs to register — desktop clients use the loopback flow with any `http://127.0.0.1:PORT`.)
   - Click **Create**, then copy the **Client ID** and **Client secret**. The secret is shown **only once** — copy it immediately.
5. Use them: for the draft script, pass them as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` env vars (see §6). The app stores the resulting tokens locally on your Mac in a `0600` file.


> Security: the app requests only `gmail.readonly`, `gmail.send`, `gmail.modify`, and `userinfo.email`. Tokens are stored locally in a `0600` file, never logged.

## 3. Free AI key (Gemini)

Create a free API key at [Google AI Studio](https://aistudio.google.com/apikey). Paste it into Settings.

> Privacy: the **free tier** of the Gemini API may use your content to improve Google's products, and human reviewers may read it. Do not send confidential content on the free tier. For fully private drafting, use **Ollama** (local) instead — Settings has a provider toggle.

**Optional second free provider — Groq.** If Gemini is overloaded (`503`) or you want a fallback, create a free key at [console.groq.com/keys](https://console.groq.com/keys) and set `GROQ_API_KEY`. The draft script tries Gemini first, then Groq automatically. (Groq does not retain inference data by default.)

## 4. Optional — Ollama (private mode)

Install [Ollama](https://ollama.com), then `ollama pull llama3.1`. Select Ollama as the AI provider in Settings to keep all content on-device.

## 5. Configure and run the app

Create a `.env` in the project root (copy `.env.example`) and fill it in:

```
VITE_GOOGLE_CLIENT_ID=your-desktop-client-id
VITE_GOOGLE_CLIENT_SECRET=your-client-secret
VITE_OAUTH_REDIRECT_URI=http://127.0.0.1:8765
VITE_AI_PROVIDER=groq
VITE_GROQ_API_KEY=your-groq-key
VITE_GEMINI_API_KEY=your-gemini-key   # optional fallback
```

Then:

```bash
npm install
npm run tauri dev
```

The app connects to Gmail on launch (your browser opens for consent the first time) and your
inbox threads appear. Click a thread, then click **Generate** to draft a reply — pick a tone
and add a nudge like "shorter", then **Generate** again to revise. Tokens are stored locally on
your Mac.

You can also skip the `.env` and enter everything in-app: open **Settings** in the left sidebar and
fill in the Google Client ID / secret and AI key — secrets go to a local `0600` file, the rest to
local storage. `.env` values are used as a fallback.

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

Add `GROQ_API_KEY=…` to enable the Groq fallback (used automatically if Gemini fails).
The Gemini model is chosen at runtime from the API's own model list, so it survives model
retirements — set `GEMINI_MODEL` to force a specific one.

Optional env vars: `GMAIL_LIMIT` (default `3`), `TONE` (`professional` | `friendly` |
`concise` | `direct` | `match`, default `professional`), `OAUTH_PORT` (default `8765`),
`GEMINI_MODEL`, `GROQ_API_KEY`, `GROQ_MODEL`, `AI_PROVIDER` (`gemini` | `groq`, to reorder).

**Targeting a real conversation** (most inboxes are mostly automated mail, so the newest-N
default can surface only newsletters):
- `GMAIL_THREAD_ID=<id>` — draft for one thread. Find the id in the Gmail URL after `#inbox/`.
- `GMAIL_QUERY="is:unread from:someone@example.com"` — extra Gmail search terms.
- `GMAIL_FETCH` (default `25`) — how many threads to scan before filtering.
- `INCLUDE_JUNK=1` — include automated/no-reply threads (skipped by default).

