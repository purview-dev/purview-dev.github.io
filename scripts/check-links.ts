import { glob } from 'fast-glob';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { posix, resolve } from 'node:path';

const DIST = resolve('dist');

const HREF_PATTERN = /\b(?:href|src)\s*=\s*["']([^"']+)["']/g;
const ID_PATTERN = /\bid\s*=\s*["']([^"']+)["']/g;

function isExternalUrl(target: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(target) ||
    target.startsWith('//') ||
    target.startsWith('data:') ||
    target.startsWith('mailto:')
  );
}

function splitHash(target: string): [string, string] {
  const hashIndex = target.indexOf('#');
  if (hashIndex === -1) {
    return [target, ''];
  }
  return [target.slice(0, hashIndex), target.slice(hashIndex)];
}

function stripQuery(path: string): string {
  const queryIndex = path.indexOf('?');
  return queryIndex === -1 ? path : path.slice(0, queryIndex);
}

function toPosixPath(filePath: string): string {
  return filePath.split('\\').join('/');
}

/** Resolve a link (relative or root-absolute) to a POSIX path under `/`. */
function resolveTarget(pageFile: string, linkPath: string): string {
  const clean = stripQuery(linkPath);
  let resolved: string;
  if (clean.startsWith('/')) {
    resolved = posix.normalize(clean);
  } else {
    const pageDir = posix.dirname(toPosixPath(pageFile));
    resolved = posix.normalize(posix.join('/', pageDir, clean));
  }
  return resolved.length > 1 ? resolved.replace(/\/+$/, '') : resolved;
}

function fileExistsInDist(path: string): boolean {
  const resolved = resolve(DIST, `.${path}`);
  if (!existsSync(resolved)) {
    return false;
  }
  const stat = statSync(resolved);
  if (stat.isDirectory()) {
    return existsSync(resolve(resolved, 'index.html'));
  }
  return stat.isFile();
}

/** Map an HTML file path to its site URL path (e.g. "foo/index.html" -> "/foo"). */
function urlPathOf(file: string): string {
  const posixPath = toPosixPath(file);
  const stripped = posixPath.replace(/\/?index\.html$/, '');
  return `/${stripped}`;
}

/**
 * Validate that every internal href/src in the built site resolves to a file
 * (or page) inside dist, and that any hash anchors exist on the target page.
 * Anchor matching is case-insensitive, matching GitHub/Starlight heading slugs.
 * External URLs are skipped.
 */
export async function checkLinks(dist = DIST): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  const htmlFiles = await glob('**/*.html', { cwd: dist, onlyFiles: true });
  const anchorIndex = new Map<string, Set<string>>();

  for (const file of htmlFiles) {
    const anchors = new Set<string>();
    const content = readFileSync(resolve(dist, file), 'utf8');
    let anchorMatch: RegExpExecArray | null;
    while ((anchorMatch = ID_PATTERN.exec(content))) {
      anchors.add((anchorMatch[1] ?? '').toLowerCase());
    }
    anchorIndex.set(urlPathOf(file), anchors);
  }

  for (const file of htmlFiles) {
    const content = readFileSync(resolve(dist, file), 'utf8');
    const currentUrl = urlPathOf(file);
    const currentAnchors = anchorIndex.get(currentUrl) ?? new Set<string>();

    let match: RegExpExecArray | null;
    while ((match = HREF_PATTERN.exec(content))) {
      const rawTarget = match[1] ?? '';
      if (isExternalUrl(rawTarget)) {
        continue;
      }
      const [pathPart, hash] = splitHash(rawTarget);
      const cleanPath = stripQuery(pathPart);
      if (hash && hash !== '#') {
        const target = resolveTarget(file, cleanPath);
        const targetAnchors =
          cleanPath === '' ? currentAnchors : (anchorIndex.get(target) ?? new Set<string>());
        if (!targetAnchors.has(hash.slice(1).toLowerCase())) {
          errors.push(`${file}: missing anchor #${hash.slice(1)} (${rawTarget})`);
          continue;
        }
      }
      if (cleanPath === '' || cleanPath === '/') {
        continue;
      }
      const target = resolveTarget(file, cleanPath);
      if (!fileExistsInDist(target)) {
        errors.push(`${file}: broken link ${rawTarget} -> ${target}`);
      }
    }
  }
  return { errors };
}

if (import.meta.main) {
  if (!existsSync(DIST)) {
    console.error('dist/ does not exist. Run `just build` first.');
    process.exit(1);
  }
  const { errors } = await checkLinks();
  if (errors.length > 0) {
    console.error(`Link check failed with ${errors.length} broken link(s):`);
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }
  console.log('Link check passed.');
}
