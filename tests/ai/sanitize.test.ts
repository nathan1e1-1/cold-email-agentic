import { describe, it, expect } from 'vitest';
import { cleanDraft } from '../../src/ai/sanitize';

describe('cleanDraft', () => {
  it('trims whitespace', () => {
    expect(cleanDraft('  Hi there  ')).toBe('Hi there');
  });

  it('strips a trailing stray backslash', () => {
    expect(cleanDraft('Have a great weekend as well.\\')).toBe('Have a great weekend as well.');
  });

  it('strips a wrapping code fence', () => {
    expect(cleanDraft('```\nHello\n```')).toBe('Hello');
  });

  it('leaves normal text untouched', () => {
    expect(cleanDraft('Sounds good, see you Tuesday.')).toBe('Sounds good, see you Tuesday.');
  });
});
