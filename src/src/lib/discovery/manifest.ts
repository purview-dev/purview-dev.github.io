import type { DocsManifest } from '../docs/aggregate';
import type { ResolvedProject } from '../manifest/load';
import type { DataSource } from '../releases/transform';
import type { ReleaseCacheData } from '../releases/types';
import type {
  DeploymentState,
  DiscoverableResource,
  DiscoveryManifest,
  DiscoveryManifestProject,
} from './types';

import { createHash } from 'node:crypto';

import { projectReleaseSummary, projectVersionRollup } from '../releases/transform';
import { SITE } from '../site';
import { nugetPackageUrl } from '../urls';
import { DEPLOYMENT_STATE_SCHEMA_VERSION, DISCOVERY_MANIFEST_SCHEMA_VERSION } from './types';
import {
  canonical,
  docsChannelUrl,
  docsUrl,
  projectChannelLlmsFullUrl,
  projectChannelLlmsUrl,
  projectLlmsFullUrl,
  projectLlmsUrl,
  projectPageUrl,
  rootLlmsFullUrl,
  rootLlmsSmallUrl,
  rootLlmsUrl,
  sitemapIndexUrl,
  sitemapLlmsUrl,
  sitemapPagesUrl,
  sitemapProjectsUrl,
} from './urls';

/**
 * The public `discover.json` and the internal deployment-state file.
 *
 * `discover.json` is a **Purview-specific** discovery API — a stable, versioned
 * map of the site for tooling that would rather read one JSON document than
 * crawl. It is deliberately *not* presented as a standard. The deployment state
 * carries a hash per URL for diagnostics and is never published.
 */

/**
 * Build the project list for the discovery manifest.
 *
 * `docsManifest` is optional so a caller without the aggregation cache still
 * gets a valid manifest; when it is present, every published documentation
 * version is described as its own docs site with its own bundles.
 */
export function buildManifestProjects(
  projects: readonly ResolvedProject[],
  releaseData: ReleaseCacheData,
  dataSource: DataSource,
  docsManifest: DocsManifest | null = null,
): DiscoveryManifestProject[] {
  return projects
    .toSorted((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((project) => {
      const summary = projectReleaseSummary(project, releaseData, dataSource);
      const rollup = projectVersionRollup(project, summary);
      const primary = project.packages.find((pkg) => pkg.primary) ?? project.packages[0];
      const hasDocs = project.docs !== undefined && project.status !== 'archived';
      const channels =
        docsManifest?.projects.find((entry) => entry.projectId === project.id)?.channels ?? [];
      const orderedChannels = [
        ...channels.filter((channel) => channel.default),
        ...channels.filter((channel) => !channel.default),
      ];
      return {
        name: project.name,
        slug: project.id,
        url: projectPageUrl(project.id),
        description: project.shortDescription,
        repository: project.repository,
        repositoryUrl: project.sourceUrl,
        docs: project.docs ? docsUrl(project.id) : null,
        category: project.category,
        status: project.status,
        experimental: project.experimental,
        package: primary ? { id: primary.id, url: nugetPackageUrl(primary.id) } : null,
        latestVersion: rollup.prereleaseVersion ?? rollup.stableVersion,
        llms: hasDocs
          ? { summary: projectLlmsUrl(project.id), full: projectLlmsFullUrl(project.id) }
          : null,
        docsChannels: hasDocs
          ? orderedChannels.map((channel) => ({
              id: channel.id,
              label: channel.label,
              version: channel.version,
              default: channel.default,
              docs: docsChannelUrl(project.id, channel.id, channel.default),
              llms: {
                summary: projectChannelLlmsUrl(project.id, channel.id, channel.default),
                full: projectChannelLlmsFullUrl(project.id, channel.id, channel.default),
              },
            }))
          : [],
      };
    });
}

export function buildDiscoveryManifest(options: {
  resources: readonly DiscoverableResource[];
  projects: readonly DiscoveryManifestProject[];
  generatedAt: string;
}): DiscoveryManifest {
  const { resources, projects, generatedAt } = options;
  return {
    schemaVersion: DISCOVERY_MANIFEST_SCHEMA_VERSION,
    name: SITE.orgName,
    url: canonical('/'),
    generatedAt,
    llms: { summary: rootLlmsUrl(), small: rootLlmsSmallUrl(), full: rootLlmsFullUrl() },
    sitemaps: {
      index: sitemapIndexUrl(),
      pages: sitemapPagesUrl(),
      projects: sitemapProjectsUrl(),
      llms: sitemapLlmsUrl(),
    },
    counts: {
      resources: resources.length,
      projects: projects.length,
      documentation: resources.filter((resource) => resource.kind === 'documentation').length,
    },
    resources: [...resources],
    projects: [...projects],
  };
}

/** A stable short hash of a resource's identity for change detection/diagnostics. */
export function hashResource(resource: DiscoverableResource): string {
  return createHash('sha256')
    .update(
      `${resource.url}\n${resource.kind}\n${resource.lastModified ?? ''}\n${resource.indexable}`,
    )
    .digest('hex')
    .slice(0, 16);
}

/** Build the internal (never published) deployment state. */
export function buildDeploymentState(
  resources: readonly DiscoverableResource[],
  generatedAt: string,
): DeploymentState {
  const state: DeploymentState = {
    schemaVersion: DEPLOYMENT_STATE_SCHEMA_VERSION,
    generatedAt,
    resources: {},
  };
  for (const resource of resources) {
    state.resources[resource.url] = {
      lastModified: resource.lastModified,
      hash: hashResource(resource),
    };
  }
  return state;
}

/** Deterministic JSON serialisation with a trailing newline. */
export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
