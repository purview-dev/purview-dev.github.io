/**
 * Reading a repository file from `raw.githubusercontent.com`.
 *
 * The sync asks "does this file exist, and what is in it?", and only a 404 means
 * "it does not exist". Every other failure — a 429 from a throttled runner IP, a
 * 5xx, a dropped connection — says nothing about the file, so it is retried and,
 * if it persists, thrown. Treating those as "absent" used to drop pages from the
 * mirror without a word, or fail far from the cause ("no root page exists") when
 * the dropped file happened to be the docs root.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RawFetchOptions {
  fetchImpl?: FetchLike;
  /** Total attempts, including the first. */
  attempts?: number;
  /** Base delay; attempt `n` waits `baseDelayMs * 2^(n-1)` unless `Retry-After` says otherwise. */
  baseDelayMs?: number;
  /** Upper bound on any single wait, including one requested by `Retry-After`. */
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class RawFetchError extends Error {
  constructor(
    readonly url: string,
    readonly status: number | null,
    detail: string,
  ) {
    super(`raw.githubusercontent.com: ${detail} for ${url}`);
    this.name = 'RawFetchError';
  }
}

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 30_000;

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Milliseconds a `Retry-After` header asks for (seconds or an HTTP date), or null. */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | null {
  if (!header) {
    return null;
  }
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1_000;
  }
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The file's text, or null when the server says it does not exist (404).
 * Retryable failures are retried with exponential backoff; anything still
 * failing afterwards, and any other non-OK status, throws a `RawFetchError`.
 */
export async function fetchRawText(
  url: string,
  options: RawFetchOptions = {},
): Promise<string | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: RawFetchError | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let requestedDelay: number | null = null;
    try {
      const response = await fetchImpl(url);
      if (response.ok) {
        return await response.text();
      }
      if (response.status === 404) {
        return null;
      }
      if (!isRetryableStatus(response.status)) {
        throw new RawFetchError(url, response.status, `HTTP ${response.status}`);
      }
      lastError = new RawFetchError(
        url,
        response.status,
        `HTTP ${response.status} after ${attempt} attempt(s)`,
      );
      requestedDelay = retryAfterMs(response.headers.get('retry-after'));
    } catch (error) {
      if (error instanceof RawFetchError) {
        throw error;
      }
      // A network-level failure (reset, DNS, TLS) is as transient as a 5xx.
      lastError = new RawFetchError(
        url,
        null,
        `${(error as Error).message} after ${attempt} attempt(s)`,
      );
    }
    if (attempt < attempts) {
      const backoff = baseDelayMs * 2 ** (attempt - 1);
      await sleep(Math.min(maxDelayMs, requestedDelay ?? backoff));
    }
  }
  throw lastError ?? new RawFetchError(url, null, 'no response');
}
