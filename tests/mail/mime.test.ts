import { describe, it, expect } from 'vitest';
import { buildMime, buildRawMessage } from '../../src/mail/mime';
import { base64ToUtf8, base64UrlToUtf8 } from '../../src/mail/encoding';
import { decodeRfc2047 } from '../../src/mail/rfc2047';

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

  it('rejects CR/LF in header values (header injection)', () => {
    expect(() => buildMime({ ...base, subject: 'Hi\r\nBcc: evil@x.com' }, fixed)).toThrow(/CR\/LF/);
    expect(() => buildMime({ ...base, to: ['v@y.com\r\nBcc: evil@x.com'] }, fixed)).toThrow(/CR\/LF/);
    expect(() => buildMime({ ...base, references: ['<a@x>\r\nBcc: evil@x.com'] }, fixed)).toThrow(/CR\/LF/);
  });

  it('includes Cc when provided', () => {
    expect(buildMime({ ...base, cc: ['cc@y.com'] }, fixed)).toContain('Cc: cc@y.com\r\n');
  });

  it('normalizes body newlines to CRLF and round-trips the body', () => {
    const raw = buildMime({ ...base, bodyText: 'line1\nline2' }, fixed);
    const b64 = raw.split('\r\n\r\n')[1].replace(/\r\n/g, '');
    expect(base64ToUtf8(b64)).toBe('line1\r\nline2');
  });

  it('throws when there are no recipients', () => {
    expect(() => buildMime({ ...base, to: [] }, fixed)).toThrow(/recipient/i);
  });

  it('splits long non-ASCII subjects into encoded-words within the 75-char limit', () => {
    const raw = buildMime({ ...base, subject: '日本語のとても長い件名'.repeat(6) }, fixed);
    expect(raw).toContain('Subject: =?UTF-8?B?');
    const words = raw.match(/=\?UTF-8\?B\?[^?]+\?=/g) ?? [];
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) expect(w.length).toBeLessThanOrEqual(75);
  });

  it('generates a well-formed Message-ID for a display-name From', () => {
    const raw = buildMime({ ...base, from: 'Nathan <me@x.com>' });
    const line = raw.split('\r\n').find((l) => l.startsWith('Message-ID:'))!;
    expect(line).toMatch(/^Message-ID: <[^<>]+@x\.com>$/);
  });

  it('round-trips long multi-byte subjects through RFC 2047 words', () => {
    const subject = 'Emoji 😀🎉 and CJK 日本語'.repeat(5);
    const raw = buildMime({ ...base, subject }, fixed);
    const words = raw.match(/=\?UTF-8\?B\?[^?]+\?=/g) ?? [];
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) expect(w.length).toBeLessThanOrEqual(75);
    expect(words.map((w) => decodeRfc2047(w)).join('')).toBe(subject);
  });

  it('encodes an ASCII subject that literally contains an encoded-word', () => {
    const subject = '=?UTF-8?B?QQ==?=';
    const raw = buildMime({ ...base, subject }, fixed);
    const words = raw.match(/=\?UTF-8\?B\?[^?]+\?=/g) ?? [];
    expect(words.length).toBeGreaterThan(0);
    expect(words.map((w) => decodeRfc2047(w)).join('')).toBe(subject);
  });
});