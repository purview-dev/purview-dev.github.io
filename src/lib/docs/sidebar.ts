import type { ResolvedProject } from '../manifest/load';
import type { DocsManifest } from './aggregate';

export interface SidebarLinkEntry {
  label: string;
  link: string;
}

export interface SidebarSlugEntry {
  label?: string;
  slug: string;
}

export interface SidebarGroupEntry {
  label: string;
  collapsed?: boolean;
  badge?: {
    text: string;
    variant?: 'default' | 'note' | 'tip' | 'caution' | 'danger' | 'success';
  };
  items: SidebarEntry[];
}

export type SidebarEntry = SidebarLinkEntry | SidebarSlugEntry | SidebarGroupEntry;

/**
 * Build the Starlight sidebar from the project manifest and the aggregated
 * documentation manifest. Every project with documentation becomes a group;
 * the docs portal landing page is linked at the top. Archived projects are
 * excluded (their documentation is not published).
 */
export function buildSidebar(
  projects: ResolvedProject[],
  manifest: DocsManifest | null,
): SidebarEntry[] {
  const sidebar: SidebarEntry[] = [
    {
      label: 'Documentation home',
      link: '/docs/',
    },
  ];

  for (const project of projects) {
    if (!project.docs || project.status === 'archived') {
      continue;
    }
    const docsProject = manifest?.projects.find((entry) => entry.projectId === project.id);
    const pages = docsProject?.pages ?? [];
    const items: SidebarEntry[] = [];
    if (pages.some((page) => page.slug === 'index')) {
      items.push({
        label: 'Overview',
        // Index pages resolve to the directory slug (no trailing "/index");
        // Starlight prefixes the locale dir itself.
        slug: project.id,
      });
    }
    for (const page of pages) {
      if (page.slug === 'index') {
        continue;
      }
      items.push({
        label: page.title,
        slug: `${project.id}/${page.slug}`,
      });
    }
    sidebar.push({
      label: project.name.replace(/^Purview\s+/, ''),
      collapsed: false,
      badge: project.status === 'preview' ? { text: 'Preview', variant: 'caution' } : undefined,
      items,
    });
  }

  return sidebar;
}
