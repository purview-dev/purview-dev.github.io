import { describe, expect, test } from 'bun:test';

import { absoluteUrl, resolveBase, withBase } from '../../src/lib/urls';

describe('base path handling', () => {
  test('resolveBase defaults to root', () => {
    expect(resolveBase(undefined)).toBe('/');
    expect(resolveBase('')).toBe('/');
    expect(resolveBase('/')).toBe('/');
  });

  test('resolveBase normalises project-page bases', () => {
    expect(resolveBase('/purview-dev/')).toBe('/purview-dev');
    expect(resolveBase('purview-dev')).toBe('/purview-dev');
    expect(resolveBase('/nested/path///')).toBe('/nested/path');
  });

  test('withBase prefixes internal paths', () => {
    expect(withBase('/docs/foo', '/')).toBe('/docs/foo');
    expect(withBase('docs/foo', '/')).toBe('/docs/foo');
    expect(withBase('/docs/foo', '/purview-dev')).toBe('/purview-dev/docs/foo');
  });

  test('absoluteUrl combines site, base and path', () => {
    expect(absoluteUrl('/projects/', 'https://purview.dev', '/')).toBe(
      'https://purview.dev/projects/',
    );
    expect(absoluteUrl('/projects/', 'https://purview-dev.github.io', '/purview-dev')).toBe(
      'https://purview-dev.github.io/purview-dev/projects/',
    );
    expect(absoluteUrl('/og/default.png', 'https://purview.dev/', '/')).toBe(
      'https://purview.dev/og/default.png',
    );
  });
});
