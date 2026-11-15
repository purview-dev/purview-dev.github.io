import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';

import { resolveGitHubToken } from '../github/token';
import { OWNER } from '../site';

/**
 * Project-owned catalogue records (ADR 0013).
 *
 * A project repository publishes its own catalogue record at
 * `.config/purview-docs.yml` — the record that used to live here under
 * `src/src/data/projects/<id>.yml` — and this repository reads it at build time.
 * The project owns its words and pointers, so they change in the same pull
 * request as the thing they describe and cannot drift behind it.
 *
 * Discovery is the organisation's repository list: a repository that publishes
 * the file is a catalogue project, so joining the catalogue is one file in the
 * project repository and needs no pull request here. A repository without the
 * file is skipped, which is what the 404 means.
 *
 * Records are read from `raw.githubusercontent.com` at the repository's default
 * branch — the same source and ref the documentation mirror uses. Like every
 * other external input they are cached under `.cache/` and snapshotted into
 * `fixtures/manifests/index.json`, so rendering never performs network I/O and an
 * offline build keeps working (`getManifestIndex`).
 */

/** Where a project publishes its own catalogue record. */
export const PROJECT_MANIFEST_PATH = '.config/purview-docs.yml';

export const MANIFEST_CACHE_SCHEMA_VERSION = 1;

export const CACHE_DIR = resolve('.cache', 'manifests');
export const CACHE_FILE = resolve(CACHE_DIR, 'manifests.json');
export const FIXTURE_DIR = resolve('fixtures', 'manifests');

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

/** One catalogue record fetched from the repository that owns it. */
export interface RemoteManifest {
  /** `owner/repository`, as the record's own `repository` field should read. */
  repository: string;
  /** The ref the record was read at — the repository's default branch. */
  ref: string;
  /** The parsed record. The loader strips the `$schema` hint. */
  record: Record<string, unknown>;
}

export interface ManifestCacheData {
  schema: number;
  retrievedAt: string;
  manifests: RemoteManifest[];
}

/** A repository that publishes a catalogue record. */
export interface ManifestRepository {
  name: string;
  fullName: string;
  defaultBranch: string;
  archived: boolean;
}

export class ManifestFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestFetchError';
  }
}

function githubToken(): string | undefined {
  return resolveGitHubToken();
}

/** Structural guard so a corrupt or stale cache can never be silently consumed. */
export function isManifestCache(data: unknown): data is ManifestCacheData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const candidate = data as Record<string, unknown>;
  if (candidate.schema !== MANIFEST_CACHE_SCHEMA_VERSION) {
    return false;
  }
  if (typeof candidate.retrievedAt !== 'string') {
    return false;
  }
  if (!Array.isArray(candidate.manifests)) {
    return false;
  }
  return candidate.manifests.every((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return false;
    }
    const manifest = entry as Record<string, unknown>;
    return (
      typeof manifest.repository === 'string' &&
      typeof manifest.ref === 'string' &&
      typeof manifest.record === 'object' &&
      manifest.record !== null
    );
  });
}

function readCacheFile(file: string): ManifestCacheData | null {
  if (!existsSync(file)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return isManifestCache(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function readManifestCache(file = CACHE_FILE): ManifestCacheData | null {
  return readCacheFile(file);
}

export function writeManifestCache(data: ManifestCacheData, file = CACHE_FILE): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/** Read a committed fixture (`fixtures/manifests/<name>.json`). */
export function readManifestFixture(name = 'index'): ManifestCacheData | null {
  return readCacheFile(resolve(FIXTURE_DIR, `${name}.json`));
}

/**
 * List every repository the organisation publishes, including archived ones: an
 * archived project still owns the record that says so, and its `status` is
 * checked against the archived flag (ADR 0004). Dotfolders such as `.github` are
 * skipped — they are organisation plumbing, not catalogue projects.
 */
export async function listOrganizationRepositories(): Promise<ManifestRepository[]> {
  const token = githubToken();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'purview-dev-website',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const repositories: ManifestRepository[] = [];
  const perPage = 100;
  for (let page = 1; page <= 10; page += 1) {
    const response = await fetch(
      `${API}/orgs/${OWNER}/repos?per_page=${perPage}&page=${page}&type=public`,
      { headers },
    );
    if (!response.ok) {
      throw new ManifestFetchError(
        `GitHub request failed (${response.status}) listing ${OWNER}'s repositories. ` +
          'Run `gh auth login` or set GITHUB_TOKEN when the rate limit is exhausted.',
      );
    }
    const batch = (await response.json()) as unknown;
    if (!Array.isArray(batch)) {
      break;
    }
    for (const entry of batch as Record<string, unknown>[]) {
      const name = String(entry.name ?? '');
      if (name === '' || name.startsWith('.')) {
        continue;
      }
      repositories.push({
        name,
        fullName: String(entry.full_name ?? `${OWNER}/${name}`),
        defaultBranch: String(entry.default_branch ?? 'main'),
        archived: Boolean(entry.archived),
      });
    }
    if (batch.length < perPage) {
      break;
    }
  }

  return repositories.toSorted((a, b) => a.fullName.localeCompare(b.fullName));
}

/**
 * Fetch one repository's record, or null when it does not publish one (404),
 * which is how a repository that is not a catalogue project is skipped.
 */
export async function fetchProjectManifest(
  repository: ManifestRepository,
): Promise<RemoteManifest | null> {
  const url = `${RAW}/${repository.fullName}/${repository.defaultBranch}/${PROJECT_MANIFEST_PATH}`;
  const response = await fetch(url, { headers: { 'User-Agent': 'purview-dev-website' } });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new ManifestFetchError(
      `${repository.fullName}: ${PROJECT_MANIFEST_PATH} could not be read (${response.status}).`,
    );
  }

  const text = await response.text();
  let record: unknown;
  try {
    record = parse(text);
  } catch (error) {
    throw new ManifestFetchError(
      `${repository.fullName}: ${PROJECT_MANIFEST_PATH} is not valid YAML ` +
        `(${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    throw new ManifestFetchError(
      `${repository.fullName}: ${PROJECT_MANIFEST_PATH} must hold one project record.`,
    );
  }

  return {
    repository: repository.fullName,
    ref: repository.defaultBranch,
    record: record as Record<string, unknown>,
  };
}

/**
 * Read the record of every repository that publishes one. An unreadable record
 * fails the sync rather than being skipped, because the alternative is publishing
 * a catalogue that is silently missing a project: the message names every
 * repository that has to be fixed.
 */
export async function fetchProjectManifests(
  repositories: ManifestRepository[],
): Promise<RemoteManifest[]> {
  const manifests: RemoteManifest[] = [];
  const failures: string[] = [];

  for (const repository of repositories) {
    try {
      const manifest = await fetchProjectManifest(repository);
      if (manifest) {
        manifests.push(manifest);
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (failures.length > 0) {
    throw new ManifestFetchError(
      ['Unreadable project catalogue record(s):', ...failures.map((line) => `  ${line}`)].join(
        '\n',
      ),
    );
  }

  return manifests;
}
