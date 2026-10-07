import { compareNuGetVersions, isPrereleaseNuGetVersion } from '../nuget-version';

/**
 * Target-framework (TFM) normalisation and comparison.
 *
 * The catalogue authors TFMs in the modern short form (`net8.0`,
 * `netstandard2.0`, `net10.0-windows10.0.19041.0`) while a NuGet `.nuspec`
 * reports a mix of the short form and the historical long form
 * (`.NETStandard2.0`, `.NETFramework4.7.2`) and omits the trailing zero of a
 * platform version (`net10.0-windows10.0.19041`). Both sides are canonicalised
 * here so an advisory check can compare them without false drift.
 */

/**
 * Tokens that may appear in `targetFrameworks` but are not TFMs. They are
 * recognised so the malformed-moniker check leaves them alone, and skipped when
 * comparing a project's declared frameworks with its packages' published ones.
 */
export const TARGET_FRAMEWORK_SENTINELS = ['msbuild'] as const;

const TFM_PATTERN =
  /^(?:netstandard\d+(?:\.\d+)?|netcoreapp\d+(?:\.\d+)?|net\d{1,3}(?:\.\d+)?|net\d+(?:\.\d+)?-[a-z]+\d*(?:\.\d+){0,3})$/;

/** Pad a numeric platform version to four components (`19041` -> `19041.0.0.0`). */
function canonicalPlatformVersion(version: string): string {
  const parts = version.split('.');
  while (parts.length < 4) {
    parts.push('0');
  }
  return parts.slice(0, 4).join('.');
}

/** Expand the historical long-form nuspec monikers to their short form. */
function expandLongForm(tfm: string): string {
  const netstandard = /^\.netstandard(\d+(?:\.\d+)?)$/.exec(tfm);
  if (netstandard) {
    return `netstandard${netstandard[1]}`;
  }
  const netcore = /^\.netcoreapp(\d+(?:\.\d+)?)$/.exec(tfm);
  if (netcore) {
    return `netcoreapp${netcore[1]}`;
  }
  // .NETFramework4.7.2 -> net472 (the version components are concatenated).
  const netframework = /^\.netframework(\d+(?:\.\d+)*)$/.exec(tfm);
  if (netframework) {
    return `net${(netframework[1] ?? '').replaceAll('.', '')}`;
  }
  const net = /^\.net(\d+(?:\.\d+)*)$/.exec(tfm);
  if (net) {
    return `net${net[1]}`;
  }
  return tfm;
}

/**
 * Canonicalise a single TFM: lowercase, expand the historical long forms, and
 * pad a platform version to four components so `net10.0-windows10.0.19041` and
 * `net10.0-windows10.0.19041.0` compare equal.
 */
export function normalizeTargetFramework(value: string): string {
  const tfm = expandLongForm(value.trim().toLowerCase());
  const dash = tfm.indexOf('-');
  if (dash === -1) {
    return tfm;
  }
  const base = tfm.slice(0, dash);
  const platform = tfm.slice(dash + 1);
  const match = /^([a-z]+)(\d+(?:\.\d+)*)$/.exec(platform);
  if (!match) {
    return tfm;
  }
  return `${base}-${match[1]}${canonicalPlatformVersion(match[2] ?? '')}`;
}

/** Canonicalise and de-duplicate a list of TFMs, sorted for stable output. */
export function normalizeTargetFrameworks(values: Iterable<string>): string[] {
  return [...new Set([...values].map(normalizeTargetFramework))].toSorted();
}

interface TargetFrameworkOrder {
  family: string;
  version: number[];
  platform: string | null;
}

function targetFrameworkOrder(value: string): TargetFrameworkOrder {
  const normalized = normalizeTargetFramework(value);
  const dash = normalized.indexOf('-');
  const base = dash === -1 ? normalized : normalized.slice(0, dash);
  const platform = dash === -1 ? null : normalized.slice(dash + 1);
  const match = /^([a-z]+)(\d+(?:\.\d+)*)$/.exec(base);
  if (!match) {
    return { family: normalized, version: [], platform };
  }
  return {
    family: match[1] ?? normalized,
    version: (match[2] ?? '').split('.').map(Number),
    platform,
  };
}

/**
 * Order TFMs the way the manifests author them: by family, then numeric version
 * (`net8.0` before `net9.0` before `net10.0`), then base before a platform
 * variant. Lexicographic sorting would put `net10.0` before `net8.0`.
 */
export function compareTargetFrameworks(left: string, right: string): number {
  const a = targetFrameworkOrder(left);
  const b = targetFrameworkOrder(right);
  if (a.family !== b.family) {
    return a.family < b.family ? -1 : 1;
  }
  const length = Math.max(a.version.length, b.version.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a.version[index] ?? 0) - (b.version[index] ?? 0);
    if (difference !== 0) {
      return difference < 0 ? -1 : 1;
    }
  }
  if (a.platform === b.platform) {
    return 0;
  }
  if (a.platform === null) {
    return -1;
  }
  if (b.platform === null) {
    return 1;
  }
  return a.platform < b.platform ? -1 : 1;
}

/** Canonicalise, de-duplicate and naturally sort a list of TFMs. */
export function sortTargetFrameworks(values: Iterable<string>): string[] {
  return normalizeTargetFrameworks(values).toSorted(compareTargetFrameworks);
}

/** True when a value is a TFM or a recognised sentinel such as `msbuild`. */
export function isRecognizedTargetFramework(value: string): boolean {
  const normalized = normalizeTargetFramework(value);
  return (
    TFM_PATTERN.test(normalized) ||
    (TARGET_FRAMEWORK_SENTINELS as readonly string[]).includes(normalized)
  );
}

/** True when the value names `netstandard*`, the target of analyzers/generators. */
export function isAnalyzerTargetFramework(value: string): boolean {
  return /^netstandard\d/.test(normalizeTargetFramework(value));
}

/**
 * A package is an analyzer/source generator when every framework it publishes is
 * `netstandard*`; its TFMs describe the build-time assembly, not the frameworks
 * a consumer's runtime code targets.
 */
export function isAnalyzerTargetFrameworks(values: Iterable<string>): boolean {
  const frameworks = [...values];
  return frameworks.length > 0 && frameworks.every(isAnalyzerTargetFramework);
}

/** Remove sentinels (and, when requested, analyzer TFMs) from a declared list. */
export function runtimeTargetFrameworks(
  values: Iterable<string>,
  options: { excludeAnalyzer?: boolean } = {},
): string[] {
  const sentinels = new Set<string>(TARGET_FRAMEWORK_SENTINELS);
  return normalizeTargetFrameworks(
    [...values].filter(
      (value) =>
        !sentinels.has(normalizeTargetFramework(value)) &&
        !(options.excludeAnalyzer && isAnalyzerTargetFramework(value)),
    ),
  );
}

export interface TargetFrameworkDiff {
  /** Published frameworks missing from the declared set. */
  missing: string[];
  /** Declared frameworks that no published package targets. */
  extra: string[];
}

/** Compare a declared framework set against a published one, both canonicalised. */
export function diffTargetFrameworks(
  declared: Iterable<string>,
  published: Iterable<string>,
): TargetFrameworkDiff {
  const declaredSet = new Set(normalizeTargetFrameworks(declared));
  const publishedSet = new Set(normalizeTargetFrameworks(published));
  return {
    missing: [...publishedSet].filter((tfm) => !declaredSet.has(tfm)).toSorted(),
    extra: [...declaredSet].filter((tfm) => !publishedSet.has(tfm)).toSorted(),
  };
}

/**
 * The published version whose `.nuspec` describes a package's target
 * frameworks: the newest stable version, or the newest prerelease when the
 * package has no stable release. The raw index entry is returned so it can be
 * used verbatim in the flat-container nuspec URL.
 */
export function selectVersionForTargetFrameworks(versions: Iterable<string>): string | null {
  const sorted = [...versions].toSorted((a, b) => compareNuGetVersions(b, a));
  return sorted.find((version) => !isPrereleaseNuGetVersion(version)) ?? sorted[0] ?? null;
}
