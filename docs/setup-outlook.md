# ColdEmailAgentic — Outlook setup

Connect the app to an Outlook / Microsoft 365 mailbox via Microsoft Graph. The app uses a
**public client** (PKCE), so there is **no client secret**.

## 1. Register an app in Entra ID

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com/) → **App registrations**
   → **New registration**.
2. Name the app (e.g. `ColdEmailAgentic`).
3. **Supported account types**:
   - **Single tenant** — best for a school or organization where only your directory's
     accounts should sign in. You **must** use that tenant's **Directory (tenant) ID or
     domain** in the app; `common` and `organizations` do not work for single-tenant apps.
   - **Accounts in any organizational directory** — if you need to sign in with a different
     work/school tenant. In this case `common` or `organizations` are valid tenant values.
4. Under **Redirect URI**, choose platform **Mobile and desktop applications** and enter
   `http://localhost:8766` (the app's default; change both here and in Settings if you use a
   different port).
5. Click **Register**.

## 2. API permissions

1. In the app registration, open **API permissions** → **Add a permission** →
   **Microsoft Graph** → **Delegated permissions**.
2. Add:
   - `User.Read`
   - `Mail.Read`
   - `Mail.Send`
   - `Mail.ReadWrite`
   - `offline_access` (OpenID permission, so refresh tokens can be issued)
3. For a **school or work tenant**, an administrator may need to **Grant admin consent** for
   the organization. Otherwise users consent on first sign-in.

## 3. Copy the IDs

On the app registration's **Overview** page, copy:

- **Application (client) ID**
- **Directory (tenant) ID** (or use your tenant domain, e.g. `contoso.onmicrosoft.com`)

Tenant values: `common` (any work/school account) and `organizations` (any organizational
directory) apply only to **multi-tenant** registrations. For a **single-tenant** registration,
use the Directory (tenant) ID or tenant domain (e.g. `contoso.onmicrosoft.com`).

## 4. Configure the app

1. Open **Settings** (gear icon) → **Mail account** → select **Outlook / Microsoft 365**.
2. In the **Outlook / Microsoft 365** card, paste the **Application (client) ID**, the
   **Tenant**, and confirm the **Redirect URI** matches the Entra registration.
3. Click **Save** (this saves and reconnects). Use **Reconnect mail account** whenever you
   change the client ID or tenant, to force a fresh sign-in. Your browser opens for Microsoft
   sign-in and consent.

Alternatively, set the values in `.env` (see `.env.example`): `VITE_MAIL_PROVIDER`,
`VITE_OUTLOOK_CLIENT_ID`, `VITE_OUTLOOK_TENANT`, `VITE_OUTLOOK_REDIRECT_URI`. `.env` is a
**first-run fallback**; once you Save in the app, the settings saved there win.

## Notes

- **No client secret.** The app is registered as a public client and uses PKCE; tokens are
  stored locally on your Mac in a `0600` file, never logged.
- **Per-provider login state.** Gmail and Outlook tokens are stored under separate keys, so
  switching providers does not require re-consenting to the other account.
- **Gmail-only for now:** cold sends do not yet record a Microsoft Graph `thread_id`, so the
  alias/known-thread matching enhancement applies to Gmail only. Replies to cold threads are
  still found via the 30-day recipient query.
- **Shared local data.** Sends, contacts, the Board, and cached threads are stored locally and
  shared across whichever account is active. Threads created under another provider may not
  open after switching (their provider-specific IDs may not resolve). To start fresh, clear
  the app's local SQLite database and relaunch.
