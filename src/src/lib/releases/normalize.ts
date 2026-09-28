import type { GitHubReleaseInfo, VersionSelection } from './types';

import {
  compareNuGetVersions,
  isPrereleaseNuGetVersion,
  isValidNuGetVersion,
  normalizeNuGetVersion,
} from '../nuget-version';

export { stripVersionPrefix } from '../nuget-version';

/**
 * Normalise a release tag or NuGet version for comparison and display: strips a
 * leading `v` and repairs the historical `reprelease` typo. NuGet precedence and
 * the fourth (revision) component are handled by `lib/nuget-version`.
 */
export function normalizePrereleaseVersion(version: string): string {
  return normalizeNuGetVersion(version);
}

/**
 * A version is a prerelease when its prerelease label is non-empty, regardless of
 * how many numeric components it declares. This is intentionally tag-based:
 * Purview-Dev publishes `vX.Y.Z-prerelease.N` tags with the GitHub `prerelease`
 * flag set to false, so the flag cannot be trusted.
 */
export function isPrereleaseVersion(version: string): boolean {
  return isPrereleaseNuGetVersion(version);
}

export function isValidVersion(version: string): boolean {
  return isValidNuGetVersion(version);
}

/** Sort version strings in descending precedence order, ignoring invalid versions. */
export function sortVersionsDescending(versions: Iterable<string>): string[] {
  const cleaned = [...versions]
    .map(normalizePrereleaseVersion)
    .filter((version: string) => isValidNuGetVersion(version));
  return cleaned.toSorted((a: string, b: string) => compareNuGetVersions(b, a));
}

/** Highest stable (non-prerelease) version, or null when none exists. */
export function selectStableVersion(versions: Iterable<string>): string | null {
  const sorted = sortVersionsDescending(versions);
  return sorted.find((version) => !isPrereleaseVersion(version)) ?? null;
}

/** Highest prerelease version, or null when none exists. */
export function selectPrereleaseVersion(versions: Iterable<string>): string | null {
  const sorted = sortVersionsDescending(versions);
  return sorted.find((version) => isPrereleaseVersion(version)) ?? null;
}

/** Compute both stable and prerelease selections from a version list. */
export function selectVersions(versions: Iterable<string>): VersionSelection {
  return {
    stable: selectStableVersion(versions),
    prerelease: selectPrereleaseVersion(versions),
  };
}

/** Compare two GitHub releases by version tag, descending. */
export function sortGitHubReleasesDescending(releases: GitHubReleaseInfo[]): GitHubReleaseInfo[] {
  return [...releases].toSorted((a, b) => {
    const aTag = normalizePrereleaseVersion(a.tagName);
    const bTag = normalizePrereleaseVersion(b.tagName);
    // Non-version tags (e.g. `nightly`) cannot be ranked; publication order wins.
    if (isValidNuGetVersion(aTag) && isValidNuGetVersion(bTag)) {
      return compareNuGetVersions(bTag, aTag);
    }
    return (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');
  });
}

/**
 * Classify a GitHub release as prerelease. Uses the tag's prerelease label,
 * falling back to the GitHub `prerelease` flag for non-version tags.
 */
export function isPrereleaseRelease(release: GitHubReleaseInfo): boolean {
  if (isPrereleaseVersion(release.tagName)) {
    return true;
  }
  return release.prerelease;
}
