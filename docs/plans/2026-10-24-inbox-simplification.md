# Inbox Simplification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One cold-outreach inbox with a simple composer; remove the Outreach screen, contact/address management, and the mailing-address/unsubscribe footer.

**Architecture:** Delete `OutreachView`; add `ComposePanel` in the reader pane. Drop `mailing_address`/unsubscribe from settings and `sendGuard`. The sidebar keeps Inbox/Board/Dashboard and pins Settings at the bottom-left. The inbox data path is unchanged (cold recipients from `sends`, replies only).

**Tech Stack:** React + TypeScript (strict), Vitest, existing `MailboxProvider`, `Repository`, `sendGuard`, `parseColdDraft`.

**Spec:** `docs/specs/2026-10-24-inbox-simplification.md`

---

### Task 1 — Remove mailing address + unsubscribe **[agent]**

**Files:** `src/services/settings.ts`, `src/services/appSettings.ts`, `src/views/SettingsView.tsx`, `src/mail/sendGuard.ts`, `tests/mail/sendGuard.test.ts`, `tests/services/settings.test.ts`, `README.md`

- [ ] `settings.ts`: remove `mailing_address`, `unsubscribe_line`, `unsubscribe_mailto` from `SETTING_DEFAULTS`; delete the `if (key === 'unsubscribe_mailto') { ... }` block in `get()`.
- [ ] `appSettings.ts`: remove `mailingAddress` and `unsubscribeLine` from `StoredSettings` and `DEFAULTS`.
- [ ] `SettingsView.tsx`: remove the two `svc.set(...)` calls and the entire "Cold-email guardrails" card.
- [ ] `sendGuard.ts`: remove `'missing_mailing_address'` from `GuardReason` and the `if (input.kind === 'cold') { const mailingAddress ... }` block. Keep the rate-limit logic.
- [ ] `tests/mail/sendGuard.test.ts`: delete the three mailing-address tests ("blocks cold sends without...", "allows cold sends once...", "does not require... for replies") and every `await settings.set('mailing_address', '1 Main St');` line. Keep opt-out, rate-limit, and duplicate tests.
- [ ] `tests/services/settings.test.ts`: remove the `mailing_address` assertion; change the persistence test to use `own_email`; delete the `unsubscribe_mailto` test.
- [ ] `README.md`: replace the Outreach bullet with: `**Compose** — type a recipient in the Inbox, and the agent drafts a first-touch email you can regenerate and tune before sending.` Replace the compliance bullet with: `**Guardrails** — cold sends honor opt-outs and are rate-limited (25/day, 3/min).`

Verify: `npm test -- tests/mail/sendGuard.test.ts tests/services/settings.test.ts`, `npm run typecheck`.

---

### Task 2 — Shell, Inbox, and composer **[agent]**

**Files:** `src/components/Sidebar.tsx`, `src/components/ThreadList.tsx`, `src/App.tsx`, `src/App.css`, new `src/components/ComposePanel.tsx`; delete `src/views/OutreachView.tsx`

#### Sidebar
- `View = 'inbox' | 'board' | 'dashboard' | 'settings'`.
- `NAV = [inbox, board, dashboard]`; remove the `outreach` icon branch.
- Add, after the activity block and before `sidebar-foot`:
```tsx
<div className="sidebar-settings">
  <button
    type="button"
    className={view === 'settings' ? 'nav-item active' : 'nav-item'}
    aria-current={view === 'settings' ? 'page' : undefined}
    aria-label="Settings"
    title={collapsed ? 'Settings' : undefined}
    onClick={() => onNavigate('settings')}
  >
    <NavIcon name="settings" />
    {!collapsed && 'Settings'}
  </button>
</div>
```
- CSS: ensure the button sits above the account row and is visible when collapsed (e.g. `.sidebar-settings { margin-top: auto; }` if the activity block does not already push it down).

#### ThreadList
- Remove `mode`, `onModeChange`, the exported `InboxMode`, and the two mode chips.
- Add `onCompose: () => void`.
- Header:
```tsx
<div className="list-head">
  Inbox <span className="count">{visible.length}</span>
  <button type="button" className="chip ghost new-email" onClick={onCompose}>+ New</button>
</div>
```
- CSS: `.list-head` becomes a flex row with the button pushed right (`.new-email { margin-left: auto; }`).
- Keep the search, `overflowed`, `loading`, `emptyText`, and Load more.

#### ComposePanel (new)
Create `src/components/ComposePanel.tsx` with the OutreachView form minus Name/context-address/footer:
- Props: `ai`, `mailbox`, `repo`, `ownEmail`, `signature`, `testMode`, `onSent(subject, to)`, `onCancel`.
- Fields: To email, Context (optional one-liner), Tone chips, Subject, Body, Send, Generate, Cancel, error banner.
- `generate(priorDraft?)` mirrors the old cold generation (`mode: 'cold'`, `contact: { name: '', email, notes: context }`, `parseColdDraft`).
- `send()`: require mailbox/repo/to/body; `sendGuard(repo, new SettingsService(repo), { kind: 'cold', toEmail, now: Date.now() })`; `mailbox.sendNew({ to: { email }, subject: subject || '(no subject)', bodyText: body.trim() })`; `repo.upsertContact(...)`; `repo.recordSend(Date.now(), 'cold', to, threadId)`; then `onSent(subject, to)`.
- Guard messages: only `do_not_contact`, `rate_limit_day`, `rate_limit_minute`.
- Send disabled when `!mailbox || generating || testMode || !to.trim() || !body.trim()`. Generate disabled when `!ai || generating`.
- Reuse the existing `.composer`, `.field`, `.tones`, `.draft-text`, `.draft-controls`, `.regen`, `.send`, `.banner` classes.

#### App
- Imports: remove `OutreachView`; add `ComposePanel`.
- `VIEW_TITLE` drops `outreach`.
- `view` default `'inbox'`.
- Remove `inboxMode` state and `switchInboxMode`.
- Add `const [composing, setComposing] = useState(false)`.
- `fetchInbox(box, r, pageToken?)` drops the mode branch; always maps `recentRecipientEmails(...)`.
- `connect`, `loadMore`, and `onSend` call the 3-arg/4-arg forms accordingly (no mode arg).
- `onColdSent(subject, to)`: push the sent activity, `setStatus('Sent to ' + to)`, `setComposing(false)`.
- Add:
```ts
const startCompose = useCallback(() => {
  setView('inbox'); setComposing(true); setSelected(null); setSelectedId(null);
  setStatus(null); setError(null);
}, []);
const cancelCompose = useCallback(() => setComposing(false), []);
```
- Remove the `view === 'outreach'` block.
- Inbox `ThreadList`: remove `key`, `mode`, `onModeChange`; add `onCompose={startCompose}`; `emptyText="No replies yet — send a cold email."`; `onSelect` also calls `setComposing(false)`.
- Reader: `composing ? <ComposePanel ... /> : selected ? (<>...</>) : (<div className="empty">...)`.
- Delete `src/views/OutreachView.tsx`.
- CSS: remove `.mode-toggle` and the now-unused `.chip.active`.

Verify: `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`.

---

### Task 3 — Verify + update PR **[agent]**

- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `cargo check --manifest-path src-tauri/Cargo.toml`.
- [ ] Commit on `feat/outreach-inbox` and push; update PR #12's title/description to cover the simplification.
- [ ] Manual (`npm run tauri dev`): nav is Inbox/Board/Dashboard; Settings gear bottom-left; `+ New` sends with no footer; reply from a **second address** shows in the Inbox; test mode disables Send.
