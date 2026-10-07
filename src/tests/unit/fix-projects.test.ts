import { describe, expect, test } from 'bun:test';

import {
  applyAutofix,
  setPackageTargetFrameworks,
  setProjectTargetFrameworks,
  setStatus,
} from '../../scripts/fix-projects';

const SAMPLE = [
  '$schema: ../../lib/manifest/schema.ts',
  '',
  'id: sample',
  'name: Sample',
  'status: preview',
  'docs:',
  '  source: readme',
  'targetFrameworks:',
  '  - net8.0',
  'packages:',
  '  - id: Sample.Core',
  '    description: Core.',
  '    primary: true',
  '  - id: Sample.Generator',
  '    description: Generator.',
  '    targetFrameworks:',
  '      - netstandard2.0',
  '',
];

describe('fix-projects line editing', () => {
  test('replaces an existing project targetFrameworks list', () => {
    const updated = setProjectTargetFrameworks([...SAMPLE], ['net8.0', 'net9.0']);
    expect(updated.join('\n')).toContain('targetFrameworks:\n  - net8.0\n  - net9.0\npackages:');
  });

  test('is a no-op when the project list already matches', () => {
    expect(setProjectTargetFrameworks([...SAMPLE], ['net8.0'])).toEqual(SAMPLE);
  });

  test('inserts a project targetFrameworks block before packages', () => {
    const without = SAMPLE.filter((line) => line !== 'targetFrameworks:' && line !== '  - net8.0');
    const updated = setProjectTargetFrameworks(without, ['net8.0']);
    const packagesIndex = updated.indexOf('packages:');
    expect(updated.slice(packagesIndex - 2, packagesIndex)).toEqual([
      'targetFrameworks:',
      '  - net8.0',
    ]);
  });

  test('inserts a package-level targetFrameworks block after the last property', () => {
    const updated = setPackageTargetFrameworks([...SAMPLE], 'Sample.Core', ['net8.0', 'net9.0']);
    expect(updated.join('\n')).toContain(
      [
        '  - id: Sample.Core',
        '    description: Core.',
        '    primary: true',
        '    targetFrameworks:',
        '      - net8.0',
        '      - net9.0',
        '  - id: Sample.Generator',
      ].join('\n'),
    );
  });

  test('replaces an existing package-level targetFrameworks list', () => {
    const updated = setPackageTargetFrameworks([...SAMPLE], 'Sample.Generator', ['netstandard2.0']);
    expect(updated).toEqual(SAMPLE);
  });

  test('sets the top-level status', () => {
    expect(setStatus([...SAMPLE], 'stable').join('\n')).toContain('status: stable');
  });

  test('dispatches a structured fix', () => {
    const updated = applyAutofix([...SAMPLE], { kind: 'set-status', value: 'stable' });
    expect(updated.join('\n')).toContain('status: stable');
  });
});
