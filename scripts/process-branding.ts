import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

export const BRANDING_DIR = resolve('assets', 'branding');
export const PUBLIC_DIR = resolve('public');
export const PUBLIC_BRANDING_DIR = resolve(PUBLIC_DIR, 'branding');
export const OG_DIR = resolve(PUBLIC_DIR, 'og');

const BRAND_PURPLE = '#8B3DFF';
const BRAND_DEEP = '#6820D2';

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function copyInto(source: string, target: string): void {
  ensureDir(dirname(target));
  copyFileSync(source, target);
}

/**
 * Generate the raster and static brand assets used by the built site from the
 * canonical source assets in ./assets/branding. Source files are never modified.
 */
export async function processBranding(): Promise<void> {
  ensureDir(PUBLIC_BRANDING_DIR);
  ensureDir(OG_DIR);

  // Adaptive SVG masters (site favicon, icon). Kept as-is.
  copyInto(resolve(BRANDING_DIR, 'purview-icon.svg'), resolve(PUBLIC_DIR, 'favicon.svg'));
  copyInto(resolve(BRANDING_DIR, 'purview-icon.svg'), resolve(PUBLIC_BRANDING_DIR, 'icon.svg'));

  // PNG marks: explicit light/dark variants for themed contexts.
  copyInto(
    resolve(BRANDING_DIR, 'purview-icon-light-512x512.png'),
    resolve(PUBLIC_BRANDING_DIR, 'icon-light-512.png'),
  );
  copyInto(
    resolve(BRANDING_DIR, 'purview-icon-dark-512x512.png'),
    resolve(PUBLIC_BRANDING_DIR, 'icon-dark-512.png'),
  );
  copyInto(
    resolve(BRANDING_DIR, 'purview-logo-horizontal-light-600x206.png'),
    resolve(PUBLIC_BRANDING_DIR, 'logo-horizontal-light.png'),
  );
  copyInto(
    resolve(BRANDING_DIR, 'purview-logo-horizontal-dark-600x206.png'),
    resolve(PUBLIC_BRANDING_DIR, 'logo-horizontal-dark.png'),
  );
  copyInto(
    resolve(BRANDING_DIR, 'purview-banner-light-1280x320.png'),
    resolve(PUBLIC_BRANDING_DIR, 'banner-light.png'),
  );
  copyInto(
    resolve(BRANDING_DIR, 'purview-banner-dark-1280x320.png'),
    resolve(PUBLIC_BRANDING_DIR, 'banner-dark.png'),
  );

  // Raster favicons and touch/application icons derived from the light mark.
  const iconSource = resolve(BRANDING_DIR, 'purview-icon-light-512x512.png');
  await resizeTo(iconSource, resolve(PUBLIC_DIR, 'favicon-16.png'), 16);
  await resizeTo(iconSource, resolve(PUBLIC_DIR, 'favicon-32.png'), 32);
  await resizeTo(iconSource, resolve(PUBLIC_DIR, 'apple-touch-icon.png'), 180);
  await resizeTo(iconSource, resolve(PUBLIC_DIR, 'icon-192.png'), 192);
  await resizeTo(iconSource, resolve(PUBLIC_DIR, 'icon-512.png'), 512);

  // Default Open Graph image: brand gradient + dark horizontal logo.
  await renderOgImage();
}

async function resizeTo(source: string, target: string, size: number): Promise<void> {
  ensureDir(dirname(target));
  const output = await sharp(source).resize(size, size, { fit: 'contain' }).png().toBuffer();
  writeFileSync(target, output);
}

async function renderOgImage(): Promise<void> {
  const width = 1200;
  const height = 630;
  const gradient = buildGradientBuffer(width, height, BRAND_DEEP, BRAND_PURPLE);
  const logoSource = resolve(BRANDING_DIR, 'purview-logo-horizontal-dark-1200x411.png');
  const logo = sharp(logoSource);
  const logoMeta = await logo.metadata();
  const logoWidth = 840;
  const logoHeight = Math.round((logoWidth * (logoMeta.height ?? 411)) / (logoMeta.width ?? 1200));
  const logoBuffer = await logo.resize(logoWidth, logoHeight).png().toBuffer();

  const output = await sharp(gradient, { raw: { width, height, channels: 3 } })
    .composite([
      {
        input: logoBuffer,
        gravity: 'center',
      },
    ])
    .png()
    .toBuffer();

  writeFileSync(resolve(OG_DIR, 'default.png'), output);
}

function buildGradientBuffer(
  width: number,
  height: number,
  fromHex: string,
  toHex: string,
): Buffer {
  const from = hexToRgb(fromHex);
  const to = hexToRgb(toHex);
  const buffer = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const t = y / (height - 1);
    const r = Math.round(from.r + (to.r - from.r) * t);
    const g = Math.round(from.g + (to.g - from.g) * t);
    const b = Math.round(from.b + (to.b - from.b) * t);
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      buffer[offset] = r;
      buffer[offset + 1] = g;
      buffer[offset + 2] = b;
    }
  }
  return buffer;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace('#', '');
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

if (import.meta.main) {
  await processBranding();
  console.log('Branding assets processed into public/.');
}
