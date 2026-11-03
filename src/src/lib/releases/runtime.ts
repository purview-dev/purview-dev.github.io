import type { DataSource } from './transform';
import type { ReleaseCacheData } from './types';

import { readReleaseCache, readReleaseFixture, writeReleaseCache } from './cache';
import { RELEASE_CACHE_SCHEMA_VERSION } from './types';

export interface ReleaseIndex {
  data: ReleaseCacheData;
  source: DataSource;
}

let cached: ReleaseIndex | null = null;

/**
 * Forget the memoized index so the next call re-reads the cache and fixtures.
 *
 * The memo is what makes rendering cheap, but it also snapshots whichever source
 * existed at the *first* call. During `just data-sync` that first call happens
 * inside the release fetch itself (`loadProjects` reads repository flags through
 * this accessor), i.e. before the freshly fetched cache is written — so a process
 * that only resets on demand would otherwise aggregate documentation from the
 * committed fixtures while the catalogue guard read the new cache, and every
 * channel-promotion decision (ADR 0009) would disagree between the two.
 */
export function resetReleaseIndex(): void {
  cached = null;
}

/**
 * Publish freshly fetched release data: write the cache and make this process
 * read it. Every writer must go through here — a bare `writeReleaseCache` leaves
 * the memo pointing at the previous source.
 */
export function publishReleaseData(data: ReleaseCacheData): ReleaseIndex {
  writeReleaseCache(data);
  cached = { data, source: 'cache' };
  return cached;
}

/**
 * Build-time accessor for release data. Prefers the local cache written by
 * `just fetch-releases`, then committed fixtures. Never triggers network I/O
 * during rendering.
 */
export function getReleaseIndex(): ReleaseIndex {
  if (cached) {
    return cached;
  }
  const fromCache = readReleaseCache();
  if (fromCache) {
    cached = { data: fromCache, source: 'cache' };
    return cached;
  }
  const fromFixture = readReleaseFixture('index');
  if (fromFixture) {
    cached = { data: fromFixture, source: 'fixture' };
    return cached;
  }
  console.warn(
    'No release data available; release sections will render empty. Run `just fetch-releases` and retry.',
  );
  cached = {
    data: {
      schema: RELEASE_CACHE_SCHEMA_VERSION,
      retrievedAt: '',
      repos: {},
      releases: {},
      packages: {},
      packageSearch: {},
    },
    source: 'fixture',
  };
  return cached;
}
