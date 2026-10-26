# Distribution

Status: not yet a public distribution. The current product is a local, single-user
macOS app that is run from source or as an unsigned local build. This document is the
checklist for turning that into a signed app that other people can install.

## 1. Audience assumptions now

- The README describes a **single-user/local install**: one Gmail account, one local
  SQLite database, no account system, no backend server, and no multi-user auth.
- The user supplies their own Google OAuth desktop client and AI keys today. A public
  release would move to an app-owned OAuth client and needs its own consent screen.
- Distribution is a **separate milestone**. It changes the OAuth review path, secret
  storage, signing/notarization, privacy obligations, and support burden.
- The README targets **macOS on Apple Silicon**. The checked-in build is host-architecture;
  a universal build is not configured or verified here.

## 2. Google OAuth

### Scopes the app requests

`src/mail/oauth.ts` defines exactly these scopes:

| Scope | Why the app needs it |
|---|---|
| `https://www.googleapis.com/auth/gmail.readonly` | List and read Gmail threads/messages for the Inbox and Board. |
| `https://www.googleapis.com/auth/gmail.send` | Send cold emails and replies. |
| `https://www.googleapis.com/auth/gmail.modify` | Move threads to Trash and restore them. |
| `https://www.googleapis.com/auth/userinfo.email` | Identify the connected account's email address. |

Do not add `gmail.compose`, full `mail.google.com`, or broader scopes unless a feature
actually needs them. The app uses the OAuth desktop-client loopback flow with PKCE and
`access_type=offline` / `prompt=consent` (`src/mail/oauth.ts`). The redirect is normally
`http://127.0.0.1:8765`.

### Restricted scopes and public distribution

The three `gmail.*` scopes above are **restricted scopes** under Google's API policy
(`userinfo.email` is not a Gmail restricted scope, though it still requires consent). A
public app using the Gmail scopes needs:

1. **Google OAuth verification** for the consent screen.
2. A **CASA security assessment** (Cloud Application Security Assessment) for restricted
   scopes, or a documented Google exemption. Build the release plan around verification
   and CASA; do not assume a local-only exemption will be granted for a distributed app.
   Confirm the current requirement with Google during submission.

Expect to provide a public HTTPS privacy-policy URL, a homepage, scope justification, a
demo video, and a limited-use explanation. Google's review and any security assessment
can take weeks and may have a cost. Shipping only to yourself avoids this review, but it
is not a public distribution path.

### Private/testing mode

While the app is private:

- Keep the Google Cloud app in **External → Testing** and allowlist specific **test users**.
- Testing mode has a **100-test-user cap**.
- External apps in Testing have **refresh tokens that expire after 7 days**, so users must
  reconnect Gmail roughly weekly.

The current `docs/setup.md` recommends publishing an unverified personal app to avoid the
7-day re-auth cycle. That works for personal use, but the unverified production app still
has a **~100-user cap**; it is not a substitute for verification and CASA. Check the
current Google Cloud console limits before relying on either path.

For a public build, use an app-owned OAuth client rather than asking every user to create
their own. A desktop client's "client secret" is not confidential (it ships with the app),
so PKCE and the loopback redirect remain part of the security model. Never commit the
client secret to the repository.

## 3. Secrets

### Current storage

Secrets are stored in:

```text
~/Library/Application Support/com.nthnp.coldemailagentic/secrets.json
```

The Rust layer (`src-tauri/src/lib.rs`) creates the file with `0600` permissions, writes a
temporary file, fsyncs, and renames it into place. The file contains values such as:

- `gmail.refresh_token`, `gmail.access_token`, `gmail.access_expires_at`
- `google_client_secret`
- `gemini_api_key`
- `groq_api_key`

The file is **not encrypted at rest**. Its protection is the macOS user account and file
permissions. Local backups (including Time Machine) may include it. Do not log it, attach
it to bug reports, or put it in a release artifact.

### Planned migration: macOS Keychain (`keyring`)

Decision D5 is to do the Keychain migration when distributing, not now
([reliability plan](plans/2026-10-25-coldreach-reliability.md)). The planned shape is:

1. Add the `keyring` crate to `src-tauri/Cargo.toml` (it is not a dependency today).
2. Replace the bodies of the existing `secret_set` / `secret_get` / `secret_delete`
   commands with Keychain operations under a stable service name such as
   `com.nthnp.coldemailagentic`.
3. Keep the JS `SecretStore` interface (`src/services/secrets.ts`). The module named
   `keychainSecretStore.ts` is currently file-backed; the name is aspirational.
4. On first launch after the update, read the legacy `secrets.json`, write every entry to
   the Keychain, verify the reads, and only then delete the legacy file. If any write fails,
   leave the file in place and show an actionable error rather than losing tokens.
5. Make `disconnect` delete the Keychain entries, and document how to remove them during
   uninstall.

Caveats:

- Keychain access can prompt the user (login password / "Always Allow"). "Always Allow"
  only behaves predictably when the app has a **stable code signature**; unsigned or
  ad-hoc development builds can re-prompt or lose access after a rebuild.
- The Keychain item's access control is tied to the app's identity. Changing the bundle ID,
  signing certificate, or installing an unsigned build can break access.
- **Sign the app before testing the migration** (notarization is not what makes Keychain
  work, but it is part of the release artifact). Test on a clean macOS user account, not
  only on the development machine.
- Keychain items may survive dragging the app to the Bin. The uninstall instructions must
  cover them.

Shipping before this migration means shipping plaintext tokens in a `0600` file. That may
be acceptable for a private local build, but it is a known distribution risk.

## 4. Build, signing, and notarization

### Build

```bash
npm run tauri build
```

This runs the frontend build first, then bundles the app under
`src-tauri/target/release/bundle/` (usually `macos/ColdEmailAgentic.app`).

The current `src-tauri/tauri.conf.json` has `bundle.targets: ["app"]`, so it builds the
`.app` only. The README mentions a `.dmg`; add `dmg` to the targets if an installer is
required. For a universal binary, add both Rust targets and build with
`--target universal-apple-darwin`; that is not configured today.

### Signing

You need a paid Apple Developer account and a **Developer ID Application** certificate.
An unsigned build triggers Gatekeeper and does not give the Keychain a stable identity.

1. Install the certificate in the login Keychain.
2. Confirm it is visible:

   ```bash
   security find-identity -v -p codesigning
   ```

3. Set `bundle.macOS.signingIdentity` in `tauri.conf.json`, or pass the standard
   `APPLE_SIGNING_IDENTITY` environment variable to `tauri build`.
4. Keep `bundle.macOS.hardenedRuntime` enabled (Tauri defaults it to `true`). Notarization
   requires the hardened runtime.
5. Add entitlements only if needed. The app is not App-Sandboxed today. If you later
   sandbox it (for example for Mac App Store distribution), it will need outgoing network
   access for Gmail/AI and incoming loopback access for the OAuth callback.

Tauri signs the app bundle and nested executables. Let Tauri handle that rather than
hand-signing pieces in a different order. Verify the result:

```bash
codesign --verify --deep --strict --verbose=2 "ColdEmailAgentic.app"
codesign -dv --verbose=4 "ColdEmailAgentic.app"
```

### Notarization and stapling

Use Tauri's notarization environment variables or run `notarytool` after building. For
the manual path, store a notary profile once:

```bash
xcrun notarytool store-credentials "ColdEmailAgentic-notary" \
  --apple-id "you@example.com" \
  --team-id "TEAMID" \
  --password "app-specific-password"
```

Then submit a zip of the signed app and staple the ticket:

```bash
ditto -c -k --keepParent "ColdEmailAgentic.app" "ColdEmailAgentic.zip"
xcrun notarytool submit "ColdEmailAgentic.zip" \
  --keychain-profile "ColdEmailAgentic-notary" --wait
xcrun stapler staple "ColdEmailAgentic.app"
xcrun stapler validate "ColdEmailAgentic.app"
spctl -a -vvv --type execute "ColdEmailAgentic.app"
```

Tauri can automate signing and notarization when the `APPLE_*` credentials are present in
the build environment. Keep those credentials in CI secrets, never in the repo.

## 5. Release checklist

### Before building

- [ ] Bump the version in `package.json`, `src-tauri/tauri.conf.json`, and
      `src-tauri/Cargo.toml`; refresh the lockfile if needed.
- [ ] Add or update `CHANGELOG.md` (none exists today) with user-visible changes and any
      migration notes.
- [ ] Review `PRIVACY.md` and host it at a public HTTPS URL for the Google consent screen.
      The current policy lists Gemini and Ollama but not Groq, while the app exposes
      Gemini/Groq. It also should be explicit that disconnecting Gmail deletes OAuth tokens,
      not the local email database.
- [ ] Confirm the OAuth consent screen scopes match the four scopes above and that the
      privacy-policy/homepage URLs are live.
- [ ] Decide whether the Keychain migration ships in this release. If not, document the
      plaintext `0600` file honestly.
- [ ] Confirm the release notes and support contact are ready.

### Automated checks

Run from a clean checkout with dependencies installed:

```bash
npm test && npm run typecheck && npm run lint && npm run build
npm run tauri build
```

The CI workflow currently runs the test/typecheck/lint checks on pull requests and pushes
to `master`. Do not treat a local green run as a substitute for testing the signed artifact.

### Manual checklist

- [ ] **Alias / different-address reply:** send a cold email, reply from an alias or another
      address on the same Gmail thread, refresh, and confirm the reply appears.
- [ ] **Older reply:** reply on a known cold thread older than the 30-day query window and
      confirm the known-thread path shows it.
- [ ] **Trash exclusion:** trash a known cold thread, refresh the Inbox, and confirm it is
      excluded; restore it and confirm it comes back.
- [ ] **Board drag:** drag a card between columns, relaunch, and confirm the position persists.
- [ ] **Error fallback:** trigger a provider/network failure and confirm the error banner is
      useful; force a render error and confirm the fallback screen, not a blank window.
- [ ] **Clean install:** test on a macOS account with no Node/Rust/dev environment. Confirm
      first launch, OAuth, Keychain access (if migrated), send, reply, and uninstall.

### Publish

- [ ] Sign, notarize, staple, and verify the exact artifact being published.
- [ ] Publish a SHA-256 checksum and release notes.
- [ ] Tag the release only after the artifact passes verification.
- [ ] Keep the previous signed build available for rollback.

There is no auto-updater configured. A future updater needs its own signing key and a
separate security review; do not add a silent update channel as part of the first release.

## 6. Rollback and uninstall

### Where data lives

```text
~/Library/Application Support/com.nthnp.coldemailagentic/
├── coldemailagentic.db   # local SQLite database
└── secrets.json          # OAuth tokens and API keys (current file-backed store)
```

The SQLite database holds accounts, threads, messages, cards, contacts, drafts, sends, and
settings. Non-secret settings (Google client ID, redirect URI, provider choice, signature, theme,
sidebar state) live in WebView `localStorage`, not in the SQLite database. They can remain
after the Application Support folder is deleted.

### Rollback rules

- Back up the whole Application Support directory while the app is quit before upgrading.
- Migrations are append-only and there are no down migrations. An older build is not
  supported against a database created by a newer build.
- To roll back, restore the previous app **and** the matching database backup. Deleting
  the database also rolls back, but destroys local threads, cards, drafts, and send history.
- Restoring Gmail messages is separate. The app's Trash action changes Gmail; deleting local
  data does not undo sends, trash/untrash actions, or Google-side changes.

### Uninstall

1. Quit ColdEmailAgentic.
2. Drag `ColdEmailAgentic.app` from Applications to the Bin.
3. If you want to remove all local data, delete the app data directory:

   ```bash
   rm -rf "$HOME/Library/Application Support/com.nthnp.coldemailagentic"
   ```

   **This is destructive and cannot be undone.** It removes the local SQLite database and
   the current `secrets.json`.
4. After the Keychain migration, also remove the app's Keychain item(s) via Keychain Access.
5. Revoke the app's Google access at <https://myaccount.google.com/permissions>.
6. Remove any backups that contain the database or secrets if they are no longer wanted.

Deleting the app does not delete the user's Gmail messages, undo sent email, or empty
Gmail's Trash. Those actions must be handled in Gmail.

## References

- OAuth scopes: `src/mail/oauth.ts`
- Gmail provider and query construction: `src/mail/gmailProvider.ts`,
  `src/services/gmailMailboxAdapter.ts`
- Outreach window and known-thread predicate: `src/mail/outreach.ts`
- Secret storage: `src-tauri/src/lib.rs`, `src/services/secrets.ts`
- Inbox/refresh behavior: `src/App.tsx`, `src/mail/autoRefresh.ts`
- Deferred distribution decision: `docs/plans/2026-10-25-coldreach-reliability.md` (D5)
