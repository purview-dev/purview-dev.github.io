import type { DocsManifest } from './docs/aggregate';
import type { ResolvedProject } from './manifest/load';
import type { ReleaseCacheData } from './releases/types';
import type { DisplayStatus } from './status';

import { readDocsManifest } from './docs/aggregate';
import { loadProjects } from './manifest/load';
import { projectRepoEnrichment } from './releases/repo';
import { getReleaseIndex } from './releases/runtime';
import { hubDescription, hubTitle, humaniseTag } from './seo';
import { displayStatus } from './status';
import { withBase } from './urls';

/**
 * Topic and category hubs — the catalogue's metadata turned into crawlable pages.
 *
 * The site already knows every project's GitHub topics and category, and the
 * documentation manifest knows every page. What it did not have was a
 * *destination* for the words a reader searches with: "c# source generator",
 * "aspire", "event sourcing". A hub is that destination, generated from data
 * rather than authored, so it cannot drift from the catalogue.
 *
 * Two rules keep hubs from becoming thin doorway pages:
 *
 * - a hub is only published when it indexes at least `MIN_HUB_PROJECTS`
 *   projects, so the site never ships a page with one link on it;
 * - every hub lists the real projects (with their status, description and
 *   documentation links) and the documentation pages behind them, so the page
 *   has content of its own rather than being a list of outbound links.
 */

/** A hub indexing fewer projects than this is not published. */
export const MIN_HUB_PROJECTS = 2;

/** Upper bound on the documentation links a single hub lists. */
export const MAX_HUB_DOC_LINKS = 80;

/** One project as a hub lists it. */
export interface HubProject {
  id: string;
  name: string;
  /** Site-relative URL of the catalogue page. */
  url: string;
  description: string;
  status: DisplayStatus;
  category: string;
  tags: string[];
  /** Site-relative documentation entry point, or null when the project has none. */
  docsUrl: string | null;
  docsPageCount: number;
}

/** One documentation page as a hub links it. */
export interface HubDocLink {
  title: string;
  url: string;
  projectName: string;
}

export interface Hub {
  /** Slug used in the URL and as the page parameter. */
  slug: string;
  /** Display label (`C#`, `union types`, `Source generation`). */
  label: string;
  /** Site-relative path (`/topics/c-sharp/`). */
  path: string;
  /** `<title>` subject, without the site name. */
  title: string;
  description: string;
  projects: HubProject[];
  pages: HubDocLink[];
}

export interface HubIndex {
  topics: Hub[];
  categories: Hub[];
}

/**
 * Topic spellings that mean the same thing, canonical spelling last.
 *
 * GitHub topics are lowercase and hyphenated, but they are also free-form, so the
 * same concept arrives spelled two ways ("c-sharp" on one repository, "csharp" on
 * another). Grouping them is what keeps a hub from splitting into two half-empty
 * pages — and from publishing two pages with the same title.
 */
const TOPIC_ALIASES: Record<string, string> = {
  'asp-net-core': 'aspnetcore',
  'c-sharp': 'csharp',
  'dot-net': 'dotnet',
  'ef-core': 'efcore',
  'entity-framework': 'entityframework',
};

/** The canonical spelling of a topic, so aliases share one hub. */
export function canonicalTopic(tag: string): string {
  const normalized = tag.trim().toLowerCase();
  return TOPIC_ALIASES[normalized] ?? normalized;
}

/** Topics that are legal URL segments (GitHub topics already are). */
const TOPIC_SLUG = /^[a-z0-9][a-z0-9-]*$/;

export function topicHubPath(tag: string): string {
  return `/topics/${tag}/`;
}

export function categoryHubPath(category: string): string {
  return `/categories/${category}/`;
}

/**
 * The URL an aggregated page is published at.
 *
 * A page's slug is its path from the docs root (ADR 0011), and an `index` at any
 * depth addresses the directory that holds it — Starlight strips that segment, so
 * `schemas/index` lives at `/docs/<id>/schemas/`, not at `…/schemas/index/`.
 */
export function docsPageUrl(projectId: string, slug: string): string {
  const segments = slug.split('/');
  if (segments[segments.length - 1] === 'index') {
    segments.pop();
  }
  const path = segments.join('/');
  return path === '' ? `/docs/${projectId}/` : `/docs/${projectId}/${path}/`;
}

/** Documentation pages of a project's default channel, in manifest order. */
function defaultChannelPages(
  projectId: string,
  docsManifest: DocsManifest | null,
): { url: string; title: string; slug: string }[] {
  const channel = docsManifest?.projects
    .find((entry) => entry.projectId === projectId)
    ?.channels.find((candidate) => candidate.default);
  if (!channel) {
    return [];
  }
  return channel.pages.map((page) => ({
    slug: page.slug,
    title: page.title,
    url: docsPageUrl(projectId, page.slug),
  }));
}

/**
 * Build every hub from the catalogue, the release cache (which supplies the
 * GitHub topics) and the documentation manifest. Deterministic: the same inputs
 * produce the same pages in the same order.
 */
export function buildHubs(
  projects: readonly ResolvedProject[],
  releaseData: ReleaseCacheData,
  docsManifest: DocsManifest | null,
): HubIndex {
  const active = projects
    .filter((project) => project.status !== 'archived')
    .toSorted((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const byTag = new Map<string, HubProject[]>();
  const byCategory = new Map<string, HubProject[]>();
  const pagesByProject = new Map<string, HubDocLink[]>();

  for (const project of active) {
    const { tags, shortDescription } = projectRepoEnrichment(project, releaseData);
    const validTags = tags.filter((tag) => TOPIC_SLUG.test(tag)).toSorted();
    const docs = defaultChannelPages(project.id, docsManifest);
    const docsIndex = docs.find((page) => page.slug === 'index');
    const entry: HubProject = {
      id: project.id,
      name: project.name,
      url: `/projects/${project.id}/`,
      description: shortDescription,
      status: displayStatus(project),
      category: project.category,
      tags: validTags,
      docsUrl: docsIndex?.url ?? (project.docs ? `/docs/${project.id}/` : null),
      docsPageCount: docs.length,
    };
    pagesByProject.set(
      project.id,
      docs
        .filter((page) => page.slug !== 'index')
        .map((page) => ({ title: page.title, url: page.url, projectName: project.name })),
    );
    // Aliases of one topic share one hub, and a project that carries two spellings
    // of it is listed once (see `canonicalTopic`).
    for (const canonical of new Set(validTags.map(canonicalTopic))) {
      byTag.set(canonical, [...(byTag.get(canonical) ?? []), entry]);
    }
    byCategory.set(project.category, [...(byCategory.get(project.category) ?? []), entry]);
  }

  const docLinksFor = (entries: readonly HubProject[]): HubDocLink[] => {
    const links: HubDocLink[] = [];
    for (const entry of entries) {
      for (const link of pagesByProject.get(entry.id) ?? []) {
        if (links.length >= MAX_HUB_DOC_LINKS) {
          return links;
        }
        links.push(link);
      }
    }
    return links;
  };

  const build = (
    kind: 'topic' | 'category',
    slug: string,
    label: string,
    entries: HubProject[],
  ): Hub => ({
    slug,
    label,
    path: kind === 'topic' ? topicHubPath(slug) : categoryHubPath(slug),
    title: hubTitle(label, kind),
    description: hubDescription({ label, kind, projectNames: entries.map((entry) => entry.name) }),
    projects: entries,
    pages: docLinksFor(entries),
  });

  const topics = [...byTag.entries()]
    .filter(([, entries]) => entries.length >= MIN_HUB_PROJECTS)
    .map(([tag, entries]) => build('topic', tag, humaniseTag(tag), entries))
    .toSorted(
      (a, b) =>
        b.projects.length - a.projects.length ||
        a.label.localeCompare(b.label) ||
        a.slug.localeCompare(b.slug),
    );

  // Two distinct topics can still read the same way (`csharp` and `c_sharp` both
  // become "C#"), and two pages with one title are two pages competing for one
  // query. The slug is the disambiguator of last resort.
  const usedTitles = new Set<string>();
  for (const hub of topics) {
    if (usedTitles.has(hub.title)) {
      hub.title = `${hub.title} (${hub.slug})`;
    }
    usedTitles.add(hub.title);
  }

  const categories = [...byCategory.entries()]
    .filter(([, entries]) => entries.length >= MIN_HUB_PROJECTS)
    .map(([category, entries]) => build('category', category, category.replace(/-/g, ' '), entries))
    .toSorted((a, b) => a.slug.localeCompare(b.slug));

  return { topics, categories };
}

/**
 * Every topic spelling that has a hub, mapped to that hub's href.
 *
 * A caller asks this instead of comparing tags to slugs, so a chip links only
 * where a page exists — and a repository that spells a topic `c-sharp` links the
 * canonical `csharp` hub rather than a page that was never built.
 */
export function topicHubHrefs(hubs: HubIndex = getHubs()): Map<string, string> {
  const hrefs = new Map<string, string>();
  for (const hub of hubs.topics) {
    const href = withBase(hub.path);
    hrefs.set(hub.slug, href);
    for (const [alias, canonical] of Object.entries(TOPIC_ALIASES)) {
      if (canonical === hub.slug) {
        hrefs.set(alias, href);
      }
    }
  }
  return hrefs;
}

/** Site-relative href for a hub, base-aware. */
export function hubHref(hub: Hub): string {
  return withBase(hub.path);
}

let cachedHubs: HubIndex | undefined;

/**
 * The hubs for the site as it is now, derived once per build process.
 *
 * Pages and components all ask the same question — "does this tag have a hub?" —
 * and the answer must be identical everywhere, so it is computed once from the
 * catalogue, the release cache and the docs manifest.
 */
export function getHubs(): HubIndex {
  cachedHubs ??= buildHubs(loadProjects(), getReleaseIndex().data, readDocsManifest());
  return cachedHubs;
}
