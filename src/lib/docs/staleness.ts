/**
 * Configurable staleness definition for aggregated documentation.
 * A page is "stale" when its `lastReviewed` date is older than
 * STALE_AFTER_DAYS. The threshold lives here (a config constant), not
 * embedded in UI components.
 */

export const STALE_AFTER_DAYS = 365;

export function parseDate(value: string): Date {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

/** Whole days elapsed between `dateStr` and `todayStr` (>= 0). */
export function daysSince(dateStr: string, todayStr: string): number {
  const start = parseDate(dateStr);
  const today = parseDate(todayStr);
  const millis = today.getTime() - start.getTime();
  return Math.max(0, Math.floor(millis / 86_400_000));
}

/** Whether a `lastReviewed` date is stale relative to the given today. */
export function isStale(lastReviewed: string, todayStr?: string): boolean {
  const today = todayStr ?? new Date().toISOString();
  return daysSince(lastReviewed, today) >= STALE_AFTER_DAYS;
}
