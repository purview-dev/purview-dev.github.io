import type { DiscoverableResource } from '../../src/lib/discovery/types';

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertCanonicalOrigin,
  buildIndexNowPayload,
  changeCount,
  chunk,
  indexNowKeyLocation,
  urlsToSubmit,
  diffResources,
} from '../../src/lib/discovery/indexnow';
import { submitIndexNowBatches } from '../../src/lib/discovery/indexnow-client';
import { siteOrigin } from '../../src/lib/discovery/urls';

/**
 * `bun run discovery:indexnow [--dry-run] [--verbose] [--current <file>] [--previous <file>]`
 *
 * Notify IndexNow participants (Bing and friends) about URLs that were added or
 * materially changed since the previous deployment. Only *changed* URLs are
 * submitted — never the whole site — and the IndexNow key is never logged.
 *
 * Runs only after a successful production deployment (the workflow's
 * `indexnow` job `needs: deploy`). `--dry-run` performs no network call and
 * needs no key, so it is safe in local development.
 */

const DEFAULT_CURRENT = resolve('dist', 'discover.json');

interface ManifestShape {
  resources?: DiscoverableResource[];
}

/**
 * Read a discovery manifest from a local path or an `http(s)` URL. Returns null
 * when the location is missing (e.g. the very first deployment has no previous
 * manifest) or unreadable, so change detection treats everything as new.
 */
async function readResources(location: string): Promise<DiscoverableResource[] | null> {
  let text: string | null = null;
  if (/^https?:\/\//i.test(location)) {
    try {
      const response = await fetch(location, {
        headers: { 'User-Agent': 'purview-dev-discovery' },
      });
      if (response.ok) {
        text = await response.text();
      }
    } catch {
      text = null;
    }
  } else if (existsSync(location)) {
    text = readFileSync(location, 'utf8');
  }
  if (text === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as ManifestShape;
    return Array.isArray(parsed.resources) ? parsed.resources : null;
  } catch {
    return null;
  }
}

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function run(): Promise<number> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');
  const currentFile = argValue(args, '--current') ?? DEFAULT_CURRENT;
  const previousFile = argValue(args, '--previous');

  const current = await readResources(currentFile);
  if (!current) {
    console.error(`No discovery manifest with resources found at ${currentFile}.`);
    console.error('Build the site (or pass --current <discover.json>) before notifying IndexNow.');
    return 1;
  }
  const previous = previousFile ? await readResources(previousFile) : null;

  const changes = diffResources(previous, current);
  const urls = urlsToSubmit(changes);

  console.log('Discovery changes');
  console.log('');
  console.log(`Added:      ${changes.added.length}`);
  console.log(`Modified:   ${changes.modified.length}`);
  console.log(`Deleted:    ${changes.deleted.length}`);
  console.log('');

  if (verbose) {
    for (const [label, list] of [
      ['added', changes.added],
      ['modified', changes.modified],
      ['deleted', changes.deleted],
    ] as const) {
      if (list.length > 0) {
        console.log(`${label}:`);
        for (const url of list) {
          console.log(`  ${url}`);
        }
      }
    }
    console.log('');
  }

  if (urls.length === 0) {
    console.log('Nothing to submit to IndexNow.');
    return 0;
  }

  const origin = siteOrigin();
  // Refuse to submit anything outside the canonical origin, before any network.
  assertCanonicalOrigin(urls, origin);

  if (dryRun) {
    console.log(`Would submit ${urls.length} URLs to IndexNow.`);
    return 0;
  }

  const key = process.env.INDEXNOW_KEY?.trim();
  if (!key) {
    console.error('INDEXNOW_KEY is not set; refusing to submit. Use --dry-run to inspect locally.');
    return 1;
  }

  const host = new URL(origin).host;
  const keyLocation = indexNowKeyLocation(origin, key);
  const batches = chunk(urls).map((batch) => buildIndexNowPayload(host, key, keyLocation, batch));
  console.log(`Submitting ${urls.length} URLs in ${batches.length} batch(es) to IndexNow.`);

  let failures = 0;
  const responses = await submitIndexNowBatches(batches, {
    onResult: (index, response) => {
      if (response.ok) {
        console.log(`  batch ${index + 1}/${batches.length}: HTTP ${response.status}`);
      } else {
        failures += 1;
        console.error(
          `  batch ${index + 1}/${batches.length}: HTTP ${response.status}` +
            `${response.retryable ? ' (retryable, exhausted)' : ''}`,
        );
      }
    },
  });

  const total = responses.length;
  if (failures > 0) {
    console.error(`IndexNow submission finished with ${failures}/${total} failed batch(es).`);
    console.error('The site deployment itself succeeded; this notification step is the failure.');
    return 1;
  }
  console.log(`IndexNow accepted all ${total} batch(es) (${changeCount(changes)} changes).`);
  return 0;
}

if (import.meta.main) {
  process.exit(await run());
}
