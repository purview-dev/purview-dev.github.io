import type { GitHubReleaseInfo, VersionSelection } from './types';

import { compare, parse, prerelease, valid } from 'semver';

/** Strip a leading `v` from a version string or tag. */
export function stripVersionPrefix(version: string): string {
  return version.replace(/^v/i, '');
}

/**
 * A version is a prerelease when its semver prerelease identifier is non-empty.
 * This is intentionally tag-semver based: Purview-Dev publishes `vX.Y.Z-prerelease.N`
 * tags with the GitHub `prerelease` flag set to false, so the flag cannot be trusted.
 */
export function isPrereleaseVersion(version: string): boolean {
  const cleaned = stripVersionPrefix(version);
  const parsed = parse(cleaned);
  if (!parsed) {
    return false;
  }
  const idents = prerelease(parsed);
  return Array.isArray(idents) && idents.length > 0;
}

export function isValidVersion(version: string): boolean {
  return valid(stripVersionPrefix(version)) !== null;
}

/** Sort version strings in descending semver order, ignoring invalid versions. */
export function sortVersionsDescending(versions: Iterable<string>): string[] {
  const cleaned = [...versions]
    .map(stripVersionPrefix)
    .filter((version: string) => valid(version) !== null);
  return cleaned.toSorted((a: string, b: string) => compare(b, a));
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

/** Compare two GitHub releases by semver tag, descending. */
export function sortGitHubReleasesDescending(releases: GitHubReleaseInfo[]): GitHubReleaseInfo[] {
  return [...releases].toSorted((a, b) => {
    const aParsed = parse(stripVersionPrefix(a.tagName));
    const bParsed = parse(stripVersionPrefix(b.tagName));
    if (aParsed && bParsed) {
      return compare(bParsed, aParsed);
    }
    return (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');
  });
}

/**
 * Classify a GitHub release as prerelease. Uses the tag's semver prerelease
 * identifier, falling back to the GitHub `prerelease` flag for non-semver tags.
 */
export function isPrereleaseRelease(release: GitHubReleaseInfo): boolean {
  if (isPrereleaseVersion(release.tagName)) {
    return true;
  }
  return release.prerelease;
}
