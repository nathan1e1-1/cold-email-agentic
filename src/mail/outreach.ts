import type { ColdRecipient, Thread } from '../domain/types';

export const OUTREACH_WINDOW_DAYS = 30;
export const OUTREACH_CAP = 20;
export const OUTREACH_QUERY_BUDGET = 6000;
const MAX_EMAIL_LENGTH = 254;
const MS_PER_DAY = 86_400_000;

const EMAIL = /^[^\s@"(),:;<>\\]+@[^\s@"(),:;<>\\]+\.[^\s@"(),:;<>\\]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isOutreachThread(thread: Thread, recipients: ReadonlySet<string>): boolean {
  return thread.messages.some(
    (m) => m.direction === 'inbound' && recipients.has(normalizeEmail(m.from.email)),
  );
}

/** Known threads we started also count when they contain an inbound reply (e.g. alias reply). */
export function isRelevantThread(
  thread: Thread,
  recipients: ReadonlySet<string>,
  knownThreadIds: ReadonlySet<string>,
): boolean {
  if (isOutreachThread(thread, recipients)) return true;
  if (!knownThreadIds.has(thread.id)) return false;
  return thread.messages.some((m) => m.direction === 'inbound');
}

export function recentRecipientEmails(
  recipients: ColdRecipient[], now: number, days = OUTREACH_WINDOW_DAYS,
): string[] {
  const cutoff = now - days * MS_PER_DAY;
  return recipients.filter((r) => r.lastSentAt >= cutoff).map((r) => r.email);
}

/** Drops the account's own address (self-sends are only shown in test mode). */
export function excludeOwnEmail(emails: string[], ownEmail: string | null | undefined): string[] {
  const own = ownEmail?.trim().toLowerCase();
  if (!own) return emails;
  return emails.filter((email) => normalizeEmail(email) !== own);
}

export function uniqueRecipients(emails: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const email = normalizeEmail(raw);
    if (email.length > MAX_EMAIL_LENGTH || !EMAIL.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

export function buildOutreachQuery(emails: string[]): string {
  const valid = uniqueRecipients(emails);
  if (valid.length === 0) return '';
  return `(${valid.map((e) => `from:"${e}"`).join(' OR ')})`;
}

export function chunkRecipientQueries(
  emails: string[], budget = OUTREACH_QUERY_BUDGET,
): string[] {
  const valid = uniqueRecipients(emails);
  const queries: string[] = [];
  let chunk: string[] = [];
  for (const email of valid) {
    const candidate = buildOutreachQuery([...chunk, email]);
    if (chunk.length > 0 && candidate.length > budget) {
      queries.push(buildOutreachQuery(chunk));
      chunk = [];
    }
    chunk.push(email);
  }
  if (chunk.length > 0) queries.push(buildOutreachQuery(chunk));
  return queries;
}
