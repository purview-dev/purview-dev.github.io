import type { AstroIntegration } from 'astro';

import { fileURLToPath } from 'node:url';

import { readDocsManifest } from '../src/lib/docs/aggregate';
import { writeRetiredChannelRedirects } from '../src/lib/docs/redirects';
import { loadProjects } from '../src/lib/manifest/load';

/**
 * Redirects for retired documentation channels (ADR 0009).
 *
 * A project's `prerelease` channel is withheld automatically once a stable
 * release catches up with it, so its URLs must not 404. purview.dev is served
 * from GitHub Pages, which only serves files, so each retired URL is written as
 * a meta-refresh page pointing at the live page with the same slug.
 *
 * Runs at `astro:build:done` beside the discovery integration. It deliberately
 * writes outside Astro's route list, so the redirects never enter the sitemap,
 * `discover.json` or the llms bundles, and they are marked `noindex` and
 * `data-pagefind-ignore` so they never become search results. Existing files are
 * never overwritten — a published channel owns its URLs.
 */
export default function docsRedirectsIntegration(): AstroIntegration {
  return {
    name: 'purview-docs-redirects',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const written = writeRetiredChannelRedirects(
          fileURLToPath(dir),
          loadProjects(),
          readDocsManifest(),
        );
        if (written.length > 0) {
          logger.info(
            `Redirects: ${written.length} retired documentation URL(s) now point at the live release.`,
          );
        }
      },
    },
  };
}
