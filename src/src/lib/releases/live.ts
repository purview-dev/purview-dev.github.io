import { compareNuGetVersions, formatNuGetVersion } from '../nuget-version';
import { effectivePrerelease, selectVersions } from './normalize';

/**
 * Live NuGet version resolution for the browser (ADR 0008).
 *
 * The site is static: every version it shows is baked in at build time. A
 * package published after a deploy would otherwise stay invisible until the next
 * deploy, so the browser re-checks the packages a page already displays against
 * the NuGet flat-container index, applies any newer version, and stores the
 * result so the next visit is instant.
 *
 * The build-time value always renders first and is never downgraded: a live
 * version only replaces it when it is strictly higher. That keeps the page
 * correct when NuGet lags a GitHub release (the build reconciles release tags
 * into the candidate list, so the build-time value can legitimately be ahead of
 * what the flat-container index reports).
 *
 * This module is isomorphic on purpose — it is imported by Preact islands, by a
 * bundled page script, and by `transform.ts`. It must stay free of Node APIs and
 * of anything that would pull server-only modules into the client bundle.
 */

export const LIVE_VERSIONS_STORAGE_KEY = 'purview.live-nuget-versions.v1';

/** Bump to invalidate every stored copy when the payload shape changes. */
export const LIVE_VERSIONS_SCHEMA = 1;

/** How long a stored copy is trusted before the browser re-checks NuGet. */
export const LIVE_VERSIONS_TTL_MS = 6 * 60 * 60 * 1000;

const FLAT_CONTAINER = 'https://api.nuget.org/v3-flatcontainer';

/** A stored set of live versions, keyed by the package id as declared in the catalogue. */
export interface LiveVersions {
  schema: number;
  /** ISO timestamp of the last successful fetch. */
  fetchedAt: string;
  /** Package id → published versions, newest last, exactly as NuGet reports them. */
  versions: Record<string, string[]>;
}

/** A package's stable and effective-prerelease versions, in display form. */
export interface PackageVersionPair {
  stable: string | null;
  prerelease: string | null;
}

/** One package's build-time versions, used to recompute a project's rollup live. */
export interface ProjectPackageVersions {
  projectId: string;
  packageId: string;
  stable: string | null;
  prerelease: string | null;
}

/** The version rollup shown for a project, computed from its packages. */
export interface VersionRollup {
  stableVersion: string | null;
  prereleaseVersion: string | null;
  suppressedPrerelease: string | null;
  laggingPackageCount: number;
}

/** Highest version in a list, ignoring nulls, by NuGet precedence. */
function highestVersion(versions: readonly (string | null)[]): string | null {
  let highest: string | null = null;
  for (const version of versions) {
    if (version === null) {
      continue;
    }
    if (highest === null || compareNuGetVersions(version, highest) > 0) {
      highest = version;
    }
  }
  return highest;
}

/**
 * Roll a project's packages into the version row shown by the snapshot: the
 * highest stable and prerelease across the package family. A prerelease is
 * reported only when it outranks the stable version, so a trailing prerelease
 * never advertises an older build as the project's latest.
 */
export function rollupPackageVersions(packages: readonly PackageVersionPair[]): VersionRollup {
  const stableVersion = highestVersion(packages.map((pkg) => pkg.stable));
  const highestPrerelease = highestVersion(packages.map((pkg) => pkg.prerelease));
  const prereleaseOutranks =
    highestPrerelease !== null &&
    (stableVersion === null || compareNuGetVersions(highestPrerelease, stableVersion) > 0);
  const headline = prereleaseOutranks ? highestPrerelease : stableVersion;
  const laggingPackageCount = packages.filter((pkg) => {
    const effective = prereleaseOutranks ? pkg.prerelease : pkg.stable;
    return effective !== null && effective !== headline;
  }).length;

  return {
    stableVersion,
    prereleaseVersion: prereleaseOutranks ? highestPrerelease : null,
    suppressedPrerelease: prereleaseOutranks ? null : highestPrerelease,
    laggingPackageCount,
  };
}

/** Tooltip inputs for a version row: the rollup plus the project's package count. */
export interface VersionTooltipRow extends VersionRollup {
  packageCount: number;
}

/**
 * Explanation for a blanked prerelease cell (or for packages that trail the
 * headline version), so the suppressed detail stays discoverable on hover.
 * Shared by the server-rendered snapshot and the browser refresh (ADR 0008).
 */
export function prereleaseTooltip(row: VersionTooltipRow): string | undefined {
  if (row.prereleaseVersion) {
    return row.laggingPackageCount > 0
      ? `${row.laggingPackageCount} of ${row.packageCount} packages are not on this version`
      : undefined;
  }
  if (row.suppressedPrerelease && row.stableVersion) {
    return `Prerelease ${row.suppressedPrerelease} is older than the stable release ${row.stableVersion}`;
  }
  return undefined;
}

/** Explanation for a project that has packages trailing its headline version. */
export function projectTooltip(row: VersionTooltipRow): string | undefined {
  return row.laggingPackageCount > 0
    ? `${row.laggingPackageCount} of ${row.packageCount} packages are on older versions`
    : undefined;
}

function localStorageOrNull(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    // Storage can be blocked (private mode, embedded contexts).
    return null;
  }
}

/** Read the stored live versions, or null when absent, unreadable, or stale-schema. */
export function readLiveVersions(): LiveVersions | null {
  const store = localStorageOrNull();
  if (!store) {
    return null;
  }
  try {
    const raw = store.getItem(LIVE_VERSIONS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<LiveVersions>;
    if (
      parsed.schema !== LIVE_VERSIONS_SCHEMA ||
      typeof parsed.fetchedAt !== 'string' ||
      typeof parsed.versions !== 'object' ||
      parsed.versions === null
    ) {
      return null;
    }
    return {
      schema: LIVE_VERSIONS_SCHEMA,
      fetchedAt: parsed.fetchedAt,
      versions: parsed.versions as Record<string, string[]>,
    };
  } catch {
    return null;
  }
}

/** Store a set of live versions. Returns the record written, or null when storage is unavailable. */
export function writeLiveVersions(versions: Record<string, string[]>): LiveVersions | null {
  const store = localStorageOrNull();
  if (!store) {
    return null;
  }
  const payload: LiveVersions = {
    schema: LIVE_VERSIONS_SCHEMA,
    fetchedAt: new Date().toISOString(),
    versions,
  };
  try {
    store.setItem(LIVE_VERSIONS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // A full or read-only store still gets the refreshed value for this page view.
  }
  return payload;
}

/** True when a stored copy is old enough to re-check. An unparseable date is always stale. */
export function isStale(live: LiveVersions, now: number = Date.now()): boolean {
  const fetchedAt = Date.parse(live.fetchedAt);
  return Number.isNaN(fetchedAt) || now - fetchedAt >= LIVE_VERSIONS_TTL_MS;
}

/** Format the last live check for a status line, tolerating an unparseable timestamp. */
export function formatCheckedAt(fetchedAt: string): string {
  const date = new Date(fetchedAt);
  if (Number.isNaN(date.getTime())) {
    return 'recently';
  }
  return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

/** The status line shared by every surface that re-checks versions in the browser. */
export function versionStatusMessage(status: string, live: LiveVersions | null): string {
  switch (status) {
    case 'checking':
      return 'Checking NuGet for newer versions…';
    case 'live':
      return live
        ? `Versions checked against NuGet at ${formatCheckedAt(live.fetchedAt)}.`
        : 'Versions checked against NuGet.';
    case 'stored':
      return live
        ? `Versions last checked against NuGet at ${formatCheckedAt(live.fetchedAt)}.`
        : 'Showing the versions stored from a previous visit.';
    case 'unavailable':
      return 'NuGet could not be reached; showing the versions from the last build.';
    default:
      return '';
  }
}

/** The latest stable and effective prerelease for a version list, in display form. */
export function latestFromVersions(versions: readonly string[]): PackageVersionPair {
  const selection = selectVersions(versions);
  const stable = selection.stable === null ? null : formatNuGetVersion(selection.stable);
  const prerelease =
    selection.prerelease === null ? null : formatNuGetVersion(selection.prerelease);
  return { stable, prerelease: effectivePrerelease(stable, prerelease) };
}

/**
 * Keep the higher of two versions. A live value never downgrades a build-time
 * one, so a NuGet index that trails the build's release-tag reconciliation cannot
 * make the page show an older version than it did a moment ago.
 */
export function preferNewer(current: string | null, candidate: string | null): string | null {
  if (candidate === null) {
    return current;
  }
  if (current === null) {
    return candidate;
  }
  return compareNuGetVersions(candidate, current) > 0 ? candidate : current;
}

/**
 * Merge a live pair into the build-time pair, keeping whichever version is
 * higher in each channel and then re-applying the withholding rule.
 *
 * Re-applying it matters because the two channels are independent, and the build
 * can legitimately be ahead of NuGet: `Purview.EventSourcing` shows stable
 * `1.1.1` from a release tag while NuGet publishes only `2.0.0-prerelease.x`.
 * That means a merge can raise the stable release past a live prerelease that
 * used to outrank it, or pair a live prerelease with a build-time stable that it
 * trails. In both cases the prerelease must be withheld, exactly as
 * `effectivePrerelease` withholds it at build time; a per-channel merge would
 * render a trailing prerelease beside a newer stable release.
 */
export function mergeVersionPair(
  current: PackageVersionPair,
  live: PackageVersionPair | undefined,
): PackageVersionPair {
  if (!live) {
    return current;
  }
  const stable = preferNewer(current.stable, live.stable);
  const prerelease = preferNewer(current.prerelease, live.prerelease);
  return { stable, prerelease: effectivePrerelease(stable, prerelease) };
}

/** Concurrent islands on one page share a single request per package set. */
const inflight = new Map<string, Promise<Record<string, string[]>>>();

async function fetchPackageVersions(packageId: string): Promise<[string, string[]]> {
  const url = `${FLAT_CONTAINER}/${encodeURIComponent(packageId.toLowerCase())}/index.json`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`NuGet returned ${response.status} for ${packageId}`);
  }
  const body = (await response.json()) as { versions?: unknown };
  const versions = Array.isArray(body.versions)
    ? body.versions.filter((version): version is string => typeof version === 'string')
    : [];
  return [packageId, versions];
}

/**
 * Fetch the published versions for each package. A package that fails (offline,
 * unpublished, rate-limited) is simply absent from the result, so one bad id
 * never discards the others.
 */
export function fetchLiveVersions(
  packageIds: readonly string[],
): Promise<Record<string, string[]>> {
  const ids = [...new Set(packageIds)].filter((id) => id.trim() !== '');
  if (ids.length === 0) {
    return Promise.resolve({});
  }
  const key = [...ids].toSorted().join('\u0000');
  const existing = inflight.get(key);
  if (existing) {
    return existing;
  }
  const request = Promise.allSettled(ids.map(fetchPackageVersions))
    .then((results) => {
      const versions: Record<string, string[]> = {};
      for (const result of results) {
        if (result.status === 'fulfilled') {
          versions[result.value[0]] = result.value[1];
        }
      }
      return versions;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, request);
  return request;
}

/**
 * Re-check the given packages and store the result, merged over any previously
 * stored versions so a package that could not be fetched keeps its last value.
 * Returns the previous record when nothing could be fetched.
 */
export async function refreshLiveVersions(
  packageIds: readonly string[],
  previous: LiveVersions | null,
): Promise<LiveVersions | null> {
  const fetched = await fetchLiveVersions(packageIds);
  if (Object.keys(fetched).length === 0) {
    return previous;
  }
  return writeLiveVersions({ ...previous?.versions, ...fetched });
}
