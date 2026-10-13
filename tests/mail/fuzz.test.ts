import { describe, it, expect } from 'vitest';
import { utf8ToBase64Url, base64UrlToUtf8 } from '../../src/mail/encoding';
import { buildMime } from '../../src/mail/mime';
import { decodeRfc2047 } from '../../src/mail/rfc2047';
import { parseMessage, parseThread } from '../../src/mail/gmailParse';
import type { GmailMessageResource } from '../../src/mail/gmailParse';

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOL = [
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i)),
  ...Array.from({ length: 10 }, (_, i) => String.fromCharCode(48 + i)),
  ' ', '!', '?', '=', '_', '<', '>', '"', ',', ';', '\t', ':',
  'é', 'ü', 'ß', '日', '本', '語', '中', '文', '😀', '🎉', '☕', '𝒜',
  '\u0301', '\u007f',
];

function randomString(rng: () => number, maxLen = 60): string {
  const len = Math.floor(rng() * maxLen);
  let s = '';
  for (let i = 0; i < len; i++) s += POOL[Math.floor(rng() * POOL.length)];
  return s;
}

function extractHeader(raw: string, name: string): string {
  const lines = raw.split('\r\n');
  const out: string[] = [];
  let capturing = false;
  for (const line of lines) {
    if (line.startsWith(`${name}: `)) {
      out.push(line.slice(name.length + 2));
      capturing = true;
      continue;
    }
    if (capturing) {
      if (line.startsWith(' ') || line.startsWith('\t')) {
        out.push(line.slice(1));
        continue;
      }
      break;
    }
  }
  return out.join('');
}

const base = { from: 'me@x.com', to: ['them@y.com'], subject: 's', bodyText: 'x' };
const fixed = { messageId: '<id@x.com>', date: new Date(0) };

describe('mail core fuzz', () => {
  it('encoding round-trips random unicode', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 5000; i++) {
      const s = randomString(rng, 80);
      expect(base64UrlToUtf8(utf8ToBase64Url(s))).toBe(s);
    }
  });

  it('MIME subject round-trips (no CR/LF) via decodeRfc2047', () => {
    const rng = mulberry32(2);
    for (let i = 0; i < 8000; i++) {
      const subject = randomString(rng, 60).replace(/[\r\n]/g, ' ');
      const raw = buildMime({ ...base, subject }, fixed);
      expect(decodeRfc2047(extractHeader(raw, 'Subject'))).toBe(subject);
    }
  });

  it('rejects CR/LF injected into ANY header field', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 3000; i++) {
      const evil = `${randomString(rng, 10)}\r\nBcc: evil@x.com`;
      expect(() => buildMime({ ...base, subject: evil }, fixed)).toThrow();
      expect(() => buildMime({ ...base, to: [evil] }, fixed)).toThrow();
      expect(() => buildMime({ ...base, cc: [evil] }, fixed)).toThrow();
      expect(() => buildMime({ ...base, from: evil }, fixed)).toThrow();
      expect(() => buildMime({ ...base, inReplyTo: evil }, fixed)).toThrow();
      expect(() => buildMime({ ...base, references: [evil] }, fixed)).toThrow();
      expect(() => buildMime({ ...base, listUnsubscribeMailto: evil }, fixed)).toThrow();
    }
  });

  it('preserves recipient emails across random address lists', () => {
    const rng = mulberry32(6);
    for (let i = 0; i < 3000; i++) {
      const n = 1 + Math.floor(rng() * 4);
      const emails: string[] = [];
      const headers: string[] = [];
      for (let k = 0; k < n; k++) {
        const local = randomString(rng, 8).replace(/[^a-z0-9]/g, 'a') || 'a';
        const domain = (randomString(rng, 6).replace(/[^a-z]/g, 'b') || 'b') + '.com';
        const email = `${local}@${domain}`;
        emails.push(email);
        const style = rng();
        headers.push(
          style < 0.5
            ? email
            : style < 0.75
              ? `<${email}>`
              : `Some Name <${email}>`,
        );
      }
      const res: GmailMessageResource = {
        id: 'm1',
        threadId: 't1',
        payload: { headers: [{ name: 'To', value: headers.join(', ') }] },
      };
      const parsed = parseMessage(res, 'me@x.com').to.map((a) => a.email);
      expect(parsed).toEqual(emails);
    }
  });

  it('decodeRfc2047 never throws on adversarial encoded-word-like input', () => {
    const rng = mulberry32(7);
    const alphabet = '=?UTF-8BQutf-_0123456789abcXYZ! ';
    for (let i = 0; i < 8000; i++) {
      const len = Math.floor(rng() * 40);
      let s = '';
      for (let k = 0; k < len; k++) s += alphabet[Math.floor(rng() * alphabet.length)];
      expect(() => decodeRfc2047(s)).not.toThrow();
      expect(typeof decodeRfc2047(s)).toBe('string');
    }
  });

  it('gmailParse never throws on random resources and is self-consistent', () => {
    const rng = mulberry32(4);
    for (let i = 0; i < 5000; i++) {
      const res: GmailMessageResource = {
        id: 'm1',
        threadId: 't1',
        internalDate: String(Math.floor(rng() * 1e12)),
        payload: {
          mimeType: 'multipart/alternative',
          headers: [
            { name: 'From', value: randomString(rng, 40) },
            { name: 'To', value: randomString(rng, 40) },
            { name: 'Cc', value: randomString(rng, 40) },
            { name: 'Subject', value: randomString(rng, 40) },
            { name: 'References', value: randomString(rng, 40) },
          ],
          parts: [
            { mimeType: 'text/plain', body: { data: utf8ToBase64Url(randomString(rng, 40)) } },
          ],
        },
      };
      const m = parseMessage(res, 'me@x.com');
      expect(typeof m.bodyText).toBe('string');
      expect(['inbound', 'outbound']).toContain(m.direction);
      const t = parseThread({ id: 't1', messages: [res] }, 'me@x.com');
      expect(t.messages.length).toBe(1);
    }
  });

});
