import type { ProjectManifest, ProjectRecord } from './schema';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

import { OWNER } from '../site';
import { PROJECT_DEFAULTS, manifestSchema } from './schema';

export const DEFAULT_MANIFEST_PATH = resolve('src/data/projects.yml');

export interface ResolvedProject extends ProjectRecord {
  repoOwner: string;
  repoName: string;
  sourceUrl: string;
  issuesUrl: string;
  discussionsUrl: string | null;
  changelogUrl: string;
  releasesUrl: string;
  featured: boolean;
  order: number;
  packages: NonNullable<ProjectRecord['packages']>;
  related: NonNullable<ProjectRecord['related']>;
  discussions: boolean;
}

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
    order: record.order ?? PROJECT_DEFAULTS.order,
    packages: record.packages ?? PROJECT_DEFAULTS.packages,
    related: record.related ?? PROJECT_DEFAULTS.related,
    discussions: record.discussions ?? PROJECT_DEFAULTS.discussions,
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
        .map((issue) => {
          const path = issue.path.join('.');
          return `  ${path}: ${issue.message}`;
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

  const projects = parsed.projects.map(withDefaults);
  const ids = new Set(projects.map((p) => p.id));
  const packageOwners = new Map<string, string>();

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
  }

  return projects.toSorted((a, b) => a.order - b.order);
}

/** Load, parse and validate the project manifest from disk. */
export function loadProjects(path = DEFAULT_MANIFEST_PATH): ResolvedProject[] {
  const sourceText = readFileSync(path, 'utf8');
  return parseManifest(parse(sourceText), path);
}
