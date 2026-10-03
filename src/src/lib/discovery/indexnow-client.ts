import type { IndexNowPayload } from './types';

import { INDEXNOW_ENDPOINT } from './indexnow';

/**
 * The single network call in the discovery subsystem. Kept apart from the pure
 * `indexnow.ts` logic so tests never hit the internet and so the retry policy is
 * easy to reason about. Retryable responses are 429 (rate limited) and 5xx; a
 * 4xx other than 429 is a configuration error and is not retried.
 */

export interface IndexNowResponse {
  status: number;
  ok: boolean;
  /** Whether a later attempt could plausibly succeed. */
  retryable: boolean;
  /** Response body, truncated; never contains the key (the key is not echoed). */
  body: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function submitIndexNow(
  payload: IndexNowPayload,
  options: { endpoint?: string; fetchImpl?: FetchLike } = {},
): Promise<IndexNowResponse> {
  const endpoint = options.endpoint ?? INDEXNOW_ENDPOINT;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  const body = await response.text().catch(() => '');
  return {
    status: response.status,
    ok: response.ok,
    retryable: response.status === 429 || response.status >= 500,
    body: body.slice(0, 500),
  };
}

/** POST the batches with bounded exponential backoff on retryable failures. */
export async function submitIndexNowBatches(
  batches: readonly IndexNowPayload[],
  options: {
    endpoint?: string;
    fetchImpl?: FetchLike;
    attempts?: number;
    delayMs?: number;
    onResult?: (batch: number, response: IndexNowResponse) => void;
  } = {},
): Promise<IndexNowResponse[]> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 2_000;
  const results: IndexNowResponse[] = [];

  for (const [index, batch] of batches.entries()) {
    let last: IndexNowResponse | null = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      last = await submitIndexNow(batch, options);
      if (last.ok || !last.retryable) {
        break;
      }
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
    if (last) {
      results.push(last);
      options.onResult?.(index, last);
    }
  }
  return results;
}
