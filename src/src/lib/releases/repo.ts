import type { ResolvedProject } from '../manifest/load';
import type { ReleaseCacheData } from './types';

export interface ProjectRepoEnrichment {
  /** GitHub repository description (may be empty or null). */
  repoDescription: string | null;
  /** GitHub repository topics, used as content tags. */
  tags: string[];
  /** Effective short description: the manifest value, falling back to the repo description. */
  shortDescription: string;
}

/**
 * Merge build-time GitHub repository metadata (description + topics) into a
 * catalogue project. The curated manifest stays the source of truth; repo data
 * supplements it (tags) and backs the short description when the manifest does
 * not provide one.
 */
export function projectRepoEnrichment(
  project: ResolvedProject,
  cache: ReleaseCacheData,
): ProjectRepoEnrichment {
  const repo = cache.repos[project.repository];
  const repoDescription = repo?.description?.trim() || null;
  const tags = repo?.topics ?? [];
  return {
    repoDescription,
    tags,
    shortDescription: project.shortDescription || repoDescription || project.name,
  };
}
