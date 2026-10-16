import { afterEach, describe, expect, test } from 'bun:test';

import {
  LIVE_VERSIONS_SCHEMA,
  LIVE_VERSIONS_STORAGE_KEY,
  LIVE_VERSIONS_TTL_MS,
  fetchLiveVersions,
  isStale,
  latestFromVersions,
  mergeVersionPair,
  preferNewer,
  prereleaseTooltip,
  projectTooltip,
  readLiveVersions,
  refreshLiveVersions,
  rollupPackageVersions,
  versionStatusMessage,
  writeLiveVersions,
  type LiveVersions,
} from '../../src/lib/releases/live';

/** Minimal in-memory Storage so the cache logic can be tested without a browser. */
class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }
}

const realWindow = (globalThis as { window?: unknown }).window;
const realFetch = globalThis.fetch;

function useWindow(storage: Storage | null): void {
  (globalThis as { window?: unknown }).window =
    storage === null ? undefined : { localStorage: storage };
}

/** Replace `fetch` with a canned handler, so the refresh path is tested offline. */
function stubFetch(handler: (url: string) => { ok: boolean; status?: number; body?: unknown }) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const result = handler(url);
    return {
      ok: result.ok,
      status: result.status ?? (result.ok ? 200 : 500),
      json: async () => result.body ?? {},
    } as Response;
  }) as typeof fetch;
}

afterEach(() => {
  (globalThis as { window?: unknown }).window = realWindow;
  globalThis.fetch = realFetch;
});

describe('latest version selection', () => {
  test('picks the highest stable and the prerelease that outranks it', () => {
    expect(latestFromVersions(['1.0.0', '1.1.0', '1.2.0-prerelease.1'])).toEqual({
      stable: '1.1.0',
      prerelease: '1.2.0-prerelease.1',
    });
  });

  test('withholds a prerelease that trails the stable release', () => {
    expect(latestFromVersions(['1.0.0', '1.1.0', '1.0.5-prerelease.2'])).toEqual({
      stable: '1.1.0',
      prerelease: null,
    });
  });

  test('keeps the fourth (revision) component only when it is non-zero', () => {
    expect(latestFromVersions(['13.5.3.6']).stable).toBe('13.5.3.6');
    expect(latestFromVersions(['13.5.3.0']).stable).toBe('13.5.3');
  });

  test('reports nothing for an empty or invalid list', () => {
    expect(latestFromVersions([])).toEqual({ stable: null, prerelease: null });
    expect(latestFromVersions(['not-a-version'])).toEqual({ stable: null, prerelease: null });
  });
});

describe('live versions never downgrade the build', () => {
  test('keeps the build-time version when the live one is older', () => {
    // The build reconciles GitHub release tags into the candidate list, so the
    // build-time value can legitimately be ahead of the NuGet flat container.
    expect(preferNewer('1.1.1', '1.1.0')).toBe('1.1.1');
  });

  test('takes the live version when it is newer', () => {
    expect(preferNewer('1.0.6', '1.1.0')).toBe('1.1.0');
  });

  test('fills a gap when the build had no version', () => {
    expect(preferNewer(null, '1.0.0')).toBe('1.0.0');
    expect(preferNewer(null, null)).toBeNull();
  });

  test('merges each channel independently', () => {
    expect(
      mergeVersionPair(
        { stable: '1.0.6', prerelease: null },
        { stable: '1.1.0', prerelease: '2.0.0-prerelease.1' },
      ),
    ).toEqual({ stable: '1.1.0', prerelease: '2.0.0-prerelease.1' });
  });

  test('keeps a live prerelease that outranks the stable', () => {
    // The real shape of the catalogue: a stable release and a prerelease of the
    // next major, both worth showing.
    expect(
      mergeVersionPair(
        { stable: '1.0.1', prerelease: null },
        { stable: '1.0.1', prerelease: '2.0.0-prerelease.4' },
      ),
    ).toEqual({ stable: '1.0.1', prerelease: '2.0.0-prerelease.4' });
  });

  test('withholds a live prerelease that trails the build-time stable', () => {
    // The build can be ahead of NuGet (a release tag it has not published), so a
    // live prerelease can arrive beside a build-time stable that it trails. A
    // per-channel merge would resurrect that trailing prerelease.
    expect(
      mergeVersionPair(
        { stable: '1.0.2', prerelease: null },
        { stable: null, prerelease: '1.0.0-prerelease.2' },
      ),
    ).toEqual({ stable: '1.0.2', prerelease: null });
  });

  test('withholds a build-time prerelease once a higher live stable arrives', () => {
    expect(
      mergeVersionPair(
        { stable: '1.0.0', prerelease: '2.0.0-prerelease.4' },
        { stable: '2.0.0', prerelease: null },
      ),
    ).toEqual({ stable: '2.0.0', prerelease: null });
  });

  test('keeps a prerelease that still outranks the merged stable', () => {
    // Purview.EventSourcing: NuGet publishes only 2.0.0-prerelease.x while the
    // build also knows the 1.1.1 release tag, so both stay on screen.
    expect(
      mergeVersionPair(
        { stable: '1.1.1', prerelease: '2.0.0-prerelease.39' },
        { stable: null, prerelease: '2.0.0-prerelease.39' },
      ),
    ).toEqual({ stable: '1.1.1', prerelease: '2.0.0-prerelease.39' });
  });

  test('returns the current pair when the package has no live data', () => {
    const current = { stable: '1.0.6', prerelease: null };
    expect(mergeVersionPair(current, undefined)).toEqual(current);
  });
});

describe('project version rollup', () => {
  test('withholds a prerelease that trails the highest stable', () => {
    const rollup = rollupPackageVersions([
      { stable: '13.5.3.6', prerelease: null },
      { stable: null, prerelease: '13.3.0-prerelease.10' },
    ]);
    expect(rollup.stableVersion).toBe('13.5.3.6');
    expect(rollup.prereleaseVersion).toBeNull();
    expect(rollup.suppressedPrerelease).toBe('13.3.0-prerelease.10');
    expect(rollup.laggingPackageCount).toBe(0);
  });

  test('reports a prerelease that outranks the stable', () => {
    const rollup = rollupPackageVersions([
      { stable: '1.0.0', prerelease: null },
      { stable: '1.1.0', prerelease: null },
      { stable: null, prerelease: '2.0.0-prerelease.1' },
    ]);
    expect(rollup.stableVersion).toBe('1.1.0');
    expect(rollup.prereleaseVersion).toBe('2.0.0-prerelease.1');
    // The prerelease is the headline, so packages without one are not "lagging"
    // behind it; only packages on a different published version would be.
    expect(rollup.laggingPackageCount).toBe(0);
  });

  test('counts packages trailing the headline stable version', () => {
    const rollup = rollupPackageVersions([
      { stable: '1.0.0', prerelease: null },
      { stable: '1.1.0', prerelease: null },
    ]);
    expect(rollup.stableVersion).toBe('1.1.0');
    expect(rollup.prereleaseVersion).toBeNull();
    expect(rollup.laggingPackageCount).toBe(1);
  });

  test('an empty project has no versions', () => {
    expect(rollupPackageVersions([])).toEqual({
      stableVersion: null,
      prereleaseVersion: null,
      suppressedPrerelease: null,
      laggingPackageCount: 0,
    });
  });
});

describe('tooltips', () => {
  test('explain a withheld prerelease', () => {
    expect(
      prereleaseTooltip({
        stableVersion: '1.1.0',
        prereleaseVersion: null,
        suppressedPrerelease: '1.0.5-prerelease.2',
        laggingPackageCount: 0,
        packageCount: 1,
      }),
    ).toBe('Prerelease 1.0.5-prerelease.2 is older than the stable release 1.1.0');
  });

  test('are absent when there is nothing to explain', () => {
    expect(
      prereleaseTooltip({
        stableVersion: '1.1.0',
        prereleaseVersion: null,
        suppressedPrerelease: null,
        laggingPackageCount: 0,
        packageCount: 1,
      }),
    ).toBeUndefined();
    expect(
      projectTooltip({
        stableVersion: '1.1.0',
        prereleaseVersion: null,
        suppressedPrerelease: null,
        laggingPackageCount: 0,
        packageCount: 3,
      }),
    ).toBeUndefined();
  });
});

describe('stored live versions', () => {
  test('round-trips through storage', () => {
    useWindow(new MemoryStorage());
    const written = writeLiveVersions({ 'Purview.ZodSharp': ['1.0.0', '1.1.0'] });
    expect(written).not.toBeNull();
    const read = readLiveVersions();
    expect(read?.versions).toEqual({ 'Purview.ZodSharp': ['1.0.0', '1.1.0'] });
    expect(read?.schema).toBe(LIVE_VERSIONS_SCHEMA);
  });

  test('rejects a payload written by a different schema version', () => {
    const storage = new MemoryStorage();
    useWindow(storage);
    storage.setItem(
      LIVE_VERSIONS_STORAGE_KEY,
      JSON.stringify({ schema: LIVE_VERSIONS_SCHEMA + 1, fetchedAt: '', versions: {} }),
    );
    expect(readLiveVersions()).toBeNull();
  });

  test('rejects unreadable storage content', () => {
    const storage = new MemoryStorage();
    useWindow(storage);
    storage.setItem(LIVE_VERSIONS_STORAGE_KEY, '{not json');
    expect(readLiveVersions()).toBeNull();
  });

  test('is a no-op without a browser storage', () => {
    useWindow(null);
    expect(readLiveVersions()).toBeNull();
    expect(writeLiveVersions({ a: ['1.0.0'] })).toBeNull();
  });

  test('treats a copy older than the TTL as stale', () => {
    const fresh: LiveVersions = {
      schema: LIVE_VERSIONS_SCHEMA,
      fetchedAt: new Date().toISOString(),
      versions: {},
    };
    expect(isStale(fresh)).toBe(false);
    const aged: LiveVersions = {
      ...fresh,
      fetchedAt: new Date(Date.now() - LIVE_VERSIONS_TTL_MS - 1).toISOString(),
    };
    expect(isStale(aged)).toBe(true);
    expect(isStale({ ...fresh, fetchedAt: 'not a date' })).toBe(true);
  });
});

describe('live fetch', () => {
  test('reads versions from the flat container and lowercases the id', async () => {
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(url);
      return { ok: true, body: { versions: ['1.0.0', '1.1.0'] } };
    });
    const versions = await fetchLiveVersions(['Purview.ZodSharp']);
    expect(versions).toEqual({ 'Purview.ZodSharp': ['1.0.0', '1.1.0'] });
    expect(seen[0]).toContain('/purview.zodsharp/index.json');
  });

  test('keeps the other packages when one fetch fails', async () => {
    stubFetch((url) =>
      url.includes('broken')
        ? { ok: false, status: 404 }
        : { ok: true, body: { versions: ['1.0.0'] } },
    );
    const versions = await fetchLiveVersions(['Broken.Package', 'Good.Package']);
    expect(versions).toEqual({ 'Good.Package': ['1.0.0'] });
  });

  test('shares one request across concurrent callers', async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return { ok: true, body: { versions: ['1.0.0'] } };
    });
    await Promise.all([fetchLiveVersions(['A.B']), fetchLiveVersions(['A.B'])]);
    expect(calls).toBe(1);
  });

  test('refreshes over the stored copy and stores the merge', async () => {
    const storage = new MemoryStorage();
    useWindow(storage);
    const previous = writeLiveVersions({ 'A.B': ['1.0.0'], 'C.D': ['2.0.0'] });
    stubFetch((url) =>
      url.includes('a.b')
        ? { ok: true, body: { versions: ['1.0.0', '1.1.0'] } }
        : { ok: false, status: 503 },
    );
    const refreshed = await refreshLiveVersions(['A.B', 'C.D'], previous);
    expect(refreshed?.versions).toEqual({ 'A.B': ['1.0.0', '1.1.0'], 'C.D': ['2.0.0'] });
    expect(readLiveVersions()?.versions).toEqual(refreshed?.versions);
  });

  test('returns the previous record when nothing could be fetched', async () => {
    const previous: LiveVersions = {
      schema: LIVE_VERSIONS_SCHEMA,
      fetchedAt: new Date().toISOString(),
      versions: { 'A.B': ['1.0.0'] },
    };
    stubFetch(() => ({ ok: false, status: 500 }));
    expect(await refreshLiveVersions(['A.B'], previous)).toEqual(previous);
  });
});

describe('status messages', () => {
  const live: LiveVersions = {
    schema: LIVE_VERSIONS_SCHEMA,
    fetchedAt: new Date().toISOString(),
    versions: {},
  };

  test('name the state of the check', () => {
    expect(versionStatusMessage('checking', null)).toContain('Checking NuGet');
    expect(versionStatusMessage('live', live)).toContain('checked against NuGet');
    expect(versionStatusMessage('stored', live)).toContain('last checked against NuGet');
    expect(versionStatusMessage('unavailable', null)).toContain('could not be reached');
    expect(versionStatusMessage('idle', null)).toBe('');
  });
});
