/**
 * Map over items with a bounded number of promises in flight, preserving the
 * input order in the result.
 *
 * The data sync is dominated by HTTPS round trips — one raw file (and, for
 * documentation pages, one commit feed) per page, skill file and asset — and
 * issuing them strictly one at a time made a live sync take minutes. The fetches
 * have no ordering relationship of their own, but every caller derives slugs,
 * page order and reporting order from the array it builds, so the result order
 * must match the input exactly. `limit` keeps the burst small enough not to trip
 * GitHub's or the registries' rate limits.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  map: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await map(items[index] as T, index);
    }
  };
  // Started explicitly rather than with `Array.from({ length }, worker)`, so the
  // worker count cannot be mistaken for the array's only element.
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers: Promise<void>[] = [];
  for (let started = 0; started < workerCount; started += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}
