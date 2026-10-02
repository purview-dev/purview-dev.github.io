import { describe, expect, test } from 'bun:test';

import { DISPLAY_STATUSES, displayStatus } from '../../src/lib/status';

describe('display status', () => {
  test('keeps the lifecycle status when a project is not experimental', () => {
    expect(displayStatus({ status: 'stable', experimental: false })).toBe('stable');
    expect(displayStatus({ status: 'preview', experimental: false })).toBe('preview');
  });

  test('reports an experimental project as experimental', () => {
    expect(displayStatus({ status: 'preview', experimental: true })).toBe('experimental');
    expect(displayStatus({ status: 'stable', experimental: true })).toBe('experimental');
  });

  test('never reports an archived project as experimental', () => {
    expect(displayStatus({ status: 'archived', experimental: true })).toBe('archived');
  });

  test('every display status is reachable from the two manifest axes', () => {
    const reachable = new Set([
      displayStatus({ status: 'stable', experimental: false }),
      displayStatus({ status: 'preview', experimental: false }),
      displayStatus({ status: 'preview', experimental: true }),
      displayStatus({ status: 'archived', experimental: false }),
    ]);
    expect([...reachable].toSorted()).toEqual([...DISPLAY_STATUSES].toSorted());
  });
});
