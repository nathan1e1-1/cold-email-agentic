import { describe, it, expect } from 'vitest';
import { AUTO_REFRESH_MS, shouldAutoRefresh } from '../../src/mail/autoRefresh';

describe('shouldAutoRefresh', () => {
  it('refreshes when visible and the interval elapsed', () => {
    expect(shouldAutoRefresh('visible', 0, AUTO_REFRESH_MS, false)).toBe(true);
  });

  it('waits for the interval', () => {
    expect(shouldAutoRefresh('visible', 1_000, 1_000 + AUTO_REFRESH_MS - 1, false)).toBe(false);
  });

  it('never polls while hidden', () => {
    expect(shouldAutoRefresh('hidden', 0, AUTO_REFRESH_MS * 10, false)).toBe(false);
    expect(shouldAutoRefresh('prerender', 0, AUTO_REFRESH_MS * 10, false)).toBe(false);
  });

  it('never overlaps an in-flight refresh', () => {
    expect(shouldAutoRefresh('visible', 0, AUTO_REFRESH_MS * 10, true)).toBe(false);
  });
});
