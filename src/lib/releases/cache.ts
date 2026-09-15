import type { ReleaseCacheData } from './types';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { RELEASE_CACHE_SCHEMA_VERSION } from './types';

export const CACHE_DIR = resolve('.cache', 'releases');
export const CACHE_FILE = resolve(CACHE_DIR, 'releases.json');
export const FIXTURE_DIR = resolve('fixtures', 'releases');

/** Structural guard so a corrupt or stale cache can never be silently consumed. */
export function isReleaseCache(data: unknown): data is ReleaseCacheData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const candidate = data as Record<string, unknown>;
  if (candidate.schema !== RELEASE_CACHE_SCHEMA_VERSION) {
    return false;
  }
  if (typeof candidate.retrievedAt !== 'string') {
    return false;
  }
  if (typeof candidate.repos !== 'object' || candidate.repos === null) {
    return false;
  }
  if (typeof candidate.releases !== 'object' || candidate.releases === null) {
    return false;
  }
  if (typeof candidate.packages !== 'object' || candidate.packages === null) {
    return false;
  }
  if (typeof candidate.packageSearch !== 'object' || candidate.packageSearch === null) {
    return false;
  }
  return true;
}

export function readReleaseCache(file = CACHE_FILE): ReleaseCacheData | null {
  if (!existsSync(file)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return isReleaseCache(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeReleaseCache(data: ReleaseCacheData, file = CACHE_FILE): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function readReleaseFixture(name: string): ReleaseCacheData | null {
  const file = resolve(FIXTURE_DIR, `${name}.json`);
  if (!existsSync(file)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return isReleaseCache(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
