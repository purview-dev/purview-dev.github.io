import { compare, parse } from 'semver';

/**
 * NuGet version parsing, comparison, and display formatting.
 *
 * NuGet versions are `Major.Minor.Patch[.Revision][-prerelease][+build]`, a
 * superset of semver: the fourth (revision) component is valid on NuGet but
 * rejected by `semver`, and an omitted revision means `.0`. A semver-only
 * pipeline therefore drops versions such as `13.5.3.6` entirely and reports a
 * stale "latest" version (and would classify `13.5.3.2-prerelease.1` as stable).
 * These helpers keep the revision while delegating prerelease precedence rules
 * (numeric identifiers, casing, identifier counts) to `semver`.
 */

export interface NuGetVersion {
  /** The input with a leading `v` and the historical `reprelease` typo normalised away. */
  readonly version: string;
  /** Numeric core, always four components; an omitted revision reads as 0. */
  readonly core: readonly [major: number, minor: number, patch: number, revision: number];
  /** Prerelease identifiers, empty for a stable version. */
  readonly prerelease: readonly string[];
  /** Build metadata (`+...`), which never participates in precedence. */
  readonly buildMetadata: string | null;
}

const VERSION_PATTERN =
  /^(?<major>\d+)(?:\.(?<minor>\d+))?(?:\.(?<patch>\d+))?(?:\.(?<revision>\d+))?(?:-(?<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+(?<metadata>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function toNumber(value: string | undefined): number {
  return value === undefined ? 0 : Number.parseInt(value, 10);
}

/** Strip a leading `v` from a version string or release tag. */
export function stripVersionPrefix(version: string): string {
  return version.trim().replace(/^v/i, '');
}

/**
 * Normalise the historical `reprelease` typo to `prerelease`. Prerelease
 * identifiers compare by ASCII value, so `reprelease` sorts after `prerelease`
 * and the old typo version would wrongly outrank real prereleases (e.g.
 * `1.0.0-reprelease.0` over `1.0.0-prerelease.55`).
 */
export function normalizeNuGetVersion(version: string): string {
  return stripVersionPrefix(version).replace(/reprelease/gi, 'prerelease');
}

/** Parse a NuGet version, tolerating a leading `v` and the `reprelease` typo. */
export function parseNuGetVersion(version: string): NuGetVersion | null {
  const normalized = normalizeNuGetVersion(version);
  const groups = VERSION_PATTERN.exec(normalized)?.groups;
  if (!groups) {
    return null;
  }
  return {
    version: normalized,
    core: [
      toNumber(groups.major),
      toNumber(groups.minor),
      toNumber(groups.patch),
      toNumber(groups.revision),
    ],
    prerelease: groups.prerelease ? groups.prerelease.split('.') : [],
    buildMetadata: groups.metadata ?? null,
  };
}

/** True when the value is a valid NuGet version. */
export function isValidNuGetVersion(version: string): boolean {
  return parseNuGetVersion(version) !== null;
}

/**
 * True when the version carries a prerelease label (e.g. `-prerelease.4`),
 * regardless of how many numeric components it declares.
 */
export function isPrereleaseNuGetVersion(version: string): boolean {
  const parsed = parseNuGetVersion(version);
  return parsed !== null && parsed.prerelease.length > 0;
}

/**
 * Compare two NuGet versions by precedence: the four-component numeric core
 * first, then the prerelease identifiers, where a labelled version ranks below
 * the same version without a label. Unparseable values fall back to a string
 * comparison so callers always receive a stable ordering.
 */
export function compareNuGetVersions(left: string, right: string): number {
  const a = parseNuGetVersion(left);
  const b = parseNuGetVersion(right);
  if (!a || !b) {
    return normalizeNuGetVersion(left).localeCompare(normalizeNuGetVersion(right));
  }
  for (let index = 0; index < a.core.length; index += 1) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (difference !== 0) {
      return difference < 0 ? -1 : 1;
    }
  }
  return comparePrereleaseIdentifiers(a.prerelease, b.prerelease);
}

function comparePrereleaseIdentifiers(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }
  if (left.length === 0) {
    return 1;
  }
  if (right.length === 0) {
    return -1;
  }
  const leftParsed = parse(`0.0.0-${left.join('.')}`);
  const rightParsed = parse(`0.0.0-${right.join('.')}`);
  if (leftParsed && rightParsed) {
    return compare(leftParsed, rightParsed);
  }
  return left.join('.').localeCompare(right.join('.'));
}

/**
 * Display form of a NuGet version, with numeric components padded to three and
 * the fourth kept only when it is non-zero: `13.5.3.0` reads as `13.5.3` (NuGet
 * treats them as the same version) while `13.5.3.6` keeps its build revision.
 * Prerelease labels and build metadata are preserved.
 */
export function formatNuGetVersion(version: string): string {
  const parsed = parseNuGetVersion(version);
  if (!parsed) {
    return stripVersionPrefix(version);
  }
  const [major, minor, patch, revision] = parsed.core;
  const core =
    revision === 0 ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch}.${revision}`;
  const prerelease = parsed.prerelease.length > 0 ? `-${parsed.prerelease.join('.')}` : '';
  const metadata = parsed.buildMetadata === null ? '' : `+${parsed.buildMetadata}`;
  return `${core}${prerelease}${metadata}`;
}
