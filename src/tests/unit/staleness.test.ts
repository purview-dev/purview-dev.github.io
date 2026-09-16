import { describe, expect, test } from 'bun:test';

import { daysSince, isStale, STALE_AFTER_DAYS, parseDate } from '../../src/lib/docs/staleness';

describe('staleness', () => {
  test('the threshold is a config constant', () => {
    expect(STALE_AFTER_DAYS).toBe(365);
  });

  test('parseDate handles invalid values safely', () => {
    expect(parseDate('not-a-date').getTime()).toBe(0);
    expect(parseDate('2026-09-15').getTime()).toBeGreaterThan(0);
  });

  test('daysSince returns whole elapsed days', () => {
    expect(daysSince('2026-09-01', '2026-09-15')).toBe(14);
    expect(daysSince('2026-09-15', '2026-09-15')).toBe(0);
    expect(daysSince('2026-09-20', '2026-09-15')).toBe(0);
  });

  test('a page is stale at the threshold boundary', () => {
    const today = '2026-09-15T00:00:00Z';
    const oneYearAgo = '2025-09-15T00:00:00Z';
    const dayBefore = '2025-09-16T00:00:00Z';
    expect(isStale(oneYearAgo, today)).toBe(true);
    expect(isStale(dayBefore, today)).toBe(false);
  });
});
