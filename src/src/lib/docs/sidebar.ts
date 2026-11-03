import type { ResolvedProject } from '../manifest/load';
import type { DocsManifest, DocsManifestChannel } from './aggregate';

import { channelBasePath } from './channels';

export interface SidebarSlugEntry {
  label?: string;
  slug: string;
}

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
  items: SidebarSlugEntry[];
}

/** Content-relative base for a channel: `docs/<id>` or `docs/<id>/<channel>`. */
function channelBase(projectId: string, channel: DocsManifestChannel): string {
  return channel.default ? `docs/${projectId}` : `docs/${projectId}/${channel.id}`;
}

/**
 * Items for one channel: an Overview entry when the channel has an index page,
 * then one entry per page. Index pages resolve to the directory slug (no
 * trailing `/index`); Starlight prefixes the locale dir itself.
 */
export function buildChannelItems(
  projectId: string,
  channel: DocsManifestChannel,
): SidebarSlugEntry[] {
  const base = channelBase(projectId, channel);
  const items: SidebarSlugEntry[] = [];
  if (channel.pages.some((page) => page.slug === 'index')) {
    items.push({ label: 'Overview', slug: base });
  }
  for (const page of channel.pages) {
    if (page.slug === 'index') {
      continue;
    }
    items.push({ label: page.title, slug: `${base}/${page.slug}` });
  }
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
