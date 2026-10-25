import { describe, it, expect } from 'vitest';
import {
  normalizeEmail, isOutreachThread, recentRecipientEmails,
  buildOutreachQuery, chunkRecipientQueries,
  OUTREACH_QUERY_BUDGET,
} from '../../src/mail/outreach';
import type { Thread } from '../../src/domain/types';

function thread(from: string, direction: 'inbound' | 'outbound' = 'inbound'): Thread {
  return {
    id: 't1', subject: 's', participants: [{ email: from }], labels: [],
    lastMessageAt: 1, snippet: '', inInbox: true,
    messages: [{
      id: 'm1', rfcMessageId: '', references: [], from: { email: from },
      to: [], cc: [], subject: 's', bodyText: '', hasListUnsubscribe: false,
      date: 1, direction,
    }],
  };
}

const recipients = new Set(['a@z.com', 'b@z.com']);

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  A@Z.com ')).toBe('a@z.com');
  });
});

describe('isOutreachThread', () => {
  it('matches an inbound message from a recipient, case-insensitively', () => {
    expect(isOutreachThread(thread('A@Z.com'), recipients)).toBe(true);
  });
  it('rejects outbound-only messages', () => {
    expect(isOutreachThread(thread('a@z.com', 'outbound'), recipients)).toBe(false);
  });
  it('rejects an unrelated sender', () => {
    expect(isOutreachThread(thread('stranger@z.com'), recipients)).toBe(false);
  });
});

describe('recentRecipientEmails', () => {
  it('keeps only sends inside the window', () => {
    const now = 100 * 86_400_000;
    const list = [
      { email: 'old@z.com', lastSentAt: now - 31 * 86_400_000 },
      { email: 'new@z.com', lastSentAt: now - 1 * 86_400_000 },
    ];
    expect(recentRecipientEmails(list, now)).toEqual(['new@z.com']);
  });
});

describe('buildOutreachQuery', () => {
  it('quotes, dedupes, and lowercases recipients', () => {
    expect(buildOutreachQuery(['A@Z.com', 'a@z.com', 'b@z.com']))
      .toBe('(from:"a@z.com" OR from:"b@z.com")');
  });
  it('drops invalid addresses and returns empty for no valid input', () => {
    expect(buildOutreachQuery(['not-an-email', 'a b@z.com'])).toBe('');
  });
  it('drops an address ending in a backslash', () => {
    expect(buildOutreachQuery(['a@z.com\\'])).toBe('');
  });
});

describe('chunkRecipientQueries', () => {
  it('splits into queries no longer than the budget without dropping or duplicating recipients', () => {
    const many = Array.from({ length: 500 }, (_, i) => `person${i}@example.com`);
    const queries = chunkRecipientQueries(many);
    expect(queries.length).toBeGreaterThan(1);
    for (const q of queries) expect(q.length).toBeLessThanOrEqual(OUTREACH_QUERY_BUDGET);
    const extracted = queries.flatMap((q) =>
      [...q.matchAll(/from:"([^"]+)"/g)].map((m) => m[1] ?? ''),
    );
    expect(new Set(extracted)).toEqual(new Set(many));
    expect(extracted.length).toBe(many.length);
  });
  it('returns no queries for an empty input', () => {
    expect(chunkRecipientQueries([])).toEqual([]);
  });
  it('drops addresses longer than the RFC maximum', () => {
    const tooLong = `${'a'.repeat(300)}@example.com`;
    const queries = chunkRecipientQueries(['a@z.com', tooLong]);
    const extracted = queries.flatMap((q) =>
      [...q.matchAll(/from:"([^"]+)"/g)].map((m) => m[1] ?? ''),
    );
    expect(extracted).toEqual(['a@z.com']);
    for (const q of queries) expect(q.length).toBeLessThanOrEqual(OUTREACH_QUERY_BUDGET);
  });
});
