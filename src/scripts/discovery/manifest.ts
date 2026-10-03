import { glob } from 'fast-glob';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { emitDiscoveryArtifacts } from '../../src/lib/discovery/emit';
import { normalizePagePath } from '../../src/lib/discovery/resources';

/**
 * `bun run discovery:manifest`
 *
 * Regenerate the discovery artifacts (`sitemap-index.xml`, `sitemaps/*.xml`,
 * `robots.txt`, `discover.json`, per-project `llms*.txt`) in an existing `dist/`
 * from the current catalogue/docs/release caches. The Astro integration writes
 * the same files during a build; this command exists for local inspection and
 * for re-emitting after a data sync without a full rebuild.
 *
 * The `dist/` page list is reconstructed by scanning for directory-format
 * `index.html` files (the same shape Astro emits). `fast-glob` is a CommonJS
 * dependency, so this helper deliberately lives in the CLI rather than in the
 * integration (which Vite loads).
 */
const DIST = resolve('dist');

async function collectPagePathsFromDist(dist: string): Promise<string[]> {
  const files = await glob('**/index.html', { cwd: dist, onlyFiles: true });
  const paths = files.map((file) => normalizePagePath(file.replace(/index\.html$/, '')));
  if (!paths.includes('')) {
    paths.push('');
  }
  return paths;
}

if (import.meta.main) {
  if (!existsSync(DIST)) {
    console.error('dist/ does not exist. Run `bun run build` first.');
    process.exit(1);
  }
  const pagePaths = await collectPagePathsFromDist(DIST);
  const { resources, partition } = emitDiscoveryArtifacts({
    dist: DIST,
    pagePaths,
    logger: { info: console.log, warn: console.warn },
  });
  console.log(
    `Discovery manifest written: ${resources.length} resources ` +
      `(${partition.pages.length} pages, ${partition.projects.length} project/documentation, ` +
      `${partition.llms.length} llms).`,
  );
}
