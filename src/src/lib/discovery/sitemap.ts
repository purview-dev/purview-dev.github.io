import type { DiscoverableResource } from './types';

import { latestTimestamp } from './last-modified';

/**
 * Sitemap XML generation. Pure string builders (no I/O) so the output can be
 * asserted directly in tests. The sitemap index advertises three child sitemaps
 * (`pages.xml`, `projects.xml`, `llms.xml`) plus the IndexNow key endpoint is
 * handled elsewhere; the structure is decided in the Astro integration.
 *
 * `lastmod` is the strongest content-derived date available (see
 * `last-modified.ts`); it is omitted rather than set to the build time when no
 * provenance exists.
 */

const SITEMAP_NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Render one `<urlset>` document for a group of resources. */
export function renderUrlset(resources: readonly DiscoverableResource[]): string {
  const entries = resources
    .map((resource) => {
      const lastmod = resource.lastModified
        ? `<lastmod>${escapeXml(resource.lastModified)}</lastmod>`
        : '';
      return `<url><loc>${escapeXml(resource.url)}</loc>${lastmod}</url>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="${SITEMAP_NS}">${entries}</urlset>`;
}

export interface SitemapIndexEntry {
  loc: string;
  lastmod?: string;
}

/** Latest `lastmod` across a group of resources, for the index entry. */
export function latestLastmod(resources: readonly DiscoverableResource[]): string | undefined {
  return latestTimestamp(resources.map((resource) => resource.lastModified));
}

/** Render the `<sitemapindex>` document that lists the child sitemaps. */
export function renderSitemapIndex(entries: readonly SitemapIndexEntry[]): string {
  const body = entries
    .map((entry) => {
      const lastmod = entry.lastmod ? `<lastmod>${escapeXml(entry.lastmod)}</lastmod>` : '';
      return `<sitemap><loc>${escapeXml(entry.loc)}</loc>${lastmod}</sitemap>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="${SITEMAP_NS}">${body}</sitemapindex>`;
}
