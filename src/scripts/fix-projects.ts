import type { Autofix } from './check-projects';

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_PROJECTS_DIR } from '../src/lib/manifest/load';
import { checkProjects } from './check-projects';

/**
 * Apply the catalogue guard's machine-applicable fixes to the project records
 * under `src/src/data/projects/`.
 *
 * The advisory observations in `check-projects.ts` carry an optional structured
 * `autofix`; this script applies those and leaves everything else (blockers,
 * judgement calls such as replacing a deprecated package) to a human. It is
 * dry-run by default — pass `--write` to edit the files. The edits are surgical
 * line splices so the hand-authored YAML (folded scalars, comments, ordering)
 * is preserved.
 */

/** Top-level keys a new `targetFrameworks:` block is inserted before. */
const TOP_LEVEL_ANCHORS = [
  'install:',
  'packages:',
  'related:',
  'useCases:',
  'acknowledgments:',
  'discussions:',
  'supersedes:',
  'supersededBy:',
];

/** Replace (or insert) the top-level `targetFrameworks:` list. */
export function setProjectTargetFrameworks(lines: string[], value: string[]): string[] {
  const block = ['targetFrameworks:', ...value.map((entry) => `  - ${entry}`)];
  const keyIndex = lines.findIndex((line) => line.startsWith('targetFrameworks:'));
  if (keyIndex !== -1) {
    let count = 0;
    while (
      keyIndex + 1 + count < lines.length &&
      (lines[keyIndex + 1 + count] ?? '').startsWith('  - ')
    ) {
      count += 1;
    }
    lines.splice(keyIndex, 1 + count, ...block);
    return lines;
  }
  const anchor = TOP_LEVEL_ANCHORS.map((key) => lines.findIndex((line) => line.startsWith(key)))
    .filter((index) => index !== -1)
    .reduce((lowest, index) => Math.min(lowest, index), lines.length);
  lines.splice(anchor, 0, ...block);
  return lines;
}

/** Replace (or insert) the `targetFrameworks:` list inside a package entry. */
export function setPackageTargetFrameworks(
  lines: string[],
  packageId: string,
  value: string[],
): string[] {
  const idIndex = lines.findIndex((line) => line.trimEnd() === `  - id: ${packageId}`);
  if (idIndex === -1) {
    return lines;
  }
  let end = idIndex + 1;
  while (end < lines.length && (lines[end] ?? '').startsWith('    ')) {
    end += 1;
  }
  const keyIndex = lines.findIndex(
    (line, index) => index > idIndex && index < end && line.startsWith('    targetFrameworks:'),
  );
  const block = ['    targetFrameworks:', ...value.map((entry) => `      - ${entry}`)];
  if (keyIndex !== -1) {
    let count = 0;
    while (
      keyIndex + 1 + count < end &&
      (lines[keyIndex + 1 + count] ?? '').startsWith('      - ')
    ) {
      count += 1;
    }
    lines.splice(keyIndex, 1 + count, ...block);
  } else {
    lines.splice(end, 0, ...block);
  }
  return lines;
}

/** Replace the top-level `status:` value. */
export function setStatus(lines: string[], status: string): string[] {
  const index = lines.findIndex((line) => line.startsWith('status:'));
  if (index !== -1) {
    lines[index] = `status: ${status}`;
  }
  return lines;
}

/** Apply a single structured fix to a manifest's lines. */
export function applyAutofix(lines: string[], autofix: Autofix): string[] {
  switch (autofix.kind) {
    case 'set-project-target-frameworks':
      return setProjectTargetFrameworks(lines, autofix.value);
    case 'set-package-target-frameworks':
      return setPackageTargetFrameworks(lines, autofix.packageId, autofix.value);
    case 'set-status':
      return setStatus(lines, autofix.value);
  }
}

function describeAutofixes(autofixes: Autofix[]): string {
  return autofixes
    .map((autofix) => {
      switch (autofix.kind) {
        case 'set-project-target-frameworks':
          return `project targetFrameworks -> ${autofix.value.join(', ') || '(none)'}`;
        case 'set-package-target-frameworks':
          return `${autofix.packageId} targetFrameworks -> ${autofix.value.join(', ')}`;
        case 'set-status':
          return `status -> ${autofix.value}`;
      }
    })
    .join('; ');
}

function run(): number {
  const write = process.argv.includes('--write');
  console.log(write ? 'Fixing the project catalogue...' : 'Planning catalogue fixes (dry run)...');

  const { warnings } = checkProjects();
  const fixable = warnings.filter((finding) => finding.autofix !== undefined);
  if (fixable.length === 0) {
    console.log('No auto-fixable catalogue observations.');
    return 0;
  }

  const byProject = new Map<string, Autofix[]>();
  for (const finding of fixable) {
    if (!finding.autofix) {
      continue;
    }
    byProject.set(finding.project, [...(byProject.get(finding.project) ?? []), finding.autofix]);
  }

  let changed = 0;
  for (const [projectId, autofixes] of byProject) {
    const file = join(DEFAULT_PROJECTS_DIR, `${projectId}.yml`);
    const original = readFileSync(file, 'utf8');
    let lines = original.split('\n');
    for (const autofix of autofixes) {
      lines = applyAutofix(lines, autofix);
    }
    const updated = lines.join('\n');
    if (updated === original) {
      continue;
    }
    changed += 1;
    console.log(`  ${write ? 'fixed' : 'would fix'} ${projectId}: ${describeAutofixes(autofixes)}`);
    if (write) {
      writeFileSync(file, updated, 'utf8');
    }
  }

  if (write) {
    console.log(`Updated ${changed} project file(s).`);
    const after = checkProjects();
    console.log(`${after.warnings.length} observation(s) remain after the fix.`);
  } else {
    console.log(`${changed} project file(s) would change. Re-run with \`--write\` to apply.`);
  }
  return 0;
}

if (import.meta.main) {
  process.exit(run());
}
