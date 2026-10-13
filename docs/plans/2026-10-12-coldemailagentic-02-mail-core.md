# ColdEmailAgentic — Plan 2: Mail Core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the pure, network-free mail layer — base64/UTF-8 encoding, RFC 2822 MIME construction, the cold-send guard, and Gmail API response parsing — all fully unit-tested.

**Architecture:** Framework-free TypeScript modules under `src/mail/`, depending only on the existing `Repository`/`SettingsService` and `src/domain/types.ts`. No HTTP, no OAuth, no UI. The Gmail provider, OAuth, sync, and UI wiring build on these in Plan 3.

**Tech Stack:** TypeScript (strict), Vitest, `node:sqlite` (tests only), existing `Repository`/`SettingsService`.

**Spec:** `docs/specs/2026-10-09-cold-email-agentic-design.md` (v3), §8.5, §8.8, §8.7, §11.

---

## File Structure

- `src/mail/encoding.ts` — base64 / base64url / UTF-8 helpers (portable: works in Node and the webview).
- `src/mail/mime.ts` — `buildMime` (RFC 2822) + `buildRawMessage` (base64url for Gmail).
- `src/mail/sendGuard.ts` — `sendGuard` (compliance/rate checks) + `duplicateWarning`.
- `src/mail/gmailParse.ts` — parse Gmail message/thread resources into domain objects.
- `tests/mail/*.test.ts` — Vitest unit tests.

---

### Task 1: Encoding helpers

**Files:**
- Create: `src/mail/encoding.ts`
- Test: `tests/mail/encoding.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/mail/encoding.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  utf8ToBase64, base64ToUtf8, toBase64Url, base64UrlToBase64,
  utf8ToBase64Url, base64UrlToUtf8,
} from '../../src/mail/encoding';

describe('encoding', () => {
  it('round-trips ASCII', () => {
    expect(base64ToUtf8(utf8ToBase64('hello'))).toBe('hello');
  });
  it('round-trips unicode', () => {
    const s = 'héllo — 世界 🙂';
    expect(base64ToUtf8(utf8ToBase64(s))).toBe(s);
  });
  it('toBase64Url uses url-safe chars and strips padding', () => {
    expect(toBase64Url('ab+c/')).toBe('ab-c_');
    expect(toBase64Url('ab==')).toBe('ab');
  });
  it('base64UrlToBase64 restores padding', () => {
    expect(base64UrlToBase64('ab-c_')).toBe('ab+c/');
    expect(base64UrlToBase64('aGk')).toBe('aGk=');
  });
  it('round-trips via base64url', () => {
    const s = 'héllo — 世界';
    expect(base64UrlToUtf8(utf8ToBase64Url(s))).toBe(s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/mail/encoding.test.ts`
Expected: FAIL — cannot find module `../../src/mail/encoding`.

- [ ] **Step 3: Implement**

Create `src/mail/encoding.ts`:
```ts
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function utf8ToBase64(s: string): string {
  return bytesToBase64(new TextEncoder().encode(s));
}

export function base64ToUtf8(b64: string): string {
  return new TextDecoder().decode(base64ToBytes(b64));
}

export function toBase64Url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBase64(u: string): string {
  const b = u.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b.length % 4 ? '='.repeat(4 - (b.length % 4)) : '';
  return b + pad;
}

export function utf8ToBase64Url(s: string): string {
  return toBase64Url(utf8ToBase64(s));
}

export function base64UrlToUtf8(u: string): string {
  return base64ToUtf8(base64UrlToBase64(u));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/mail/encoding.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mail/encoding.ts tests/mail/encoding.test.ts
git commit -m "feat(mail): add base64/utf8 encoding helpers"
```

---

### Task 2: MIME builder

**Files:**
- Create: `src/mail/mime.ts`
- Test: `tests/mail/mime.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/mail/mime.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildMime, buildRawMessage } from '../../src/mail/mime';
import { base64UrlToUtf8 } from '../../src/mail/encoding';

const base = { from: 'me@x.com', to: ['them@y.com'], subject: 'Hi', bodyText: 'Hello there' };
const fixed = { messageId: '<id@x.com>', date: new Date('2026-10-12T10:00:00Z') };

describe('buildMime', () => {
  it('builds headers and a base64 body separated by CRLF', () => {
    const raw = buildMime(base, fixed);
    expect(raw).toContain('From: me@x.com\r\n');
    expect(raw).toContain('To: them@y.com\r\n');
    expect(raw).toContain('Subject: Hi\r\n');
    expect(raw).toContain('Message-ID: <id@x.com>\r\n');
    expect(raw).toContain('MIME-Version: 1.0\r\n');
    expect(raw).toContain('Content-Type: text/plain; charset=utf-8\r\n');
    expect(raw).toContain('Content-Transfer-Encoding: base64\r\n');
    expect(raw).toContain('\r\n\r\n');
  });

  it('RFC2047-encodes non-ASCII subjects', () => {
    const raw = buildMime({ ...base, subject: 'Café ☕' }, fixed);
    expect(raw).toContain('Subject: =?UTF-8?B?');
  });

  it('includes threading headers for replies', () => {
    const raw = buildMime({ ...base, inReplyTo: '<m0@y.com>', references: ['<m0@y.com>'] }, fixed);
    expect(raw).toContain('In-Reply-To: <m0@y.com>\r\n');
    expect(raw).toContain('References: <m0@y.com>\r\n');
  });

  it('adds a mailto List-Unsubscribe for cold sends and no one-click header', () => {
    const raw = buildMime({ ...base, listUnsubscribeMailto: 'mailto:me@x.com?subject=unsubscribe' }, fixed);
    expect(raw).toContain('List-Unsubscribe: <mailto:me@x.com?subject=unsubscribe>\r\n');
    expect(raw).not.toContain('List-Unsubscribe-Post');
  });

  it('omits List-Unsubscribe for replies', () => {
    expect(buildMime(base, fixed)).not.toContain('List-Unsubscribe');
  });

  it('encodes to url-safe base64 for Gmail and round-trips', () => {
    const encoded = buildRawMessage(base, fixed);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(base64UrlToUtf8(encoded)).toContain('From: me@x.com');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/mail/mime.test.ts`
Expected: FAIL — cannot find module `../../src/mail/mime`.

- [ ] **Step 3: Implement**

Create `src/mail/mime.ts`:
```ts
import { utf8ToBase64, utf8ToBase64Url } from './encoding';

export interface ComposeInput {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyText: string;
  inReplyTo?: string;
  references?: string[];
  listUnsubscribeMailto?: string;
}

export interface BuildMimeOptions {
  messageId?: string;
  date?: Date;
}

const CRLF = '\r\n';

function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${utf8ToBase64(value)}?=`;
}

function rfc2822Date(d: Date): string {
  return d.toUTCString().replace('GMT', '+0000');
}

function defaultMessageId(from: string): string {
  const domain = from.includes('@') ? from.split('@')[1] : 'localhost';
  const rand = Math.random().toString(36).slice(2);
  return `<${Date.now()}.${rand}@${domain}>`;
}

export function buildMime(input: ComposeInput, opts: BuildMimeOptions = {}): string {
  const messageId = opts.messageId ?? defaultMessageId(input.from);
  const date = opts.date ?? new Date();

  const headers: string[] = [
    `From: ${input.from}`,
    `To: ${input.to.join(', ')}`,
  ];
  if (input.cc && input.cc.length > 0) headers.push(`Cc: ${input.cc.join(', ')}`);
  headers.push(`Subject: ${encodeHeaderValue(input.subject)}`);
  headers.push(`Message-ID: ${messageId}`);
  headers.push(`Date: ${rfc2822Date(date)}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references && input.references.length > 0) {
    headers.push(`References: ${input.references.join(' ')}`);
  }
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset=utf-8');
  headers.push('Content-Transfer-Encoding: base64');
  if (input.listUnsubscribeMailto) {
    headers.push(`List-Unsubscribe: <${input.listUnsubscribeMailto}>`);
  }

  const body = utf8ToBase64(input.bodyText).replace(/(.{76})/g, `$1${CRLF}`);
  return headers.join(CRLF) + CRLF + CRLF + body;
}

export function buildRawMessage(input: ComposeInput, opts?: BuildMimeOptions): string {
  return utf8ToBase64Url(buildMime(input, opts));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/mail/mime.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mail/mime.ts tests/mail/mime.test.ts
git commit -m "feat(mail): add RFC 2822 MIME builder"
```

---

### Task 3: Send guard

**Files:**
- Create: `src/mail/sendGuard.ts`
- Test: `tests/mail/sendGuard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/mail/sendGuard.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { NodeRepository } from '../../src/db/nodeRepository';
import { SettingsService } from '../../src/services/settings';
import { sendGuard, duplicateWarning } from '../../src/mail/sendGuard';

function ctx() {
  const repo = new NodeRepository(':memory:');
  const settings = new SettingsService(repo);
  return { repo, settings };
}

describe('sendGuard', () => {
  it('blocks cold sends without a mailing address', async () => {
    const { repo, settings } = ctx();
    expect(await sendGuard(repo, settings, { kind: 'cold', toEmail: 'a@z.com', now: 1000 }))
      .toEqual({ ok: false, reason: 'missing_mailing_address' });
  });

  it('allows cold sends once a mailing address is set', async () => {
    const { repo, settings } = ctx();
    await settings.set('mailing_address', '1 Main St');
    expect(await sendGuard(repo, settings, { kind: 'cold', toEmail: 'a@z.com', now: 1000 }))
      .toEqual({ ok: true });
  });

  it('does not require a mailing address for replies', async () => {
    const { repo, settings } = ctx();
    expect(await sendGuard(repo, settings, { kind: 'reply', toEmail: 'a@z.com', now: 1000 }))
      .toEqual({ ok: true });
  });

  it('blocks do_not_contact addresses for any kind', async () => {
    const { repo, settings } = ctx();
    await settings.set('mailing_address', '1 Main St');
    await repo.upsertContact({ name: 'A', email: 'a@z.com', notes: '', doNotContact: false });
    await repo.setDoNotContact('a@z.com', true);
    expect(await sendGuard(repo, settings, { kind: 'cold', toEmail: 'A@Z.com', now: 1000 }))
      .toEqual({ ok: false, reason: 'do_not_contact' });
    expect(await sendGuard(repo, settings, { kind: 'reply', toEmail: 'a@z.com', now: 1000 }))
      .toEqual({ ok: false, reason: 'do_not_contact' });
  });

  it('enforces the per-day cold limit', async () => {
    const { repo, settings } = ctx();
    await settings.set('mailing_address', '1 Main St');
    await settings.set('rate_limit_per_day', '2');
    const now = 10 * 24 * 60 * 60 * 1000;
    await repo.recordSend(now - 1000, 'cold', 'x@z.com');
    await repo.recordSend(now - 2000, 'cold', 'y@z.com');
    expect(await sendGuard(repo, settings, { kind: 'cold', toEmail: 'z@z.com', now }))
      .toEqual({ ok: false, reason: 'rate_limit_day' });
  });

  it('enforces the per-minute cold limit', async () => {
    const { repo, settings } = ctx();
    await settings.set('mailing_address', '1 Main St');
    await settings.set('rate_limit_per_day', '100');
    await settings.set('rate_limit_per_minute', '1');
    const now = 10 * 24 * 60 * 60 * 1000;
    await repo.recordSend(now - 1000, 'cold', 'x@z.com');
    expect(await sendGuard(repo, settings, { kind: 'cold', toEmail: 'z@z.com', now }))
      .toEqual({ ok: false, reason: 'rate_limit_minute' });
  });

  it('warns on duplicate cold sends', async () => {
    const { repo } = ctx();
    await repo.recordSend(1, 'cold', 'x@z.com');
    expect(await duplicateWarning(repo, 'X@Z.com')).toBe(true);
    expect(await duplicateWarning(repo, 'new@z.com')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/mail/sendGuard.test.ts`
Expected: FAIL — cannot find module `../../src/mail/sendGuard`.

- [ ] **Step 3: Implement**

Create `src/mail/sendGuard.ts`:
```ts
import type { Repository } from '../db/repository';
import type { SendKind } from '../domain/types';
import type { SettingsService } from '../services/settings';

export type GuardReason =
  | 'missing_mailing_address'
  | 'do_not_contact'
  | 'rate_limit_day'
  | 'rate_limit_minute';

export type GuardResult = { ok: true } | { ok: false; reason: GuardReason };

export interface GuardInput {
  kind: SendKind;
  toEmail: string;
  now: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export async function sendGuard(
  repo: Repository,
  settings: SettingsService,
  input: GuardInput,
): Promise<GuardResult> {
  if (input.kind === 'cold') {
    const mailingAddress = (await settings.get('mailing_address')).trim();
    if (mailingAddress === '') return { ok: false, reason: 'missing_mailing_address' };
  }

  const contact = await repo.getContactByEmail(input.toEmail);
  if (contact?.doNotContact) return { ok: false, reason: 'do_not_contact' };

  if (input.kind === 'cold') {
    const perDay = await settings.getInt('rate_limit_per_day');
    const perMinute = await settings.getInt('rate_limit_per_minute');
    if ((await repo.countSendsSince(input.now - DAY_MS, 'cold')) >= perDay) {
      return { ok: false, reason: 'rate_limit_day' };
    }
    if ((await repo.countSendsSince(input.now - MINUTE_MS, 'cold')) >= perMinute) {
      return { ok: false, reason: 'rate_limit_minute' };
    }
  }

  return { ok: true };
}

export async function duplicateWarning(repo: Repository, toEmail: string): Promise<boolean> {
  return repo.hasColdSendTo(toEmail);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/mail/sendGuard.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mail/sendGuard.ts tests/mail/sendGuard.test.ts
git commit -m "feat(mail): add cold-send guard and duplicate warning"
```

---

### Task 4: Gmail response parsing

**Files:**
- Create: `src/mail/gmailParse.ts`
- Test: `tests/mail/gmailParse.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/mail/gmailParse.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseMessage, parseThread, headerValue, collectTextBody } from '../../src/mail/gmailParse';
import { utf8ToBase64Url } from '../../src/mail/encoding';
import type { GmailMessageResource, GmailPayload } from '../../src/mail/gmailParse';

function messageResource(): GmailMessageResource {
  return {
    id: 'm1',
    threadId: 't1',
    labelIds: ['INBOX'],
    snippet: 'hello',
    internalDate: '1000',
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'From', value: 'Sarah Chen <sarah@acme.com>' },
        { name: 'To', value: 'me@x.com' },
        { name: 'Cc', value: 'cc@acme.com' },
        { name: 'Subject', value: 'Q3' },
        { name: 'Message-ID', value: '<m1@acme.com>' },
        { name: 'References', value: '<m0@acme.com>' },
        { name: 'List-Unsubscribe', value: '<mailto:u@acme.com>' },
        { name: 'Date', value: 'Mon, 06 Oct 2026 09:05:00 +0000' },
      ],
      parts: [
        { mimeType: 'text/plain', body: { data: utf8ToBase64Url('Hello there') } },
        { mimeType: 'text/html', body: { data: utf8ToBase64Url('<p>Hello there</p>') } },
      ],
    },
  };
}

describe('gmailParse', () => {
  it('reads header values case-insensitively', () => {
    const headers = [{ name: 'From', value: 'a@b.com' }];
    expect(headerValue(headers, 'from')).toBe('a@b.com');
    expect(headerValue(headers, 'missing')).toBe('');
  });

  it('collects the text/plain body', () => {
    expect(collectTextBody(messageResource().payload as GmailPayload)).toBe('Hello there');
  });

  it('parses a message with direction and threading fields', () => {
    const m = parseMessage(messageResource(), 'me@x.com');
    expect(m.id).toBe('m1');
    expect(m.from.name).toBe('Sarah Chen');
    expect(m.from.email).toBe('sarah@acme.com');
    expect(m.to.map((a) => a.email)).toEqual(['me@x.com']);
    expect(m.cc.map((a) => a.email)).toEqual(['cc@acme.com']);
    expect(m.subject).toBe('Q3');
    expect(m.rfcMessageId).toBe('<m1@acme.com>');
    expect(m.references).toEqual(['<m0@acme.com>']);
    expect(m.hasListUnsubscribe).toBe(true);
    expect(m.bodyText).toBe('Hello there');
    expect(m.direction).toBe('inbound');
    expect(m.date).toBe(1000);
  });

  it('marks messages from ownEmail as outbound', () => {
    const res = messageResource();
    res.payload!.headers = [{ name: 'From', value: 'me@x.com' }];
    expect(parseMessage(res, 'me@x.com').direction).toBe('outbound');
  });

  it('parses a thread with participants and inbox flag', () => {
    const t = parseThread({ id: 't1', historyId: '99', messages: [messageResource()] }, 'me@x.com');
    expect(t.id).toBe('t1');
    expect(t.subject).toBe('Q3');
    expect(t.messages.length).toBe(1);
    expect(t.inInbox).toBe(true);
    expect(t.participants.map((p) => p.email)).toContain('sarah@acme.com');
    expect(t.lastMessageAt).toBe(1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/mail/gmailParse.test.ts`
Expected: FAIL — cannot find module `../../src/mail/gmailParse`.

- [ ] **Step 3: Implement**

Create `src/mail/gmailParse.ts`:
```ts
import type { Address, Message, Thread } from '../domain/types';
import { computeDirection } from '../services/kanban';
import { base64UrlToUtf8 } from './encoding';

export interface GmailHeader { name: string; value: string }
export interface GmailBody { data?: string; size?: number }
export interface GmailPayload {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: GmailBody;
  parts?: GmailPayload[];
}
export interface GmailMessageResource {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPayload;
}
export interface GmailThreadResource {
  id: string;
  historyId?: string;
  snippet?: string;
  messages?: GmailMessageResource[];
}

export function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  if (!headers) return '';
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? '';
}

function decode(data: string | undefined): string {
  return data ? base64UrlToUtf8(data) : '';
}

export function collectTextBody(payload: GmailPayload | undefined): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decode(payload.body.data);
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = collectTextBody(part);
      if (text) return text;
    }
  }
  if (payload.body?.data) return decode(payload.body.data);
  return '';
}

function parseAddress(value: string): Address {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (match) {
    const name = match[1].replace(/^"|"$/g, '').trim();
    return name ? { name, email: match[2].trim() } : { email: match[2].trim() };
  }
  return { email: value.trim() };
}

function parseAddressList(value: string): Address[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseAddress);
}

export function parseMessage(res: GmailMessageResource, ownEmail: string): Message {
  const headers = res.payload?.headers;
  const from = parseAddress(headerValue(headers, 'From'));
  const references = headerValue(headers, 'References').split(/\s+/).filter(Boolean);
  return {
    id: res.id,
    rfcMessageId: headerValue(headers, 'Message-ID'),
    references,
    from,
    to: parseAddressList(headerValue(headers, 'To')),
    cc: parseAddressList(headerValue(headers, 'Cc')),
    subject: headerValue(headers, 'Subject'),
    bodyText: collectTextBody(res.payload),
    hasListUnsubscribe: headerValue(headers, 'List-Unsubscribe') !== '',
    date: Number(res.internalDate ?? 0),
    direction: computeDirection(from, ownEmail),
  };
}

export function parseThread(res: GmailThreadResource, ownEmail: string): Thread {
  const messages = (res.messages ?? []).map((m) => parseMessage(m, ownEmail));
  const last = messages[messages.length - 1];
  const participants: Address[] = [];
  const seen = new Set<string>();
  for (const m of messages) {
    for (const a of [m.from, ...m.to]) {
      const key = a.email.toLowerCase();
      if (a.email && !seen.has(key)) {
        seen.add(key);
        participants.push(a);
      }
    }
  }
  const inInbox = (res.messages ?? []).some((m) => m.labelIds?.includes('INBOX'));
  return {
    id: res.id,
    subject: messages[0]?.subject ?? '',
    participants,
    messages,
    lastMessageAt: last?.date ?? 0,
    snippet: res.snippet ?? '',
    inInbox,
    labels: (res.messages?.[0]?.labelIds ?? []),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/mail/gmailParse.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the whole suite + typecheck + lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all tests pass (41 total), typecheck clean, lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/mail/gmailParse.ts tests/mail/gmailParse.test.ts
git commit -m "feat(mail): parse Gmail message/thread resources"
```

---

## Self-Review

**Spec coverage:**
- §8.8 MIME (RFC 2822, RFC 2047 subject, CRLF, base64url, `mailto:` `List-Unsubscribe`, **no** `List-Unsubscribe-Post`) → Task 2. ✔
- §8.5 / §11 send guard (mailing address required for cold, `do_not_contact` block, 25/day + 3/min from `sends`, duplicate warning) → Task 3. ✔
- §7 `Message`/`Thread` fields (rfcMessageId, references, cc, hasListUnsubscribe, direction computed, participants, labels, inInbox) → Task 4. ✔
- Base64/base64url needed for `messages.send` raw and Gmail body decoding → Task 1. ✔

**Deferred to Plan 3 (Gmail provider + OAuth + sync + UI wiring):** HTTP client, `GmailProvider`, `listHistoryChanges`/`getThreadsByIds`, `syncService`, OAuth PKCE + keychain, and swapping the UI from `MockMailboxProvider` to Gmail. These need the user's Google Cloud OAuth setup and cannot be verified headlessly.

**Placeholder scan:** none — every step has runnable code or an exact command.

**Type consistency:** `ComposeInput`, `GuardResult`/`GuardReason`, `GmailMessageResource`/`GmailThreadResource` are defined once and reused; `computeDirection` is imported from the existing `src/services/kanban.ts` (Plan 1). Field names match `src/domain/types.ts`.
