import type { ResolvedProject } from '../manifest/load';
import type { DocsManifest } from './aggregate';

export interface SidebarSlugEntry {
  label?: string;
  slug: string;
}

/**
 * Build the sidebar items for a single project's documentation: an Overview
 * entry when the project has an index page, then one entry per page. These
 * items back a `starlight-sidebar-topics` topic, giving each project its own
 * sidebar drop-down instead of one giant list. Slugs are content-relative and
 * point at pages served under `/docs/<project>/`.
 */
export function buildProjectItems(
  project: ResolvedProject,
  manifest: DocsManifest | null,
): SidebarSlugEntry[] {
  const docsProject = manifest?.projects.find((entry) => entry.projectId === project.id);
  const pages = docsProject?.pages ?? [];
  const items: SidebarSlugEntry[] = [];
  if (pages.some((page) => page.slug === 'index')) {
    items.push({
      label: 'Overview',
      // Index pages resolve to the directory slug (no trailing "/index");
      // Starlight prefixes the locale dir itself.
      slug: `docs/${project.id}`,
    });
  }
  for (const page of pages) {
    if (page.slug === 'index') {
      continue;
    }
    items.push({
      label: page.title,
      slug: `docs/${project.id}/${page.slug}`,
    });
  }
  return items;
}
