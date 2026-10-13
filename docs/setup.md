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

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. **APIs & Services → Library** → enable the **Gmail API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (use **Internal** instead if you have a Google Workspace account — no verification warning, no 100-user cap).
   - Fill in app name + your email; save.
   - **Publish the app** (Publishing status → **In production**). Staying **unverified is fine** for personal use (<100 users). *Do not leave it in "Testing"* — Testing refresh tokens expire in 7 days.
   - Scopes: `gmail.readonly`, `gmail.send`, `userinfo.email`.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Desktop app**.
   - Copy the **Client ID** (and Client Secret if shown). Paste them into the app's Settings when connecting.

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
