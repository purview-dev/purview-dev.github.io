import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { readReleaseCache, readReleaseFixture, writeReleaseCache } from '../src/lib/releases/cache';
import { fetchReleaseData } from './fetch-releases';
import { processBranding } from './process-branding';
import { hasDocsMirror, syncDocs } from './sync-docs';

const RELEASES_CACHE_FILE = resolve('.cache/releases/releases.json');

type Mode = 'auto' | 'live' | 'cache' | 'fixture';

function resolveMode(): Mode {
  const value = (process.env.DATA_MODE ?? 'auto').toLowerCase();
  if (value === 'live' || value === 'cache' || value === 'fixture') {
    return value;
  }
  return 'auto';
}

async function syncReleases(mode: Mode): Promise<void> {
  if (mode === 'fixture') {
    if (!readReleaseFixture('index')) {
      throw new Error(
        'DATA_MODE=fixture but no release fixture exists at fixtures/releases/index.json',
      );
    }
    console.log('Releases: using committed fixtures.');
    return;
  }
  if (mode === 'cache') {
    if (!readReleaseCache()) {
      throw new Error(
        'DATA_MODE=cache but no release cache exists. Run `just fetch-releases` first.',
      );
    }
    console.log('Releases: using existing cache.');
    return;
  }
  if (mode === 'live') {
    const data = await fetchReleaseData();
    writeReleaseCache(data);
    console.log('Releases: fetched live data.');
    return;
  }
  // auto: cache-first, then live, then committed fixtures.
  if (readReleaseCache()) {
    console.log('Releases: using existing cache.');
    return;
  }
  try {
    const data = await fetchReleaseData();
    writeReleaseCache(data);
    console.log('Releases: fetched live data.');
    return;
  } catch (error) {
    console.warn(`Releases: live fetch failed (${(error as Error).message}).`);
  }
  if (process.env.DATA_FALLBACK_TO_FIXTURES !== 'false' && readReleaseFixture('index')) {
    console.warn('Releases: falling back to committed fixtures.');
    return;
  }
  throw new Error(
    'No release data available: cache is missing, live fetch failed, and no fixtures are present. Run `just fetch-releases` and retry.',
  );
}

async function syncDocsMirror(mode: Mode): Promise<void> {
  if (mode === 'cache' || mode === 'fixture') {
    if (hasDocsMirror()) {
      console.log('Docs: using existing mirror.');
      return;
    }
    if (mode === 'cache') {
      throw new Error(
        'DATA_MODE=cache but no docs mirror exists at src/content/docs/docs. Run `just data-sync` with live mode first.',
      );
    }
  }
  if (hasDocsMirror() && mode === 'auto') {
    console.log('Docs: using existing mirror.');
    return;
  }
  await syncDocs();
}

/** Orchestrate all build-time data preparation (branding, releases, docs). */
export async function dataSync(): Promise<void> {
  const mode = resolveMode();
  console.log(`Data sync (mode=${mode})`);
  await processBranding();
  // Releases are fetched first so the docs aggregation can enrich content with
  // repository descriptions and topics (tags) from the release cache.
  await syncReleases(mode);
  await syncDocsMirror(mode);
  if (!existsSync(RELEASES_CACHE_FILE) && !readReleaseFixture('index')) {
    console.warn(
      'Note: release data is unavailable. The releases page will be empty until `just fetch-releases` runs.',
    );
  }
}

if (import.meta.main) {
  await dataSync();
}
