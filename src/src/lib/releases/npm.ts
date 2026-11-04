import type { NpmPackageIndex } from './types';

import { ApiError } from './github';

/**
 * npm registry client.
 *
 * The registry document is the npm equivalent of NuGet's flat-container index
 * plus its search entry: one request returns every published version and the
 * dist-tags that name the release channels. The abbreviated
 * (`application/vnd.npm.install-v1+json`) representation is requested because
 * the full document carries every version's manifest, which is megabytes for a
 * package with a long release history.
 */

const REGISTRY = 'https://registry.npmjs.org';
const DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-week';

const ACCEPT = 'application/vnd.npm.install-v1+json';

export function parseNpmPackage(raw: Record<string, unknown>, name: string): NpmPackageIndex {
  const versions =
    typeof raw.versions === 'object' && raw.versions !== null
      ? Object.keys(raw.versions as Record<string, unknown>)
      : [];
  const distTags: Record<string, string> = {};
  if (typeof raw['dist-tags'] === 'object' && raw['dist-tags'] !== null) {
    for (const [tag, version] of Object.entries(raw['dist-tags'] as Record<string, unknown>)) {
      if (typeof version === 'string') {
        distTags[tag] = version;
      }
    }
  }

  const latest = distTags.latest;
  const latestManifest =
    latest && typeof raw.versions === 'object' && raw.versions !== null
      ? (raw.versions as Record<string, Record<string, unknown>>)[latest]
      : undefined;
  const time =
    typeof raw.time === 'object' && raw.time !== null
      ? (raw.time as Record<string, unknown>)
      : undefined;
  const publishedAt =
    (latest && typeof time?.[latest] === 'string' ? time[latest] : undefined) ??
    (typeof raw.modified === 'string' ? raw.modified : null);

  return {
    name,
    versions,
    distTags,
    publishedAt: publishedAt ?? null,
    weeklyDownloads: null,
    deprecated: Boolean(latestManifest?.deprecated),
  };
}

async function fetchWeeklyDownloads(name: string): Promise<number | null> {
  try {
    const response = await fetch(`${DOWNLOADS}/${name}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'purview-dev-website' },
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { downloads?: unknown };
    return typeof body.downloads === 'number' ? body.downloads : null;
  } catch {
    // Downloads are supplementary: a failed lookup must not discard versions.
    return null;
  }
}

export async function fetchNpmPackage(name: string): Promise<NpmPackageIndex> {
  const response = await fetch(`${REGISTRY}/${encodeURIComponent(name)}`, {
    headers: { Accept: ACCEPT, 'User-Agent': 'purview-dev-website' },
  });
  if (!response.ok) {
    throw new ApiError(`npm request failed (${response.status}): ${name}`, response.status, 'npm');
  }
  const raw = (await response.json()) as Record<string, unknown>;
  const parsed = parseNpmPackage(raw, name);
  parsed.weeklyDownloads = await fetchWeeklyDownloads(name);
  return parsed;
}
