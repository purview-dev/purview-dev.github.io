import type { DataSource } from './transform';
import type { ReleaseCacheData } from './types';

import { readReleaseCache, readReleaseFixture } from './cache';

export interface ReleaseIndex {
  data: ReleaseCacheData;
  source: DataSource;
}

let cached: ReleaseIndex | null = null;

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
      schema: 1,
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
