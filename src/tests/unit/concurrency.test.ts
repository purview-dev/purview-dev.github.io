import { describe, expect, test } from 'bun:test';

import { mapWithConcurrency } from '../../src/lib/concurrency';

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('mapWithConcurrency', () => {
  test('preserves input order however the work completes', async () => {
    const delays = [25, 0, 10, 5];
    const results = await mapWithConcurrency(delays, 4, async (delay, index) => {
      await settle(delay);
      return index;
    });
    expect(results).toEqual([0, 1, 2, 3]);
  });

  test('never runs more than the limit at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, index) => index);
    await mapWithConcurrency(items, 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await settle(1);
      inFlight -= 1;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  test('maps an empty list without starting any work', async () => {
    let calls = 0;
    const results = await mapWithConcurrency([], 4, async () => {
      calls += 1;
      return 'never';
    });
    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });

  test('propagates a rejection', async () => {
    let caught: unknown;
    try {
      await mapWithConcurrency([1, 2, 3], 2, async (value) => {
        if (value === 2) {
          throw new Error('boom');
        }
        return value;
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('boom');
  });
});
