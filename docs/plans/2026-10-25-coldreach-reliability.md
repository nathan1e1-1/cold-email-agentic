# ColdReach Reliability v0.1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five architecture risks that make ColdReach fragile as a daily driver: dead sync path, query-dependent inbox fidelity, no UI test harness, no global error handling, and (deferred) distribution/repo duplication.

**Architecture:** Keep the current layering (React view → MailboxProvider → mail provider → Repository → SQLite). Delete the unused history-sync path so there is one data model; extend the live outreach query with *known cold thread IDs* so alias/older replies are visible; add an ErrorBoundary + global error bus; introduce a minimal jsdom/RTL harness for render-level UI tests.

**Tech Stack:** React 19 + TypeScript + Vite + Tauri 2, Vitest, @dnd-kit/core, node:sqlite (tests), ESLint(oxlint).

**Decisions (approved):** D1 delete dead sync (keep `getThreadByProviderId` — used by `upsertThread`); D2 known-thread alias matching, no All-mail toggle; D3 RTL render tests now, no Playwright; D4 repo dedup next milestone; D5 keychain/OAuth only when distributing.

---

## File map

| File | Change |
|---|---|
| `package.json` | Add jsdom + Testing Library devDeps |
| `vitest.config.ts` | Include `tests/**/*.test.{ts,tsx}` |
| `tests/components/*.test.tsx` | New render tests |
| `src/mail/sync.ts` | **Delete** |
| `src/mail/mailProvider.ts` | Drop `historyId`, `seededHistoryId`, `HistoryDelta`, `listHistoryChanges` |
| `src/mail/gmailProvider.ts` | Drop `historyId` from profile/listThreads; delete `listHistoryChanges` |
| `src/mail/gmailParse.ts` | Drop `historyId` mapping |
| `src/domain/types.ts` | Drop `Thread.historyId` |
| `src/db/repository.ts` | Drop `setHistoryId`, `RepoAccount.historyId`, `RepoThread.historyId`; add `listColdThreadIds` |
| `src/db/tauriRepository.ts`, `src/db/nodeRepository.ts` | Same drops; stop writing/reading `history_id`; implement `listColdThreadIds` |
| `src/mail/outreach.ts` | Add `isRelevantThread` |
| `src/services/mailbox.ts` | `ThreadQueryOptions.knownThreadIds?` |
| `src/services/gmailMailboxAdapter.ts` | Merge known threads into the outreach page |
| `src/services/board.ts` | Use `isRelevantThread` + known ids |
| `src/App.tsx` | Pass known ids; use `isRelevantThread`; subscribe to global errors |
| `src/services/errorBus.ts` | New: global handlers + subscribe |
| `src/components/ErrorBoundary.tsx` | New |
| `src/main.tsx` | Install handlers; wrap `<App/>` |
| `src/db/schema.ts` | Comment: `history_id` retired (column kept) |

---

## Task 0: UI test harness

**Files:** `package.json`, `vitest.config.ts`, `tests/components/BoardView.test.tsx`

- [ ] **Step 1: Install dev deps**

Run: `npm i -D jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event`
Expected: `package.json` devDependencies updated; install succeeds.

- [ ] **Step 2: Widen the test include**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
  },
});
```

- [ ] **Step 3: Write the failing/empty-render test**

`tests/components/BoardView.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BoardView } from '../../src/views/BoardView';

describe('BoardView', () => {
  it('renders the three columns and empty drop targets', () => {
    render(<BoardView repo={null} onOpenThread={() => {}} refreshKey={0} />);
    expect(screen.getByText("Haven't touched")).toBeTruthy();
    expect(screen.getByText('In review')).toBeTruthy();
    expect(screen.getByText('Sent')).toBeTruthy();
    expect(screen.getAllByText('Drop cards here')).toHaveLength(3);
  });
});
```

- [ ] **Step 4: Run it**

Run: `npx vitest run tests/components/BoardView.test.tsx`
Expected: FAIL first if jsdom/RTL missing from config resolution; then PASS after Step 1-2. (If it already passes, the harness is proven.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/components/BoardView.test.tsx
git commit -m "test(ui): add jsdom + Testing Library harness with BoardView render test"
```

---

## Task 1: Delete the dead history-sync path

**Files:** delete `src/mail/sync.ts`, `tests/mail/sync.test.ts`; modify `src/mail/mailProvider.ts`, `src/mail/gmailProvider.ts`, `src/mail/gmailParse.ts`, `src/domain/types.ts`, `src/db/repository.ts`, `src/db/tauriRepository.ts`, `src/db/nodeRepository.ts`, `src/db/schema.ts`, `tests/mail/gmailProvider.test.ts`, `tests/mail/gmailParse.test.ts`, `tests/db/repository.test.ts`.

- [ ] **Step 1: Snapshot references**

Run: `grep -rn "historyId\|seededHistoryId\|listHistoryChanges\|setHistoryId" src tests | sort`
Expected: the list below; no other consumers.

- [ ] **Step 2: Remove the dead code**

- Delete `src/mail/sync.ts` and `tests/mail/sync.test.ts`.
- `mailProvider.ts`: remove `GmailProfile.historyId`, `ListThreadsResult.seededHistoryId`, `HistoryDelta`, `listHistoryChanges` from `MailProvider`.
- `gmailProvider.ts`: `getProfile()` returns `{ emailAddress }` only; `listThreads` stops calling `getProfile` and returns `{ threads, nextPageToken }`; delete `listHistoryChanges`; drop `GmailProfile` history field usage.
- `gmailParse.ts`: delete `historyId` from resource interfaces and `parseThread` output.
- `domain/types.ts`: delete `Thread.historyId`.
- `repository.ts`: delete `setHistoryId`; delete `historyId` from `RepoAccount`/`RepoThread`. **Keep `getThreadByProviderId`** — `upsertThread` uses it.
- `tauriRepository.ts` / `nodeRepository.ts`: delete `setHistoryId`; remove `history_id` from the `INSERT INTO threads` column list and params; remove `historyId` from `mapAccount`/`mapThread`. Keep `getThreadByProviderId`.
- `schema.ts`: add above `history_id` in accounts: `-- retired (history sync removed); column kept for migration compatibility`.

- [ ] **Step 3: Update tests**

- `tests/mail/gmailProvider.test.ts`: delete the two `listHistoryChanges` tests; change `getProfile` assertion to `{ emailAddress: 'me@x.com' }`; drop `seededHistoryId` assertion.
- `tests/mail/gmailParse.test.ts`: remove `t.historyId` assertion and the `historyId` in the fixture.
- `tests/db/repository.test.ts`: remove the `setHistoryId`/account `historyId` test block and the "stores a per-thread historyId" test.

- [ ] **Step 4: Verify**

Run:
```bash
grep -rn "historyId\|seededHistoryId\|listHistoryChanges\|setHistoryId" src tests
npm test
npm run typecheck
npm run lint
```
Expected: grep returns only `schema.ts` (the retired comment); 199 − removed + new = all green; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(mail): delete dead history-sync path and historyId plumbing"
```

---

## Task 2: Known-thread (alias/reply-to) inbox matching

**Files:** `src/db/repository.ts`, `src/db/tauriRepository.ts`, `src/db/nodeRepository.ts`, `src/mail/outreach.ts`, `src/services/mailbox.ts`, `src/services/gmailMailboxAdapter.ts`, `src/services/board.ts`, `src/App.tsx`, tests: `tests/db/repository.test.ts`, `tests/mail/outreach.test.ts`, new `tests/services/gmailMailboxAdapter.test.ts`.

- [ ] **Step 1: Failing repository test**

Add to `tests/db/repository.test.ts`:
```ts
it('lists distinct cold thread ids', async () => {
  const repo = new NodeRepository(':memory:');
  await repo.recordSend(1, 'cold', 'a@x.com', 't1');
  await repo.recordSend(2, 'cold', 'a@x.com', 't1');
  await repo.recordSend(3, 'cold', 'b@x.com', 't2');
  await repo.recordSend(4, 'reply', 'c@x.com', 't3');
  expect((await repo.listColdThreadIds()).sort()).toEqual(['t1', 't2']);
});
```
Run: `npx vitest run tests/db/repository.test.ts -t "distinct cold thread ids"` → FAIL (method missing).

- [ ] **Step 2: Implement `listColdThreadIds`**

Interface: `listColdThreadIds(): Promise<string[]>;`

Node:
```ts
async listColdThreadIds(): Promise<string[]> {
  return this.all<{ thread_id: string }>(
    "SELECT DISTINCT thread_id FROM sends WHERE kind='cold' AND thread_id IS NOT NULL",
  ).map((r) => r.thread_id);
}
```
Tauri: same via `this.all<{ thread_id: string }>(...)`.
Run the test → PASS.

- [ ] **Step 3: Failing outreach test**

Add to `tests/mail/outreach.test.ts`:
```ts
import { isRelevantThread } from '../../src/mail/outreach';

it('keeps a known thread with an alias reply, but not outbound-only', () => {
  const known = new Set(['t1']);
  expect(isRelevantThread(thread('alias@x.com'), new Set(), known)).toBe(true);
  expect(isRelevantThread(thread('alias@x.com', 'outbound'), new Set(), known)).toBe(false);
});
```
Run → FAIL.

- [ ] **Step 4: Implement the helper**

```ts
export function isRelevantThread(
  thread: Thread,
  recipients: ReadonlySet<string>,
  knownThreadIds: ReadonlySet<string>,
): boolean {
  if (isOutreachThread(thread, recipients)) return true;
  if (!knownThreadIds.has(thread.id)) return false;
  return thread.messages.some((m) => m.direction === 'inbound');
}
```

- [ ] **Step 5: Adapter merge + option**

`services/mailbox.ts` add `knownThreadIds?: string[];` to `ThreadQueryOptions`.

`services/gmailMailboxAdapter.ts`, inside the recipients branch (after the existing page loop, only when `!inTrash`):
```ts
const known = opts?.knownThreadIds ?? [];
if (known.length > 0) {
  const extra = await provider.getThreadsByIds(known);
  const keep = extra.filter(
    (t) => !isJunkThread(t) && t.messages.some((m) => m.direction === 'inbound'),
  );
  const byId = new Map([...threads, ...keep].map((t) => [t.id, t]));
  threads = [...byId.values()]
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
    .slice(0, OUTREACH_CAP);
}
```
(Change `let threads` accordingly.)

- [ ] **Step 6: Wire callers**

- `App.fetchInbox`: `const known = await r.listColdThreadIds()` and pass `knownThreadIds: known`.
- `App.persistThreads`: build `known` set and use `isRelevantThread(thread, recipients, known)`.
- `services/board.ts`: fetch `listColdThreadIds()` too, and filter with `isRelevantThread`.

- [ ] **Step 7: Adapter test (offline fake provider)**

`tests/services/gmailMailboxAdapter.test.ts`: fake provider with `isAuthed`, `auth`, `getProfile`, `listThreads` (returns one from-match), `getThreadsByIds` (returns an alias-reply thread not matching `from:`), `getThread`; `connect()` then `listThreads({outreachRecipients:['a@x.com'], knownThreadIds:['t9']})`; assert both threads returned, deduped, and junk/outbound-only excluded.

- [ ] **Step 8: Verify + commit**

```bash
npm test && npm run typecheck && npm run lint
git add -A
git commit -m "feat(inbox): show replies from known cold threads (alias/older), not just from: match"
```

---

## Task 3: Global error handling

**Files:** new `src/components/ErrorBoundary.tsx`, new `src/services/errorBus.ts`; modify `src/main.tsx`, `src/App.tsx`; test `tests/components/ErrorBoundary.test.tsx`.

- [ ] **Step 1: Failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import { emitGlobalError, onGlobalError } from '../../src/services/errorBus';

function Boom(): JSX.Element { throw new Error('boom'); }

describe('ErrorBoundary', () => {
  it('renders a fallback instead of unmounting to a blank screen', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole('alert').textContent).toContain('boom');
  });

  it('delivers global errors to subscribers', () => {
    const seen: string[] = [];
    const off = onGlobalError((m) => seen.push(m));
    emitGlobalError('kaboom');
    off();
    expect(seen).toEqual(['kaboom']);
  });
});
```
Run → FAIL (modules missing).

- [ ] **Step 2: Implement**

`src/services/errorBus.ts`:
```ts
type Listener = (message: string) => void;
const listeners = new Set<Listener>();

export function onGlobalError(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function emitGlobalError(message: string): void {
  for (const fn of listeners) fn(message);
}

export function installGlobalHandlers(): () => void {
  const onError = (event: ErrorEvent) => emitGlobalError(event.message || String(event.error));
  const onRejection = (event: PromiseRejectionEvent) =>
    emitGlobalError(String(event.reason?.message ?? event.reason));
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
```

`src/components/ErrorBoundary.tsx`:
```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert" style={{ padding: 24 }}>
          <h1>Something went wrong</h1>
          <p>{this.state.error.message}</p>
          <button type="button" onClick={() => window.location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

`src/main.tsx`: call `installGlobalHandlers()` before render; wrap `<App/>` in `<ErrorBoundary>`.

`src/App.tsx`: `useEffect(() => onGlobalError((m) => setError(m)), [])`.

- [ ] **Step 3: Verify + commit**

```bash
npm test && npm run typecheck && npm run lint
git add -A
git commit -m "feat(ui): add ErrorBoundary and global error bus to the app banner"
```

---

## Final verification (manual checklist)

1. `npm test && npm run typecheck && npm run lint` → all green.
2. `npm run tauri dev` (or restart the app):
   - Inbox loads; a reply from a different address on a thread you sent appears after refresh/≤60s.
   - A 40-day-old cold thread's reply appears (known-thread path).
   - Board drag still floats above columns; dropping still moves the card.
   - Temporarily throw in a component (or use devtools `throw`) → fallback screen, not blank.
3. Commit nothing else.

## Out of scope (documented follow-ups)
- All-mail toggle / Gmail-web cold sends (no `sends` row) — cannot be matched.
- Playwright E2E and drag-gesture simulation (jsdom has no layout).
- Repository SQL/mapper dedup (D4).
- Keychain migration + Google OAuth verification/notarization (D5).
