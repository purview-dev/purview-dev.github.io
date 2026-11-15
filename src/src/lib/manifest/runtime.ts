import type { ManifestCacheData } from './remote';

import {
  MANIFEST_CACHE_SCHEMA_VERSION,
  readManifestCache,
  readManifestFixture,
  writeManifestCache,
} from './remote';

export type ManifestSource = 'cache' | 'fixture';

export interface ManifestIndex {
  data: ManifestCacheData;
  source: ManifestSource;
}

let cached: ManifestIndex | null = null;

/**
 * Forget the memoized index so the next call re-reads the cache and fixture.
 *
 * The memo makes rendering cheap, but it also snapshots whichever source existed
 * at the *first* call. `loadProjects()` resolves project-owned records through
 * this accessor, so during `just data-sync` a process that never reset would keep
 * aggregating documentation, skills and assets from the previous snapshot after
 * `sync-manifests` had written a new one — a fresh record would not be seen until
 * the next process.
 */
export function resetManifestIndex(): void {
  cached = null;
}

/**
 * Publish freshly fetched records: write the cache and make this process read it.
 * Every writer must go through here — a bare `writeManifestCache` leaves the memo
 * pointing at the previous source.
 */
export function publishManifestData(data: ManifestCacheData): ManifestIndex {
  writeManifestCache(data);
  cached = { data, source: 'cache' };
  return cached;
}

/**
 * Build-time accessor for project-owned records. Prefers the local cache written
 * by `just data-sync`, then the committed fixture. Never triggers network I/O
 * during rendering, which is what lets an offline `just build` keep working: a
 * repository whose record is missing from both sources simply contributes no
 * remote record, and its local record (if any) still applies.
 */
export function getManifestIndex(): ManifestIndex {
  if (cached) {
    return cached;
  }
  const fromCache = readManifestCache();
  if (fromCache) {
    cached = { data: fromCache, source: 'cache' };
    return cached;
  }
  const fromFixture = readManifestFixture('index');
  if (fromFixture) {
    cached = { data: fromFixture, source: 'fixture' };
    return cached;
  }
  cached = {
    data: { schema: MANIFEST_CACHE_SCHEMA_VERSION, retrievedAt: '', manifests: [] },
    source: 'fixture',
  };
  return cached;
}

/** True when nothing has published project-owned records in this process or run. */
export function hasManifestData(): boolean {
  return getManifestIndex().data.manifests.length > 0;
}
