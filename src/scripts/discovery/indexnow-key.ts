import { resolve } from 'node:path';

import { writeIndexNowKeyFile } from '../../src/lib/discovery/emit';

/**
 * `bun run discovery:key`
 *
 * Write the IndexNow key verification file (`https://purview.dev/<key>.txt`)
 * into the built site from the `INDEXNOW_KEY` environment variable — in CI, the
 * `INDEXNOW_KEY` repository secret.
 *
 * The build itself never sees the key: the deploy workflow runs the build
 * without it, then runs this command from the secret. This keeps the key out of
 * the build environment and out of any build logs, and makes the key file
 * genuinely "supplied by the CI secret". See `docs/discovery.md`.
 */
const DIST = resolve('dist');

if (import.meta.main) {
  const result = writeIndexNowKeyFile(DIST, process.env.INDEXNOW_KEY);
  if (result.ok) {
    console.log(`${result.message} (${result.file})`);
  } else {
    console.error(result.message);
    process.exit(1);
  }
}
