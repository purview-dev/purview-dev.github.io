/**
 * What the site was last built from, upstream (ADR 0014).
 *
 * The site is built from other repositories: their default branch (the
 * documentation, skills and assets), their release tags and the versions their
 * packages publish. A scheduled check compares those with the state the
 * deployed site recorded at build time (`/_discovery/upstream.json`) and only
 * rebuilds when something moved, so an idle night costs one small job instead
 * of a full build and deployment.
 */

export const UPSTREAM_STATE_SCHEMA = 1;

/** Published beside the previous discovery manifest, outside Astro's route list. */
export const UPSTREAM_STATE_PATH = '/_discovery/upstream.json';

export interface UpstreamProjectState {
  repository: string;
  /** Commit at the head of the default branch; null when it could not be read. */
  head: string | null;
  /** Digest of every tag and the commit it points at; null when it could not be read. */
  tags: string | null;
  /** Latest version per `registry:id`; null for a package whose registry could not be read. */
  packages: Record<string, string | null>;
}

export interface UpstreamState {
  schema: typeof UPSTREAM_STATE_SCHEMA;
  generatedAt: string;
  projects: Record<string, UpstreamProjectState>;
}

/** Parse `git ls-remote` output into `ref → sha`. */
export function parseLsRemote(output: string): Map<string, string> {
  const refs = new Map<string, string>();
  for (const line of output.split('\n')) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (sha && ref && /^[0-9a-f]{40}$/.test(sha)) {
      refs.set(ref, sha);
    }
  }
  return refs;
}

/** Read an untrusted JSON document as an upstream state, or null when it is not one. */
export function readUpstreamState(value: unknown): UpstreamState | null {
  if (
    typeof value === 'object' &&
    value !== null &&
    (value as { schema?: unknown }).schema === UPSTREAM_STATE_SCHEMA &&
    typeof (value as { projects?: unknown }).projects === 'object'
  ) {
    return value as UpstreamState;
  }
  return null;
}

/** True when both values are known and differ. An unreadable value is never a change. */
function moved(previous: string | null | undefined, current: string | null | undefined): boolean {
  return previous != null && current != null && previous !== current;
}

/**
 * The reasons the site should be rebuilt, one per change; empty when nothing moved.
 *
 * A project or package that appears or disappears is a change (the catalogue
 * moved). A value that could not be read on either side is not: a registry
 * outage must not turn into a rebuild every night, and a rebuild could not read
 * it either.
 */
export function upstreamChanges(previous: UpstreamState | null, current: UpstreamState): string[] {
  if (!previous) {
    return ['no recorded upstream state for the deployed site'];
  }
  const changes: string[] = [];
  for (const [id, now] of Object.entries(current.projects)) {
    const before = previous.projects[id];
    if (!before) {
      changes.push(`${id}: new in the catalogue`);
      continue;
    }
    if (before.repository !== now.repository) {
      changes.push(`${id}: repository ${before.repository} → ${now.repository}`);
    }
    if (moved(before.head, now.head)) {
      changes.push(
        `${id}: ${now.repository} default branch ${before.head?.slice(0, 7)} → ${now.head?.slice(0, 7)}`,
      );
    }
    if (moved(before.tags, now.tags)) {
      changes.push(`${id}: ${now.repository} tags changed`);
    }
    for (const [pkg, version] of Object.entries(now.packages)) {
      if (!(pkg in before.packages)) {
        changes.push(`${id}: package ${pkg} added`);
      } else if (moved(before.packages[pkg], version)) {
        changes.push(`${id}: ${pkg} ${before.packages[pkg]} → ${version}`);
      }
    }
    for (const pkg of Object.keys(before.packages)) {
      if (!(pkg in now.packages)) {
        changes.push(`${id}: package ${pkg} removed`);
      }
    }
  }
  for (const id of Object.keys(previous.projects)) {
    if (!(id in current.projects)) {
      changes.push(`${id}: removed from the catalogue`);
    }
  }
  return changes;
}
