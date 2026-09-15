import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

import { BRANDING_DIR, PUBLIC_BRANDING_DIR } from './process-branding';

export const EXPECTED_BRANDING = {
  'purview-icon.svg': null,
  'purview-logo-horizontal.svg': null,
  'purview-banner.svg': null,
  'purview-icon-light-512x512.png': [512, 512],
  'purview-icon-dark-512x512.png': [512, 512],
  'purview-icon-light-1024x1024.png': [1024, 1024],
  'purview-icon-dark-1024x1024.png': [1024, 1024],
  'purview-icon-dark-background-square-1024x1024.png': [1024, 1024],
  'purview-icon-light-background-rounded-512x512.png': [512, 512],
  'purview-logo-horizontal-light-600x206.png': [600, 206],
  'purview-logo-horizontal-dark-600x206.png': [600, 206],
  'purview-logo-horizontal-light-1200x411.png': [1200, 411],
  'purview-logo-horizontal-dark-1200x411.png': [1200, 411],
  'purview-banner-light-1280x320.png': [1280, 320],
  'purview-banner-dark-1280x320.png': [1280, 320],
  'README.md': null,
} as const;

const TRANSPARENT_CORNERS = new Set<string>([
  'purview-icon-light-512x512.png',
  'purview-icon-dark-512x512.png',
  'purview-logo-horizontal-light-600x206.png',
  'purview-logo-horizontal-dark-600x206.png',
  'purview-banner-light-1280x320.png',
  'purview-banner-dark-1280x320.png',
]);

const errors: string[] = [];

function fail(message: string): void {
  errors.push(message);
  console.error(`  ✗ ${message}`);
}

async function assertPngDimensions(
  file: string,
  expected: readonly [number, number] | null,
): Promise<void> {
  const path = resolve(BRANDING_DIR, file);
  if (!existsSync(path)) {
    fail(`Missing branding source: ${file}`);
    return;
  }
  const meta = await sharp(path).metadata();
  if (expected && (meta.width !== expected[0] || meta.height !== expected[1])) {
    fail(
      `Unexpected dimensions for ${file}: expected ${expected[0]}x${expected[1]}, got ${meta.width}x${meta.height}`,
    );
  }
  if (TRANSPARENT_CORNERS.has(file)) {
    const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
    const corner = (x: number, y: number) => (y * info.width + x) * info.channels + 3;
    const alphas = [
      data[corner(0, 0)],
      data[corner(info.width - 1, 0)],
      data[corner(0, info.height - 1)],
      data[corner(info.width - 1, info.height - 1)],
    ];
    if (alphas.some((alpha) => alpha !== 0)) {
      fail(`Expected transparent corners for ${file}, got alphas ${alphas.join(',')}`);
    }
  }
}

function assertSvgSafe(file: string): void {
  const path = resolve(BRANDING_DIR, file);
  if (!existsSync(path)) {
    fail(`Missing branding source: ${file}`);
    return;
  }
  const content = readFileSync(path, 'utf8');
  if (!content.includes('<svg') || !/viewBox=["'][^"']+["']/.test(content)) {
    fail(`SVG is missing an <svg> root or viewBox: ${file}`);
  }
  if (/<script/i.test(content)) {
    fail(`SVG contains a <script> element (unsafe): ${file}`);
  }
  if (/href=["'][^"']*https?:\/\//i.test(content) || /xlink:href/i.test(content)) {
    fail(`SVG references an external resource (unsafe): ${file}`);
  }
  if (!/#8b3dff|#8B3DFF|8b3dff/i.test(content)) {
    fail(`SVG does not reference the brand purple #8B3DFF: ${file}`);
  }
  const openTags = (content.match(/<[a-zA-Z]/g) ?? []).length;
  const closeTags = (content.match(/<\/[a-zA-Z]/g) ?? []).length;
  if (openTags < closeTags) {
    fail(`SVG markup appears malformed (unbalanced tags): ${file}`);
  }
}

async function assertGeneratedAssets(): Promise<void> {
  const expectedGenerated = [
    ['favicon.svg', null],
    ['favicon-16.png', [16, 16]],
    ['favicon-32.png', [32, 32]],
    ['apple-touch-icon.png', [180, 180]],
    ['icon-192.png', [192, 192]],
    ['icon-512.png', [512, 512]],
    ['og/default.png', [1200, 630]],
  ] as const;
  for (const [file, dims] of expectedGenerated) {
    const path = resolve('public', file);
    if (!existsSync(path)) {
      fail(`Missing generated public asset: ${file}`);
      continue;
    }
    if (dims) {
      const meta = await sharp(path).metadata();
      if (meta.width !== dims[0] || meta.height !== dims[1]) {
        fail(
          `Unexpected dimensions for generated ${file}: expected ${dims[0]}x${dims[1]}, got ${meta.width}x${meta.height}`,
        );
      }
    }
  }
  for (const file of readdirSync(PUBLIC_BRANDING_DIR)) {
    if (!existsSync(join(PUBLIC_BRANDING_DIR, file))) {
      fail(`Missing generated branding asset: branding/${file}`);
    }
  }
}

async function run(): Promise<number> {
  console.log('Checking branding sources...');
  for (const [file, dims] of Object.entries(EXPECTED_BRANDING)) {
    if (file.endsWith('.svg')) {
      assertSvgSafe(file);
    } else if (file.endsWith('.png')) {
      await assertPngDimensions(file, dims as [number, number] | null);
    } else if (!existsSync(resolve(BRANDING_DIR, file))) {
      fail(`Missing branding source: ${file}`);
    }
  }
  await assertGeneratedAssets();

  if (errors.length > 0) {
    console.error(`\nBranding check failed with ${errors.length} issue(s).`);
    return 1;
  }
  console.log('Branding check passed.');
  return 0;
}

if (import.meta.main) {
  process.exit(await run());
}
