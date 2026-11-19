import type { FetchLike } from '../../src/lib/docs/raw-fetch';

import { describe, expect, test } from 'bun:test';

import {
  RawFetchError,
  fetchRawText,
  isRetryableStatus,
  retryAfterMs,
} from '../../src/lib/docs/raw-fetch';

const URL = 'https://raw.githubusercontent.com/purview-dev/containers/main/docs/wiki/Home.md';

/** A fetch that replays the given responses (or throws the given errors) in order. */
function scripted(steps: (Response | Error)[]): { fetchImpl: FetchLike; calls: () => number } {
  let calls = 0;
  const fetchImpl: FetchLike = async () => {
    const step = steps[Math.min(calls, steps.length - 1)];
    calls += 1;
    if (step instanceof Error) {
      throw step;
    }
    return step!.clone();
  };
  return { fetchImpl, calls: () => calls };
}

function recordingSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return { sleep: async (ms) => void waits.push(ms), waits };
}

describe('fetchRawText', () => {
  test('returns the body of a successful response', async () => {
    const { fetchImpl, calls } = scripted([new Response('# Home')]);
    expect(await fetchRawText(URL, { fetchImpl })).toBe('# Home');
    expect(calls()).toBe(1);
  });

  test('returns null only for 404, without retrying', async () => {
    const { fetchImpl, calls } = scripted([new Response('', { status: 404 })]);
    expect(await fetchRawText(URL, { fetchImpl })).toBeNull();
    expect(calls()).toBe(1);
  });

  test('retries a 429 and a 5xx, then returns the file', async () => {
    const { sleep, waits } = recordingSleep();
    const { fetchImpl, calls } = scripted([
      new Response('', { status: 429 }),
      new Response('', { status: 503 }),
      new Response('# Home'),
    ]);
    expect(await fetchRawText(URL, { fetchImpl, sleep, baseDelayMs: 100 })).toBe('# Home');
    expect(calls()).toBe(3);
    expect(waits).toEqual([100, 200]);
  });

  test('retries a network error', async () => {
    const { sleep } = recordingSleep();
    const { fetchImpl, calls } = scripted([new TypeError('socket hang up'), new Response('ok')]);
    expect(await fetchRawText(URL, { fetchImpl, sleep })).toBe('ok');
    expect(calls()).toBe(2);
  });

  test('honours Retry-After, capped at maxDelayMs', async () => {
    const { sleep, waits } = recordingSleep();
    const { fetchImpl } = scripted([
      new Response('', { status: 429, headers: { 'Retry-After': '3' } }),
      new Response('', { status: 429, headers: { 'Retry-After': '120' } }),
      new Response('ok'),
    ]);
    await fetchRawText(URL, { fetchImpl, sleep, maxDelayMs: 10_000 });
    expect(waits).toEqual([3_000, 10_000]);
  });

  test('throws with the status and URL when retries are exhausted, never null', async () => {
    const { sleep, waits } = recordingSleep();
    const { fetchImpl, calls } = scripted([new Response('', { status: 429 })]);
    const failure = fetchRawText(URL, { fetchImpl, sleep, attempts: 3 });
    await expect(failure).rejects.toBeInstanceOf(RawFetchError);
    await expect(failure).rejects.toThrow(`HTTP 429 after 3 attempt(s) for ${URL}`);
    expect(calls()).toBe(3);
    expect(waits).toHaveLength(2);
  });

  test('throws immediately on a non-retryable status', async () => {
    const { fetchImpl, calls } = scripted([new Response('', { status: 403 })]);
    await expect(fetchRawText(URL, { fetchImpl })).rejects.toThrow('HTTP 403');
    expect(calls()).toBe(1);
  });
});

describe('isRetryableStatus', () => {
  test('retries throttling, timeouts and server errors only', () => {
    expect([408, 429, 500, 502, 503, 504].every(isRetryableStatus)).toBe(true);
    expect([400, 401, 403, 404, 410].some(isRetryableStatus)).toBe(false);
  });
});

describe('retryAfterMs', () => {
  test('reads delta-seconds and HTTP dates', () => {
    expect(retryAfterMs('5')).toBe(5_000);
    const now = Date.parse('2026-11-19T18:00:00Z');
    expect(retryAfterMs('Thu, 19 Nov 2026 18:00:10 GMT', now)).toBe(10_000);
    expect(retryAfterMs('Thu, 19 Nov 2026 17:00:00 GMT', now)).toBe(0);
  });

  test('ignores a missing or unreadable header', () => {
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs('soon')).toBeNull();
  });
});
