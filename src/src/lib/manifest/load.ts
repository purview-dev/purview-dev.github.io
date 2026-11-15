import type { GitHubRepoInfo } from '../releases/types';
import type {
  ExternalProjectRecord,
  PackageRegistry,
  ProjectManifest,
  ProjectPackage,
  ProjectRecord,
  ProjectSkill,
} from './schema';

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

import { getReleaseIndex } from '../releases/runtime';
import { OWNER } from '../site';
import { PROJECT_MANIFEST_PATH } from './remote';
import { getManifestIndex } from './runtime';
import { PROJECT_DEFAULTS, manifestSchema } from './schema';

/**
 * The catalogue records this repository still owns (ADR 0005): `src/data/projects/<id>.yml`,
 * plus `src/data/external-projects.yml` for the collaborations the organisation
 * does not own. One file per project keeps a project's history and review
 * self-contained, and stops concurrent catalogue pull requests from conflicting
 * on one growing list. A project that publishes its own record at
 * `.config/purview-docs.yml` wins over the file here (ADR 0013).
 */
export const DEFAULT_PROJECTS_DIR = resolve('src/data/projects');
export const DEFAULT_EXTERNAL_PROJECTS_PATH = resolve('src/data/external-projects.yml');

/** A declared package with the registry its versions are read from resolved. */
export type ResolvedPackage = ProjectPackage & { registry: PackageRegistry };

export interface ResolvedProject extends ProjectRecord {
  repoOwner: string;
  repoName: string;
  sourceUrl: string;
  issuesUrl: string;
  discussionsUrl: string | null;
  changelogUrl: string;
  releasesUrl: string;
  featured: boolean;
  experimental: boolean;
  order: number;
  packages: ResolvedPackage[];
  /** True when the catalogue says "publish every skill under `skills/`". */
  discoverSkills: boolean;
  /** Explicit skill declarations (overrides/legacy); discovery is preferred. */
  skills: ProjectSkill[];
  assets: NonNullable<ProjectRecord['assets']>;
  related: NonNullable<ProjectRecord['related']>;
  useCases: NonNullable<ProjectRecord['useCases']>;
  acknowledgments: NonNullable<ProjectRecord['acknowledgments']>;
  discussions: boolean;
  install: NonNullable<ProjectRecord['install']>;
}

export type ResolvedExternalProject = Omit<
  ExternalProjectRecord,
  'repository' | 'status' | 'featured' | 'order'
> & {
  /** Canonical GitHub URL when a repository is declared, otherwise null. */
  repository: string | null;
  repoUrl: string | null;
  status: NonNullable<ExternalProjectRecord['status']> | null;
  featured: boolean;
  order: number;
};

/** The raw catalogue records, with the provenance of each one. */
export interface RawManifest {
  /** One record per `src/src/data/projects/*.yml` and per owning repository. */
  projects: unknown[];
  externalProjects: unknown[];
  /** Project id → the file or repository that owns the record, for error messages. */
  sources: Map<string, string>;
  /** Project ids declared both here and by the repository that owns them. */
  duplicatedIds: string[];
}

export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestValidationError';
  }
}

/** The repository flags the release cache records, keyed by `owner/repository`. */
type RepositoryFlags = Record<string, Pick<GitHubRepoInfo, 'hasDiscussions'>>;

/**
 * Resolve whether the project links its GitHub Discussions.
 *
 * GitHub already knows, so the catalogue does not carry the setting: the
 * release cache records `hasDiscussions` for every declared repository. An
 * explicit value in the record is an override — `false` opts out (a fork, or a
 * repository whose Discussions should not be surfaced) and `true` links them
 * even before the repository has a cache record.
 */
function resolveDiscussions(
  record: ProjectRecord,
  repository: Pick<GitHubRepoInfo, 'hasDiscussions'> | undefined,
): boolean {
  if (record.discussions === false) {
    return false;
  }
  return repository?.hasDiscussions ?? record.discussions ?? PROJECT_DEFAULTS.discussions;
}

function withDefaults(record: ProjectRecord, repositories: RepositoryFlags): ResolvedProject {
  const [repoOwner = OWNER, repoName = ''] = record.repository.split('/');
  const repo = `https://github.com/${record.repository}`;
  const discussions = resolveDiscussions(record, repositories[record.repository]);
  return {
    ...record,
    featured: record.featured ?? PROJECT_DEFAULTS.featured,
    experimental: record.experimental ?? PROJECT_DEFAULTS.experimental,
    order: record.order ?? PROJECT_DEFAULTS.order,
    packages: (record.packages ?? PROJECT_DEFAULTS.packages).map((pkg) =>
      Object.assign({}, pkg, { registry: pkg.registry ?? 'nuget' }),
    ),
    skills: Array.isArray(record.skills) ? record.skills : PROJECT_DEFAULTS.skills,
    discoverSkills: record.skills !== false,
    assets: record.assets ?? PROJECT_DEFAULTS.assets,
    related: record.related ?? PROJECT_DEFAULTS.related,
    useCases: record.useCases ?? PROJECT_DEFAULTS.useCases,
    acknowledgments: record.acknowledgments ?? PROJECT_DEFAULTS.acknowledgments,
    discussions,
    install: record.install ?? PROJECT_DEFAULTS.install,
    repoOwner,
    repoName,
    sourceUrl: repo,
    issuesUrl: `${repo}/issues`,
    discussionsUrl: discussions ? `${repo}/discussions` : null,
    changelogUrl: `${repo}/blob/${'main'}/CHANGELOG.md`,
    releasesUrl: `${repo}/releases`,
  };
}

/**
 * Label an issue with the project id rather than its array index, so a schema
 * failure names the project whose record is wrong (`projects[containers].name`)
 * instead of a position the author has to map back to a file.
 */
function issuePath(raw: unknown, path: readonly PropertyKey[]): string {
  const [head, index, ...rest] = path;
  if (head !== 'projects' || typeof index !== 'number') {
    return path.join('.');
  }
  const id = issueProjectId(raw, path);
  const label = `projects[${id ?? index}]`;
  return rest.length > 0 ? `${label}.${rest.join('.')}` : label;
}

/** The project id a schema issue path names, when it names one. */
function issueProjectId(raw: unknown, path: readonly PropertyKey[]): string | undefined {
  const [head, index] = path;
  if (head !== 'projects' || typeof index !== 'number') {
    return undefined;
  }
  const entries = (raw as { projects?: unknown[] } | null)?.projects;
  const entry = Array.isArray(entries) ? entries[index] : undefined;
  const id =
    typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : undefined;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Validate a raw manifest object against the typed schema.
 * Throws a ManifestValidationError describing the source file, the invalid
 * property, the expected shape, and how to remediate the record.
 *
 * `repositories` feeds the values that are detected from GitHub rather than
 * authored (today: whether Discussions are enabled); it defaults to the release
 * cache, so a record never repeats what the repository already says.
 *
 * `sources` maps a project id to the file or repository that owns its record, so
 * a failure points at the record the author has to edit: a local
 * `src/src/data/projects/<id>.yml` here, or a project's own
 * `.config/purview-docs.yml` in the repository that publishes it (ADR 0013).
 */
export function parseManifest(
  raw: unknown,
  source: string,
  repositories: RepositoryFlags = getReleaseIndex().data.repos,
  sources: ReadonlyMap<string, string> = new Map(),
): ResolvedProject[] {
  const sourceOf = (id: string): string => sources.get(id) ?? source;
  let parsed: ProjectManifest;
  try {
    parsed = manifestSchema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues
        .map((issue) => {
          const id = issueProjectId(raw, issue.path);
          const owner = id === undefined ? undefined : sources.get(id);
          const label = issuePath(raw, issue.path);
          return `  ${owner === undefined ? label : `${label} (${owner})`}: ${issue.message}`;
        })
        .join('\n');
      throw new ManifestValidationError(
        [
          `Invalid project manifest: ${source}`,
          issues,
          '',
          'Remediation: fix the reported property on the offending project record.',
        ].join('\n'),
      );
    }
    throw error;
  }

  const projects = parsed.projects.map((record) => withDefaults(record, repositories));
  const ids = new Set(projects.map((p) => p.id));
  const packageOwners = new Map<string, string>();
  const assetOutputs = new Map<string, string>();

  for (const project of projects) {
    if (project.repository.split('/')[0] !== OWNER) {
      throw new ManifestValidationError(
        [
          `Invalid project manifest: ${sourceOf(project.id)}`,
          `  projects[${project.id}].repository: Expected the repository to belong to the "${OWNER}" organisation.`,
          `  Got: ${project.repository}`,
          '',
          `Remediation: point "repository" at a purview-dev repository, e.g. "${OWNER}/${project.id}".`,
        ].join('\n'),
      );
    }
    for (const ref of [
      ...project.related,
      ...(project.supersedes ? [project.supersedes] : []),
      ...(project.supersededBy ? [project.supersededBy] : []),
    ]) {
      if (!ids.has(ref)) {
        throw new ManifestValidationError(
          [
            `Invalid project manifest: ${sourceOf(project.id)}`,
            `  projects[${project.id}]: Relationship references "${ref}", which is not a known project id.`,
            '',
            `Remediation: add a project with id "${ref}" or remove the relationship.`,
          ].join('\n'),
        );
      }
    }
    for (const pkg of project.packages) {
      const key = `${pkg.registry}:${pkg.id}`;
      const existing = packageOwners.get(key);
      if (existing !== undefined) {
        throw new ManifestValidationError(
          [
            `Invalid project manifest: ${sourceOf(project.id)}`,
            `  projects[${project.id}].packages: Package "${pkg.id}" (${pkg.registry}) is also declared by "${existing}".`,
            '',
            `Remediation: associate each package with exactly one project.`,
          ].join('\n'),
        );
      }
      packageOwners.set(key, project.id);
    }
    for (const asset of project.assets) {
      const existing = assetOutputs.get(asset.output);
      if (existing !== undefined) {
        throw new ManifestValidationError(
          [
            `Invalid project manifest: ${sourceOf(project.id)}`,
            `  projects[${project.id}].assets: output "${asset.output}" is also declared by "${existing}".`,
            '',
            `Remediation: give each mirrored asset a distinct output path.`,
          ].join('\n'),
        );
      }
      assetOutputs.set(asset.output, project.id);
    }
  }

  return projects.toSorted((a, b) => a.order - b.order);
}

/**
 * Files may open with a `$schema` hint for editors. It is a file-level concern
 * rather than part of the record, so it is dropped before validation and
 * resolution: `ResolvedProject` stays the domain type it always was.
 */
function stripSchemaHint(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key !== '$schema') {
      record[key] = entry;
    }
  }
  return record;
}

/**
 * Read the catalogue into the raw shape `manifestSchema` validates: one record per
 * `*.yml` file in the projects directory, sorted by file name so the result is
 * deterministic whatever order the filesystem reports, plus the collaborations
 * file — and one record per project repository that publishes
 * `.config/purview-docs.yml` (ADR 0013).
 *
 * A project that owns its record wins over a local file with the same id, which is
 * the migration path: moving a record into the project repository is a change to
 * that repository, and the local copy is deleted in the same commit. The clash is
 * reported in `duplicatedIds` rather than merged silently, so the catalogue guard
 * can say that a leftover local copy has stopped being the source of truth.
 *
 * Validation (including every cross-record invariant) stays in `parseManifest`.
 */
export function readRawManifest(
  projectsDir = DEFAULT_PROJECTS_DIR,
  externalProjectsPath = DEFAULT_EXTERNAL_PROJECTS_PATH,
): RawManifest {
  // The directory may be absent: once every project owns its own record (ADR 0013) there is
  // nothing left to read here, and git does not keep an empty directory.
  const files = existsSync(projectsDir)
    ? readdirSync(projectsDir)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .toSorted()
    : [];

  const sources = new Map<string, string>();
  const projects: unknown[] = [];
  for (const file of files) {
    const text = readFileSync(join(projectsDir, file), 'utf8');
    let record: unknown;
    try {
      record = stripSchemaHint(parse(text));
    } catch (error) {
      throw new ManifestValidationError(
        `Invalid YAML in ${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const id = recordId(record);
    if (id !== undefined) {
      sources.set(id, file);
    }
    projects.push(record);
  }

  const externalProjects: unknown[] = [];
  if (existsSync(externalProjectsPath)) {
    const parsed = (parse(readFileSync(externalProjectsPath, 'utf8')) ?? {}) as {
      externalProjects?: unknown[];
    };
    externalProjects.push(...(parsed.externalProjects ?? []));
  }

  const duplicatedIds: string[] = [];
  const owned = getManifestIndex().data.manifests.toSorted((a, b) =>
    a.repository.localeCompare(b.repository),
  );
  for (const manifest of owned) {
    const record = stripSchemaHint(manifest.record);
    const id = recordId(record);
    if (id === undefined) {
      continue;
    }
    if (sources.has(id)) {
      duplicatedIds.push(id);
      // The owner wins, so validation sees one record: drop the local copy.
      const index = projects.findIndex((entry) => recordId(entry) === id);
      if (index !== -1) {
        projects.splice(index, 1);
      }
    }
    sources.set(id, `${manifest.repository} (${PROJECT_MANIFEST_PATH} at ${manifest.ref})`);
    projects.push(record);
  }

  return { projects, externalProjects, sources, duplicatedIds };
}

/** The id of a raw record, when it declares one. */
function recordId(record: unknown): string | undefined {
  const id = (record as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Load, parse and validate the catalogue from this repository and from the
 * project repositories that own their records (ADR 0013).
 */
export function loadProjects(): ResolvedProject[] {
  const raw = readRawManifest();
  return parseManifest(raw, DEFAULT_PROJECTS_DIR, undefined, raw.sources);
}

function withExternalDefaults(record: ExternalProjectRecord): ResolvedExternalProject {
  return {
    ...record,
    repository: record.repository ?? null,
    repoUrl: record.repository ? `https://github.com/${record.repository}` : null,
    status: record.status ?? null,
    featured: record.featured ?? false,
    order: record.order ?? 1000,
  };
}

/**
 * Load the external (non-Purview) projects from the manifest. These are
 * projects the organisation collaborates on but does not own; they link to
 * their own site/repository rather than the Purview-Dev catalogue.
 */
export function loadExternalProjects(): ResolvedExternalProject[] {
  let parsed: ProjectManifest;
  try {
    parsed = manifestSchema.parse(readRawManifest());
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues
        .map((issue) => {
          const pathLabel = issue.path.join('.');
          return `  ${pathLabel}: ${issue.message}`;
        })
        .join('\n');
      throw new ManifestValidationError(
        [
          `Invalid project manifest: ${DEFAULT_EXTERNAL_PROJECTS_PATH}`,
          issues,
          '',
          'Remediation: fix the reported property on the external project record.',
        ].join('\n'),
      );
    }
    throw error;
  }
  return (parsed.externalProjects ?? [])
    .map(withExternalDefaults)
    .toSorted((a, b) => a.order - b.order);
}
