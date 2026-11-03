import type { ResolvedProject } from '../manifest/load';
import type { DocsManifest, DocsManifestChannel } from './aggregate';

import { channelDisplayLabel } from './channels';

export interface SidebarSlugEntry {
  label?: string;
  slug: string;
}

/** A Starlight sidebar group: one documentation channel of a project. */
export interface SidebarGroupEntry {
  label: string;
  collapsed?: boolean;
  items: SidebarSlugEntry[];
}

export type SidebarEntry = SidebarSlugEntry | SidebarGroupEntry;

/** Content-relative base for a channel: `docs/<id>` or `docs/<id>/<channel>`. */
function channelBase(projectId: string, channel: DocsManifestChannel): string {
  return channel.default ? `docs/${projectId}` : `docs/${projectId}/${channel.id}`;
}

/**
 * Items for one channel: an Overview entry when the channel has an index page,
 * then one entry per page. Index pages resolve to the directory slug (no
 * trailing `/index`); Starlight prefixes the locale dir itself.
 */
function channelItems(projectId: string, channel: DocsManifestChannel): SidebarSlugEntry[] {
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
 * Build the sidebar items for a single project's documentation.
 *
 * A single-channel project keeps a flat list (the historical behaviour). A
 * project with a second channel groups its pages per channel — `Live v2.4.2`
 * and `Prerelease main` — because the sidebar is shown for every page of the
 * project and must be able to reach both.
 */
export function buildProjectItems(
  project: ResolvedProject,
  manifest: DocsManifest | null,
): SidebarEntry[] {
  const entry = manifest?.projects.find((candidate) => candidate.projectId === project.id);
  const channels = entry?.channels ?? [];
  if (channels.length === 0) {
    return [];
  }
  if (channels.length === 1) {
    return channelItems(project.id, channels[0]!);
  }

  const ordered = [
    ...channels.filter((channel) => channel.default),
    ...channels.filter((channel) => !channel.default),
  ];
  const groups: SidebarGroupEntry[] = [];
  for (const channel of ordered) {
    const items = channelItems(project.id, channel);
    if (items.length === 0) {
      continue;
    }
    groups.push({
      label: channelDisplayLabel(channel),
      // The default channel stays open; the alternative starts collapsed so the
      // sidebar does not double in length for every reader.
      collapsed: !channel.default,
      items,
    });
  }
  return groups;
}
