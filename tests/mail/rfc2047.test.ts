import { describe, it, expect } from 'vitest';
import { decodeRfc2047 } from '../../src/mail/rfc2047';

describe('decodeRfc2047', () => {
  it('passes through plain text', () => {
    expect(decodeRfc2047('Hello world')).toBe('Hello world');
  });
  it('decodes a B-encoded UTF-8 word', () => {
    expect(decodeRfc2047('=?UTF-8?B?Q2Fmw6kg4piV?=')).toBe('Café ☕');
  });
  it('decodes a Q-encoded word (underscore = space)', () => {
    expect(decodeRfc2047('=?UTF-8?Q?Caf=C3=A9?=')).toBe('Café');
  });
  it('joins adjacent encoded-words and drops folding whitespace', () => {
    expect(decodeRfc2047('=?UTF-8?B?SGVsbG8g?= =?UTF-8?B?V29ybGQ=?=')).toBe('Hello World');
  });
  it('decodes mixed plain and encoded text', () => {
    expect(decodeRfc2047('Re: =?UTF-8?B?Q2Fmw6k=?=')).toBe('Re: Café');
  });
});
