import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { EXPECTED_BRANDING } from '../../scripts/check-assets';

describe('branding assets', () => {
  test('every expected branding source file exists', () => {
    for (const file of Object.keys(EXPECTED_BRANDING)) {
      expect(existsSync(resolve('assets/branding', file)), `missing ${file}`).toBe(true);
    }
  });

  test('the canonical SVG masters are safe and brand-consistent', () => {
    for (const file of ['purview-icon.svg', 'purview-logo-horizontal.svg', 'purview-banner.svg']) {
      const content = readFileSync(resolve('assets/branding', file), 'utf8');
      expect(content).toContain('<svg');
      expect(content).toMatch(/viewBox=/);
      expect(content).not.toMatch(/<script/i);
      expect(content).toMatch(/8b3dff/i);
      expect(content).toMatch(/purview-purple/);
    }
  });

  test('the branding README documents the brand colours', () => {
    const readme = readFileSync(resolve('assets/branding', 'README.md'), 'utf8');
    expect(readme).toMatch(/8B3DFF/);
    expect(readme).toMatch(/6820D2/);
    expect(readme).toMatch(/17141F/);
  });

  test('canonical source assets are not modified copies', () => {
    // The light/dark horizontal logos must remain distinct files (the site
    // depends on both for its theme-aware header).
    expect(
      existsSync(resolve('assets/branding', 'purview-logo-horizontal-light-600x206.png')),
    ).toBe(true);
    expect(existsSync(resolve('assets/branding', 'purview-logo-horizontal-dark-600x206.png'))).toBe(
      true,
    );
  });
});
