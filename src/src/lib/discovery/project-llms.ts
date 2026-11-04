import type { ResolvedProject } from '../manifest/load';

import { packagePageUrl } from '../urls';
import {
  docsChannelUrl,
  docsUrl,
  projectChannelLlmsUrl,
  projectLlmsFullUrl,
  projectPageUrl,
} from './urls';

/**
 * Per-version machine-readable resources, following the emerging `llms.txt`
 * convention at the natural project scope:
 *
 * - `/projects/<slug>/llms.txt`      — a concise index: what the project is and
 *   where its repository, package and documentation live.
 * - `/projects/<slug>/llms-full.txt` — the project's aggregated documentation
 *   as one Markdown corpus.
 *
 * A project that republishes its documentation for two versions (ADR 0009) has
 * two documentation sets, so it has two bundles: the default channel keeps the
 * historical paths above and every other channel lives under its own segment
 * (`/projects/<slug>/prerelease/llms.txt`). One corpus never mixes two versions
 * of the same page — a model reading it could not tell which version it got.
 *
 * These are *additional representations* of the canonical HTML documentation,
 * not a search-engine protocol, and they are generated only for projects that
 * actually have aggregated documentation.
 */

export interface ProjectLlmsPage {
  slug: string;
  title: string;
}

/** One published documentation version, as an LLM bundle has to describe it. */
export interface ProjectLlmsChannel {
  id: string;
  /** Version label (`2.4.2`) or the ref when no version is known (`main`). */
  label: string;
  /** The version this channel documents, when it names one. */
  version: string | null;
  /** Git ref the documentation was aggregated from. */
  ref: string;
  /** True for the channel that owns the canonical `/docs/<id>/` URLs. */
  default: boolean;
}

export interface ProjectLlmsOptions {
  /** The version this bundle documents; omitted only when docs are unavailable. */
  channel?: ProjectLlmsChannel;
  /** Every published version, so a bundle can point at the others. */
  channels?: readonly ProjectLlmsChannel[];
  /** Docs base URL of this version, with a trailing slash. */
  docsBaseUrl?: string;
  /** This bundle's own `llms-full.txt` URL. */
  fullUrl?: string;
  /** The concise index, linked from the full corpus. */
  summaryUrl?: string;
}

/** Strip the leading YAML frontmatter block from generated Markdown. */
export function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

/** The docs root this bundle describes. */
function docsBase(project: ResolvedProject, options: ProjectLlmsOptions): string {
  if (options.docsBaseUrl) {
    return options.docsBaseUrl;
  }
  return options.channel
    ? docsChannelUrl(project.id, options.channel.id, options.channel.default)
    : docsUrl(project.id);
}

function resourceLines(project: ResolvedProject, options: ProjectLlmsOptions): string[] {
  const primary = project.packages.find((pkg) => pkg.primary) ?? project.packages[0];
  const lines = [
    `- Repository: ${project.sourceUrl}`,
    `- Project page: ${projectPageUrl(project.id)}`,
    `- Documentation: ${docsBase(project, options)}`,
    `- Full machine-readable content: ${options.fullUrl ?? projectLlmsFullUrl(project.id)}`,
  ];
  if (primary) {
    const registry = primary.registry === 'npm' ? 'npm package' : 'NuGet package';
    lines.splice(1, 0, `- ${registry}: ${packagePageUrl(primary.registry, primary.id)}`);
  }
  if (options.summaryUrl) {
    lines.push(`- Concise machine-readable index: ${options.summaryUrl}`);
  }
  return lines;
}

/**
 * The version block every versioned bundle carries.
 *
 * A corpus read by a model has no sidebar and no URL bar to say which version
 * it is: without this section two bundles for the same product are
 * indistinguishable. It also lists the other published versions' bundles, so a
 * model can move to another line instead of mixing versions together.
 */
function versionLines(project: ResolvedProject, options: ProjectLlmsOptions): string[] {
  const { channel, channels = [] } = options;
  if (!channel) {
    return [];
  }
  const lines = ['## Documentation version', ''];
  if (channel.version) {
    lines.push(`- Version: ${channel.version}`);
  }
  lines.push(`- Channel: ${channel.id}${channel.default ? ' (default)' : ''}`);
  lines.push(`- Source: ${project.repository}@${channel.ref}`);
  const others = channels.filter((candidate) => candidate.id !== channel.id);
  if (others.length > 0) {
    lines.push('', '## Other versions', '');
    for (const other of others) {
      lines.push(`- ${other.label}: ${projectChannelLlmsUrl(project.id, other.id, other.default)}`);
    }
  }
  lines.push('');
  return lines;
}

/** The concise `/projects/<slug>/llms.txt` entry point. */
export function renderProjectLlms(
  project: ResolvedProject,
  pages: readonly ProjectLlmsPage[],
  options: ProjectLlmsOptions = {},
): string {
  const base = docsBase(project, options);
  const lines: string[] = [
    `# ${project.name}`,
    '',
    `> ${project.shortDescription}`,
    '',
    project.description,
    '',
    ...versionLines(project, options),
    '## Resources',
    '',
    ...resourceLines(project, options),
  ];

  if (pages.length > 0) {
    lines.push('', '## Documentation pages', '');
    for (const page of pages) {
      const url = page.slug === 'index' ? base : `${base}${page.slug}/`;
      lines.push(`- ${page.title}: ${url}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/** The full `/projects/<slug>/llms-full.txt` corpus, built from the docs mirror. */
export function renderProjectLlmsFull(
  project: ResolvedProject,
  pages: readonly ProjectLlmsPage[],
  readPage: (slug: string) => string | null,
  options: ProjectLlmsOptions = {},
): string {
  const header: string[] = [
    `# ${project.name}`,
    '',
    `> ${project.shortDescription}`,
    '',
    project.description,
    '',
    ...versionLines(project, options),
    '## Resources',
    '',
    ...resourceLines(project, options),
    '',
  ];

  const body = pages
    .map((page) => readPage(page.slug))
    .filter((content): content is string => Boolean(content))
    .map((content) => stripFrontmatter(content))
    .filter((content) => content.length > 0)
    .join('\n\n---\n\n');

  return `${[...header, body, ''].join('\n')}`;
}
