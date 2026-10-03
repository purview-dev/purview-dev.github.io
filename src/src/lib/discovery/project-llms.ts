import type { ResolvedProject } from '../manifest/load';

import { nugetPackageUrl } from '../urls';
import { docsUrl, projectLlmsFullUrl, projectPageUrl } from './urls';

/**
 * Per-project machine-readable resources, following the emerging `llms.txt`
 * convention at the natural project scope:
 *
 * - `/projects/<slug>/llms.txt`      — a concise index: what the project is and
 *   where its repository, package and documentation live.
 * - `/projects/<slug>/llms-full.txt` — the project's aggregated documentation
 *   as one Markdown corpus.
 *
 * These are *additional representations* of the canonical HTML documentation,
 * not a search-engine protocol, and they are generated only for projects that
 * actually have aggregated documentation.
 */

export interface ProjectLlmsPage {
  slug: string;
  title: string;
}

/** Strip the leading YAML frontmatter block from generated Markdown. */
export function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

function resourceLines(project: ResolvedProject): string[] {
  const primary = project.packages.find((pkg) => pkg.primary) ?? project.packages[0];
  const lines = [
    `- Repository: ${project.sourceUrl}`,
    `- Project page: ${projectPageUrl(project.id)}`,
    `- Documentation: ${docsUrl(project.id)}`,
    `- Full machine-readable content: ${projectLlmsFullUrl(project.id)}`,
  ];
  if (primary) {
    lines.splice(1, 0, `- Package: ${nugetPackageUrl(primary.id)}`);
  }
  return lines;
}

/** The concise `/projects/<slug>/llms.txt` entry point. */
export function renderProjectLlms(
  project: ResolvedProject,
  pages: readonly ProjectLlmsPage[],
): string {
  const lines: string[] = [
    `# ${project.name}`,
    '',
    `> ${project.shortDescription}`,
    '',
    project.description,
    '',
    '## Resources',
    '',
    ...resourceLines(project),
  ];

  if (pages.length > 0) {
    lines.push('', '## Documentation pages', '');
    for (const page of pages) {
      lines.push(`- ${page.title}: ${docsUrl(project.id, page.slug)}`);
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
): string {
  const header: string[] = [
    `# ${project.name}`,
    '',
    `> ${project.shortDescription}`,
    '',
    project.description,
    '',
    ...resourceLines(project),
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
