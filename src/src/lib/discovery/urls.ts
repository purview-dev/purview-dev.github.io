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

/**
 * Documentation URL for one published version.
 *
 * The default channel owns the historical `/docs/<id>/` URLs; every other
 * channel adds its id as a path segment (`/docs/<id>/prerelease/`), exactly
 * like the aggregated mirror writes it. `slug` may be a page slug or omitted
 * for the channel landing page.
 */
export function docsChannelUrl(
  projectId: string,
  channelId: string,
  isDefault: boolean,
  slug?: string,
): string {
  const base = isDefault ? `/docs/${projectId}/` : `/docs/${projectId}/${channelId}/`;
  return slug && slug !== 'index' ? canonical(`${base}${slug}/`) : canonical(base);
}

/** Documentation entry point (`/docs/<id>/`) or a specific page when `slug` is given. */
export function docsUrl(projectId: string, slug?: string): string {
  return docsChannelUrl(projectId, 'live', true, slug);
}

/** Site-relative path of a version's concise `llms.txt` bundle. */
export function projectChannelLlmsPath(id: string, channelId: string, isDefault: boolean): string {
  return isDefault ? `/projects/${id}/llms.txt` : `/projects/${id}/${channelId}/llms.txt`;
}

/** Site-relative path of a version's `llms-full.txt` bundle. */
export function projectChannelLlmsFullPath(
  id: string,
  channelId: string,
  isDefault: boolean,
): string {
  return isDefault ? `/projects/${id}/llms-full.txt` : `/projects/${id}/${channelId}/llms-full.txt`;
}

/** Per-version `llms.txt` (concise) and `llms-full.txt` (full corpus). */
export function projectChannelLlmsUrl(id: string, channelId: string, isDefault: boolean): string {
  return canonical(projectChannelLlmsPath(id, channelId, isDefault));
}
export function projectChannelLlmsFullUrl(
  id: string,
  channelId: string,
  isDefault: boolean,
): string {
  return canonical(projectChannelLlmsFullPath(id, channelId, isDefault));
}

/** The default channel's bundles, which keep the historical project URLs. */
export function projectLlmsUrl(id: string): string {
  return projectChannelLlmsUrl(id, 'live', true);
}
export function projectLlmsFullUrl(id: string): string {
  return projectChannelLlmsFullUrl(id, 'live', true);
}

/** Whether an absolute URL belongs to the configured canonical origin. */
export function isCanonicalUrl(url: string, origin: string = siteOrigin()): boolean {
  return url.startsWith(`${origin}/`) || url === origin;
}
