# ColdEmailAgentic — Privacy Policy

Last updated: 2026-10-13

ColdEmailAgentic is a local, single-user desktop application. This policy describes
what data it handles and where that data goes.

## What the app accesses

With your authorization, the app connects to your Google account and:

- reads your Gmail threads (`gmail.readonly`);
- sends email that you compose or confirm (`gmail.send`);
- reads your email address (`userinfo.email`).

## Where your data lives

- Email data is stored **locally on your device** (SQLite) and drafts are stored
  locally too. The project operates **no servers** and does not collect or transmit
  your data to the maintainers.
- OAuth tokens and API keys are stored **locally on your device** in a file readable only by
  your user account (`0600` permissions). They are never logged or shared.

## Third parties

- **Google (Gmail API)** — email is read from and sent through Google under your account.
- **AI provider** — when you generate a draft, the relevant thread text is sent to the
  AI provider you select:
  - **Google Gemini (free tier)**: Google may use the content to improve its products
    and human reviewers may read it. Do not use it for confidential content.
  - **Ollama (optional, local)**: content never leaves your device.

## Retention and deletion

- All email data and drafts live only on your device. Deleting the app's local database,
  or disconnecting the account, removes them.
- You can revoke the app's access at any time at
  https://myaccount.google.com/permissions.

## Contact

Questions or requests: open an issue at the project repository.
