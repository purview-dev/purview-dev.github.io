import type { AstroIntegration } from 'astro';

import { fileURLToPath } from 'node:url';

import { emitDiscoveryArtifacts } from '../src/lib/discovery/emit';

/**
 * The discovery integration.
 *
 * Runs at `astro:build:done` — after every page has been written — and derives
 * all discovery artifacts from the site's own sources of truth (the catalogue,
 * the docs manifest, the release cache and the page list Astro just built). It
 * replaces `@astrojs/sitemap` so the sitemap index can be partitioned
 * (`pages.xml` / `projects.xml` / `llms.xml`) and carry meaningful `lastmod`
 * values, and it emits everything from one `DiscoverableResource[]` model:
 *
 * - `/sitemap-index.xml` + `/sitemaps/{pages,projects,llms}.xml`
 * - `/robots.txt`
 * - `/discover.json` (Purview-specific; see `docs/discovery.md`)
 * - `/projects/<slug>/llms.txt` + `/projects/<slug>/llms-full.txt`
 * - `.cache/discovery/state.json` (internal, never published)
 *
 * The IndexNow key verification file (`/<INDEXNOW_KEY>.txt`) is deliberately
 * *not* written here: the build never sees the key. The deploy workflow supplies
 * it from the `INDEXNOW_KEY` secret via `bun run discovery:key`.
 */
export default function discoveryIntegration(): AstroIntegration {
  return {
    name: 'purview-discovery',
    hooks: {
      'astro:build:done': ({ dir, pages, logger }) => {
        emitDiscoveryArtifacts({
          dist: fileURLToPath(dir),
          pagePaths: pages.map((page) => page.pathname),
          logger,
        });
      },
    },
  };
}
