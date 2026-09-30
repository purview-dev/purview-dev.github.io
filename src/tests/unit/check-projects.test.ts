import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { checkProjects } from '../../scripts/check-projects';

/**
 * The catalogue guard reads the generated docs cache, which only exists after a
 * data sync (`just data-sync`, or any build). `just validate` syncs before it
 * runs the test suite, so the assertion is active there and in CI; a bare
 * `bun run test` on a fresh clone skips it instead of failing on missing data.
 */
const HAS_DOCS_CACHE = existsSync(resolve('.cache/docs/index.json'));

describe('catalogue guard', () => {
  test.skipIf(!HAS_DOCS_CACHE)('the committed catalogue passes every invariant', () => {
    const { errors } = checkProjects();
    expect(
      errors.map((finding) => `[${finding.project}] ${finding.field}: ${finding.observed}`),
    ).toEqual([]);
  });

  test('every finding carries the detail needed to remediate it', () => {
    const { errors, warnings } = checkProjects();
    for (const finding of [...errors, ...warnings]) {
      expect(finding.project.length).toBeGreaterThan(0);
      expect(finding.field.length).toBeGreaterThan(0);
      expect(finding.expected.length).toBeGreaterThan(0);
      expect(finding.remediation.length).toBeGreaterThan(0);
    }
  });
});
