import { SITE } from './site';

/**
 * Resolve a deployment base path from a raw value. GitHub Pages project sites
 * live under a `/<repo>/` path; organisation Pages sites and custom domains
 * live at the root. Controlled by the `PAGES_BASE` environment variable so the
 * same source builds for every target.
 */
export function resolveBase(raw?: string): string {
  const value = raw ?? '/';
  if (value === '/' || value === '') {
    return '/';
  }
  const trimmed = value.replace(/\/+$/, '');
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export const BASE = resolveBase(process.env.PAGES_BASE);

/** Prefix an internal path with a base path. */
export function withBase(path: string, base: string = BASE): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (base === '/') {
    return normalized;
  }
  return `${base}${normalized}`;
}

/** Absolute, canonical URL for an internal path (site + base + path). */
export function absoluteUrl(path: string, site: string = SITE.url, base: string = BASE): string {
  return `${site.replace(/\/$/, '')}${withBase(path, base)}`;
}

/** Canonical production URL for a project resource (used in metadata). */
export function projectUrl(repository: string): string {
  return `https://github.com/${repository}`;
}

/** NuGet package page URL. */
export function nugetPackageUrl(packageId: string, nugetUrl: string = SITE.nugetUrl): string {
  return `${nugetUrl}/packages/${encodeURIComponent(packageId)}`;
}
