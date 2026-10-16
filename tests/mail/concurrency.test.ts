import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '../../src/mail/concurrency';

describe('mapWithConcurrency', () => {
  it('runs every item and preserves order', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 2);
    expect(out).toEqual([2, 4, 6, 8]);
  });

  it('paces task starts by minIntervalMs', async () => {
    const delays: number[] = [];
    await mapWithConcurrency([1, 2, 3], 1, async (n) => n, {
      sleep: async (ms) => { delays.push(ms); },
      minIntervalMs: 100,
    });
    expect(delays).toEqual([100, 100, 100]);
  });

  it('does not sleep when no interval is given', async () => {
    let slept = 0;
    await mapWithConcurrency([1, 2], 1, async (n) => n, { sleep: async () => { slept += 1; } });
    expect(slept).toBe(0);
  });
});
