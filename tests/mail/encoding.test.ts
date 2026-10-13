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
