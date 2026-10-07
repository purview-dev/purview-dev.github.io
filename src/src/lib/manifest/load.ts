import type { ExternalProjectRecord, ProjectManifest, ProjectRecord } from './schema';

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

import { OWNER } from '../site';
import { PROJECT_DEFAULTS, manifestSchema } from './schema';

/**
 * The catalogue is one file per project (ADR 0005): `src/data/projects/<id>.yml`,
 * plus `src/data/external-projects.yml` for the collaborations the organisation
 * does not own. One file per project keeps a project's history and review
 * self-contained, and stops concurrent catalogue pull requests from conflicting
 * on one growing list.
 */
export const DEFAULT_PROJECTS_DIR = resolve('src/data/projects');
export const DEFAULT_EXTERNAL_PROJECTS_PATH = resolve('src/data/external-projects.yml');

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
  packages: NonNullable<ProjectRecord['packages']>;
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

export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestValidationError';
  }
}

function withDefaults(record: ProjectRecord): ResolvedProject {
  const [repoOwner = OWNER, repoName = ''] = record.repository.split('/');
  const repo = `https://github.com/${record.repository}`;
  return {
    ...record,
    featured: record.featured ?? PROJECT_DEFAULTS.featured,
    experimental: record.experimental ?? PROJECT_DEFAULTS.experimental,
    order: record.order ?? PROJECT_DEFAULTS.order,
    packages: record.packages ?? PROJECT_DEFAULTS.packages,
    assets: record.assets ?? PROJECT_DEFAULTS.assets,
    related: record.related ?? PROJECT_DEFAULTS.related,
    useCases: record.useCases ?? PROJECT_DEFAULTS.useCases,
    acknowledgments: record.acknowledgments ?? PROJECT_DEFAULTS.acknowledgments,
    discussions: record.discussions ?? PROJECT_DEFAULTS.discussions,
    install: record.install ?? PROJECT_DEFAULTS.install,
    repoOwner,
    repoName,
    sourceUrl: repo,
    issuesUrl: `${repo}/issues`,
    discussionsUrl: record.discussions ? `${repo}/discussions` : null,
    changelogUrl: `${repo}/blob/${'main'}/CHANGELOG.md`,
    releasesUrl: `${repo}/releases`,
  };
}

/**
 * Label an issue with the project id rather than its array index, so a schema
 * failure names the project whose file is wrong (`projects[containers].name`)
 * instead of a position the author has to map back to a file.
 */
function issuePath(raw: unknown, path: readonly PropertyKey[]): string {
  const [head, index, ...rest] = path;
  if (head !== 'projects' || typeof index !== 'number') {
    return path.join('.');
  }
  const entries = (raw as { projects?: unknown[] } | null)?.projects;
  const entry = Array.isArray(entries) ? entries[index] : undefined;
  const id =
    typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : undefined;
  const label = `projects[${typeof id === 'string' ? id : index}]`;
  return rest.length > 0 ? `${label}.${rest.join('.')}` : label;
}

/**
 * Validate a raw manifest object against the typed schema.
 * Throws a ManifestValidationError describing the source file, the invalid
 * property, the expected shape, and how to remediate the record.
 */
export function parseManifest(raw: unknown, source: string): ResolvedProject[] {
  let parsed: ProjectManifest;
  try {
    parsed = manifestSchema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues
        .map((issue) => `  ${issuePath(raw, issue.path)}: ${issue.message}`)
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

  const projects = parsed.projects.map(withDefaults);
  const ids = new Set(projects.map((p) => p.id));
  const packageOwners = new Map<string, string>();
  const assetOutputs = new Map<string, string>();

  for (const project of projects) {
    if (project.repository.split('/')[0] !== OWNER) {
      throw new ManifestValidationError(
        [
          `Invalid project manifest: ${source}`,
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
            `Invalid project manifest: ${source}`,
            `  projects[${project.id}]: Relationship references "${ref}", which is not a known project id.`,
            '',
            `Remediation: add a project with id "${ref}" or remove the relationship.`,
          ].join('\n'),
        );
      }
    }
    for (const pkg of project.packages ?? []) {
      const existing = packageOwners.get(pkg.id);
      if (existing !== undefined) {
        throw new ManifestValidationError(
          [
            `Invalid project manifest: ${source}`,
            `  projects[${project.id}].packages: NuGet package "${pkg.id}" is also declared by "${existing}".`,
            '',
            `Remediation: associate each NuGet package with exactly one project.`,
          ].join('\n'),
        );
      }
      packageOwners.set(pkg.id, project.id);
    }
    for (const asset of project.assets) {
      const existing = assetOutputs.get(asset.output);
      if (existing !== undefined) {
        throw new ManifestValidationError(
          [
            `Invalid project manifest: ${source}`,
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
 * Read the catalogue from disk into the raw shape `manifestSchema` validates:
 * one record per `*.yml` file in the projects directory, sorted by file name so
 * the result is deterministic whatever order the filesystem reports, plus the
 * collaborations file. Validation (including every cross-record invariant)
 * stays in `parseManifest`.
 */
export function readRawManifest(
  projectsDir = DEFAULT_PROJECTS_DIR,
  externalProjectsPath = DEFAULT_EXTERNAL_PROJECTS_PATH,
): { projects: unknown[]; externalProjects: unknown[] } {
  const files = readdirSync(projectsDir)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .toSorted();

  const projects = files.map((file) => {
    const text = readFileSync(join(projectsDir, file), 'utf8');
    try {
      return stripSchemaHint(parse(text));
    } catch (error) {
      throw new ManifestValidationError(
        `Invalid YAML in ${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  const externalProjects: unknown[] = [];
  if (existsSync(externalProjectsPath)) {
    const parsed = (parse(readFileSync(externalProjectsPath, 'utf8')) ?? {}) as {
      externalProjects?: unknown[];
    };
    externalProjects.push(...(parsed.externalProjects ?? []));
  }

  return { projects, externalProjects };
}

/** Load, parse and validate the catalogue (one file per project) from disk. */
export function loadProjects(): ResolvedProject[] {
  return parseManifest(readRawManifest(), DEFAULT_PROJECTS_DIR);
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
