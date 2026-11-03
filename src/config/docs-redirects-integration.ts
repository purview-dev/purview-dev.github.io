import type { AstroIntegration } from 'astro';

import { fileURLToPath } from 'node:url';

import { readDocsManifest } from '../src/lib/docs/aggregate';
import { writeRetiredChannelRedirects, writeRetiredPageRedirects } from '../src/lib/docs/redirects';
import { loadProjects } from '../src/lib/manifest/load';

/**
 * Redirects for retired documentation channels and moved pages (ADR 0009,
 * ADR 0010).
 *
 * A project's `prerelease` channel is withheld automatically once a stable
 * release catches up with it, and `/skills/` moved to the project pages, so
 * neither set of URLs may 404. purview.dev is served from GitHub Pages, which
 * only serves files, so each retired URL is written as a meta-refresh page
 * pointing at its new home.
 *
 * Runs at `astro:build:done` beside the discovery integration. It deliberately
 * writes outside Astro's route list, so the redirects never enter the sitemap,
 * `discover.json` or the llms bundles, and they are marked `noindex` and
 * `data-pagefind-ignore` so they never become search results. Existing files are
 * never overwritten — a published channel or page owns its URLs.
 */
export default function docsRedirectsIntegration(): AstroIntegration {
  return {
    name: 'purview-docs-redirects',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const dist = fileURLToPath(dir);
        const retired = writeRetiredChannelRedirects(dist, loadProjects(), readDocsManifest());
        const moved = writeRetiredPageRedirects(dist);
        if (retired.length + moved.length > 0) {
          logger.info(
            `Redirects: ${retired.length} retired documentation URL(s) and ${moved.length} moved page(s) now point at their new home.`,
          );
        }
      },
    },
  };
}
