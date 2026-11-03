import type { ResolvedProject } from '../manifest/load';
import type { DocsManifest, DocsManifestChannel } from './aggregate';

import { channelBasePath } from './channels';

/** A single documentation page, linked by its content-collection slug. */
export interface SidebarSlugEntry {
  label?: string;
  slug: string;
}

/**
 * A folder of the documentation tree, rendered as a Starlight sidebar group.
 *
 * A folder is a place in the tree rather than a page, so the group carries no
 * link of its own: a source tree that ships an index file for the folder
 * contributes a page (see `nestPages`), and otherwise the pages inside it are
 * the links.
 */
export interface SidebarGroupEntry {
  label: string;
  items: SidebarDocItem[];
  /** Folders start open; Starlight remembers what a reader collapses. */
  collapsed?: boolean;
}

export type SidebarDocItem = SidebarSlugEntry | SidebarGroupEntry;

/**
 * One documentation version, exposed as its own Starlight topic.
 *
 * `link` is the version's landing page and `items` are that version's pages
 * only: the two channels of a project never share a topic.
 */
export interface SidebarChannelTopic {
  /** Stable topic identifier (`<project>` or `<project>-<channel>`). */
  id: string;
  label: string;
  link: string;
  items: SidebarDocItem[];
}

/**
 * Segments whose spelled-out form is wrong in a label: a folder called `json`
 * is JSON, not "Json".
 */
const SEGMENT_UPPERCASE = new Set([
  'aot',
  'api',
  'cli',
  'http',
  'https',
  'json',
  'mcp',
  'nuget',
  'sdk',
  'sql',
  'ui',
  'url',
  'xml',
  'yaml',
]);

/**
 * Display label for one slug segment: `compiled-validators` → `Compiled Validators`.
 *
 * A source folder has no title of its own — only its name — so a group label is
 * the folder's segment spelled out, exactly as `extractTitle` spells out a file
 * name when a page has no heading.
 */
export function docSectionLabel(segment: string): string {
  return segment
    .split(/[-_]+/)
    .filter((word) => word !== '')
    .map((word) =>
      SEGMENT_UPPERCASE.has(word)
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
}

/**
 * Display labels of the folders a page lives in, outermost first:
 * `schemas/custom-rules` → `['Schemas']`.
 *
 * The page itself is not part of the trail; this names the sections above it, so
 * a page can say where in the tree it lives as well as which project it belongs
 * to.
 */
export function docSectionTrail(slug: string): string[] {
  return slug
    .split('/')
    .slice(0, -1)
    .filter((segment) => segment !== '')
    .map(docSectionLabel);
}

/** Content-relative base for a channel: `docs/<id>` or `docs/<id>/<channel>`. */
function channelBase(projectId: string, channel: DocsManifestChannel): string {
  return channel.default ? `docs/${projectId}` : `docs/${projectId}/${channel.id}`;
}

/**
 * Slug of the content entry a page is published as.
 *
 * An `index` page addresses the directory that holds it — Starlight strips the
 * `index` segment, so `schemas/index.md` is served at `<base>/schemas`, not at
 * `<base>/schemas/index`. Starlight prefixes the locale dir itself.
 */
function entrySlug(base: string, slug: string): string {
  const segments = slug.split('/');
  if (segments[segments.length - 1] === 'index') {
    return [base, ...segments.slice(0, -1)].join('/');
  }
  return `${base}/${slug}`;
}

/**
 * Arrange a channel's pages into the folder tree their slugs describe.
 *
 * Since ADR 0011 a slug is a path (`schemas/custom-rules`), so the hierarchy a
 * project publishes is already in the data: the sidebar renders it instead of
 * flattening it into one list of thirty links. A folder appears where its first
 * page appears and its pages keep the order the channel gives them (`docs.order`
 * or `_Sidebar.md`), which is what keeps the sync's reading order intact.
 *
 * A flat corpus has no folder in any slug, so it produces no group here: the
 * entries are exactly the page list, in order, as before.
 */
function nestPages(pages: DocsManifestChannel['pages'], base: string): SidebarDocItem[] {
  const items: SidebarDocItem[] = [];
  // Keyed by the folder's full path (`schemas`, `guides/getting-started`), never
  // by its own name, so two folders may share a leaf name at different depths.
  const groups = new Map<string, SidebarGroupEntry>();
  for (const page of pages) {
    const segments = page.slug.split('/');
    let siblings = items;
    let path = base;
    for (const folder of segments.slice(0, -1)) {
      path = `${path}/${folder}`;
      let group = groups.get(path);
      if (!group) {
        group = { label: docSectionLabel(folder), items: [] };
        groups.set(path, group);
        siblings.push(group);
      }
      siblings = group.items;
    }
    siblings.push({ label: page.title, slug: entrySlug(base, page.slug) });
  }
  return items;
}

/**
 * Items for one channel: an Overview entry when the channel has an index page,
 * then one entry per page, nested by the folders its slug names.
 */
export function buildChannelItems(
  projectId: string,
  channel: DocsManifestChannel,
): SidebarDocItem[] {
  const base = channelBase(projectId, channel);
  const items: SidebarDocItem[] = [];
  if (channel.pages.some((page) => page.slug === 'index')) {
    items.push({ label: 'Overview', slug: base });
  }
  items.push(
    ...nestPages(
      channel.pages.filter((page) => page.slug !== 'index'),
      base,
    ),
  );
  return items;
}

/**
 * Build the sidebar topics for a single project's documentation.
 *
 * A channel is a whole documentation set, so each published version contributes
 * its own topic and its own page list — the sidebar must describe the version
 * the reader is on. The versions are **not** shown in the sidebar, though: every
 * topic for a project carries the project's name, and the topic picker collapses
 * the duplicates (see `TopicSelect.astro`). Choosing a version is the job of the
 * page switcher, which only appears while two versions are published.
 */
export function buildProjectTopics(
  project: ResolvedProject,
  manifest: DocsManifest | null,
): SidebarChannelTopic[] {
  const entry = manifest?.projects.find((candidate) => candidate.projectId === project.id);
  const channels = entry?.channels ?? [];
  if (channels.length === 0) {
    return [];
  }
  const ordered = [
    ...channels.filter((channel) => channel.default),
    ...channels.filter((channel) => !channel.default),
  ];
  return ordered
    .map((channel) => ({
      id: channels.length > 1 ? `${project.id}-${channel.id}` : project.id,
      label: project.name,
      link: channelBasePath(project.id, channel.id, channel.default),
      items: buildChannelItems(project.id, channel),
    }))
    .filter((topic) => topic.items.length > 0);
}
