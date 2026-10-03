import { execFileSync } from 'node:child_process';

import { findWorkspaceRoot } from '../site-version';

/**
 * Content-derived modification dates for sitemap `lastmod`.
 *
 * A sitemap whose every `lastmod` is the build time is worse than no `lastmod`:
 * it tells Google that all 150+ URLs changed on every deploy, which trains the
 * crawler to ignore the signal. Instead each resource is dated from the source
 * that produced it:
 *
 * 1. the last commit that touched the source file (one bulk `git log`, indexed
 *    in memory, so a whole build runs Git exactly once);
 * 2. the project's latest release date (from the release cache);
 * 3. the aggregated documentation's own review date (`lastReviewed`);
 * 4. the release-cache `retrievedAt` as a coarse fallback when `.git` is absent
 *    (a shallow CI clone) or the file is untracked.
 *
 * See `docs/discovery.md` for the strategy and its trade-offs.
 */

/** Repo-relative file path -> last committer date (ISO 8601). */
export type FileDateIndex = Map<string, string>;

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

let gitIndexCache: FileDateIndex | null | undefined;

/**
 * Parse `git log --name-only --pretty=format:%cI` output into a path->date map.
 * The first commit that touched a path wins, because `git log` walks newest
 * first, so the earliest entry is the most recent change.
 */
export function parseGitLogDates(output: string): FileDateIndex {
  const index: FileDateIndex = new Map();
  let commit: string | null = null;
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (line === '') {
      continue;
    }
    if (ISO_DATETIME.test(line)) {
      commit = line;
      continue;
    }
    if (commit !== null && !index.has(line)) {
      index.set(line, commit);
    }
  }
  return index;
}

/**
 * Build the path->date index from a single `git log` invocation. Cached for the
 * process lifetime; returns null when Git or the repository is unavailable.
 */
export function readGitFileDates(root?: string): FileDateIndex | null {
  if (gitIndexCache !== undefined) {
    return gitIndexCache;
  }
  let repoRoot = root;
  if (!repoRoot) {
    try {
      repoRoot = findWorkspaceRoot();
    } catch {
      gitIndexCache = null;
      return null;
    }
  }
  try {
    const output = execFileSync(
      'git',
      ['log', '--no-merges', '--name-only', '--pretty=format:%cI'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
      },
    );
    gitIndexCache = parseGitLogDates(output);
    return gitIndexCache;
  } catch {
    gitIndexCache = null;
    return null;
  }
}

/** The most recent of a set of timestamps, ignoring nulls and unparseable values. */
export function latestTimestamp(
  values: readonly (string | null | undefined)[],
): string | undefined {
  let best: string | undefined;
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) {
      continue;
    }
    const time = Date.parse(value);
    if (Number.isNaN(time)) {
      continue;
    }
    if (time > bestTime) {
      bestTime = time;
      best = value;
    }
  }
  return best;
}

/** The first parseable timestamp, in priority order. */
export function firstTimestamp(values: readonly (string | null | undefined)[]): string | undefined {
  for (const value of values) {
    if (value && !Number.isNaN(Date.parse(value))) {
      return value;
    }
  }
  return undefined;
}
