import { SITE } from '../site';
import { absoluteUrl, withBase } from '../urls';

/**
 * Canonical URL construction for the discovery subsystem.
 *
 * Everything that ends up in a sitemap, a canonical tag, `discover.json`, an
 * `llms.txt` reference or an IndexNow payload must be built here so there is
 * exactly one definition of "the site's URLs". These helpers are thin wrappers
 * over `../urls` (`absoluteUrl`/`withBase`), which already honour `SITE_URL`
 * and `PAGES_BASE`; nothing else in the codebase should concatenate host and
 * path by hand.
 */

/** The production origin. All generated absolute URLs must share it. */
export const PRODUCTION_ORIGIN = 'https://purview.dev';

/** The configured site origin (no trailing slash), e.g. `https://purview.dev`. */
export function siteOrigin(): string {
  return SITE.url.replace(/\/+$/, '');
}

/** Absolute canonical URL for a site path (base-aware). */
export function canonical(path: string): string {
  return absoluteUrl(path);
}

/** Site-relative URL (base-aware) for use in `href` attributes. */
export function href(path: string): string {
  return withBase(path);
}

export const SITEMAP_INDEX_PATH = '/sitemap-index.xml';
export const SITEMAP_PAGES_PATH = '/sitemaps/pages.xml';
export const SITEMAP_PROJECTS_PATH = '/sitemaps/projects.xml';
export const SITEMAP_LLMS_PATH = '/sitemaps/llms.xml';
export const DISCOVER_JSON_PATH = '/discover.json';
export const ROBOTS_PATH = '/robots.txt';

export function sitemapIndexUrl(): string {
  return canonical(SITEMAP_INDEX_PATH);
}
export function sitemapPagesUrl(): string {
  return canonical(SITEMAP_PAGES_PATH);
}
export function sitemapProjectsUrl(): string {
  return canonical(SITEMAP_PROJECTS_PATH);
}
export function sitemapLlmsUrl(): string {
  return canonical(SITEMAP_LLMS_PATH);
}
export function discoverJsonUrl(): string {
  return canonical(DISCOVER_JSON_PATH);
}
export function robotsUrl(): string {
  return canonical(ROBOTS_PATH);
}

export function rootLlmsUrl(): string {
  return canonical('/llms.txt');
}
export function rootLlmsSmallUrl(): string {
  return canonical('/llms-small.txt');
}
export function rootLlmsFullUrl(): string {
  return canonical('/llms-full.txt');
}

export function projectPageUrl(id: string): string {
  return canonical(`/projects/${id}/`);
}

/** Documentation entry point (`/docs/<id>/`) or a specific page when `slug` is given. */
export function docsUrl(projectId: string, slug?: string): string {
  return slug && slug !== 'index'
    ? canonical(`/docs/${projectId}/${slug}/`)
    : canonical(`/docs/${projectId}/`);
}

/** Per-project `llms.txt` (concise) and `llms-full.txt` (full corpus). */
export function projectLlmsUrl(id: string): string {
  return canonical(`/projects/${id}/llms.txt`);
}
export function projectLlmsFullUrl(id: string): string {
  return canonical(`/projects/${id}/llms-full.txt`);
}

/** Whether an absolute URL belongs to the configured canonical origin. */
export function isCanonicalUrl(url: string, origin: string = siteOrigin()): boolean {
  return url.startsWith(`${origin}/`) || url === origin;
}
