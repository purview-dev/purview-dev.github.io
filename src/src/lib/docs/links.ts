/**
 * Deterministic transforms applied to aggregated documentation so the source
 * markdown renders correctly inside Starlight and never leaks build paths.
 */

const DOC_EXTENSIONS = new Set(['md', 'mdx']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif']);

/** Slugify a wiki/doc file name into a Starlight route slug. */
export function slugifyDocFile(fileName: string): string {
  const parts = fileName.split('.');
  const base = parts.length > 1 ? parts.slice(0, -1).join('.') : fileName;
  return base
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

export interface DocLinkContext {
  /** Project id, used for GitHub fallback URLs. */
  projectId: string;
  /** Repository in "owner/name" form, used for GitHub fallback URLs. */
  repository: string;
  /** Default branch of the source repository. */
  branch: string;
  /** Slugs (project-relative) that resolve to aggregated doc pages. */
  knownSlugs: Set<string>;
  /** Source path of the doc directory within the repository (e.g. "docs/wiki"). */
  sourcePath: string;
  /** Absolute base URL for relative image references, or null to leave them relative. */
  imageBase: string | null;
  /** Lowercased heading slugs per page slug, used to validate link fragments. */
  headingSlugs: Map<string, Set<string>>;
}

function stripUrlSuffix(target: string): { path: string; hash: string } {
  const hashIndex = target.indexOf('#');
  const hash = hashIndex === -1 ? '' : target.slice(hashIndex);
  const path = hashIndex === -1 ? target : target.slice(0, hashIndex);
  return { path, hash };
}

function isExternal(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//') || target.startsWith('/');
}

/** Compute a base-relative href from one doc slug to another. */
export function resolveDocRelativeLink(fromSlug: string, toSlug: string): string {
  const target = toSlug === 'index' || toSlug === '' ? '' : `${toSlug}/`;
  if (fromSlug === 'index' || fromSlug === '') {
    return target === '' ? './' : target;
  }
  return target === '' ? '../' : `../${target}`;
}

function extensionOf(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  return base.includes('.') ? (base.split('.').pop() ?? '') : '';
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** Normalize a repository-relative path (resolving `..` segments). */
export function resolveRepoPath(sourcePath: string, relative: string): string {
  const segments = [
    ...sourcePath.split('/').filter((segment) => segment !== '' && segment !== '.'),
    ...relative.split('/').filter((segment) => segment !== '' && segment !== '.'),
  ];
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === '..') {
      out.pop();
    } else {
      out.push(segment);
    }
  }
  return out.join('/');
}

/** Lowercased heading slugs for a markdown document (used for anchor checks). */
export function extractHeadingSlugs(markdown: string): Set<string> {
  const headings = new Set<string>();
  const pattern = /^#{1,6}\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown))) {
    const text = (match[1] ?? '').trim();
    if (text) {
      headings.add(slugifyHeading(text));
    }
  }
  return headings;
}

function slugifyHeading(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_]/g, '')
    .replace(/[^a-z0-9\s-]/gi, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Decide which fragment to keep for a link to a known doc page. A fragment is
 * preserved only when it matches a heading on the target page (case
 * insensitive), so upstream links to anchors that no longer exist degrade
 * gracefully to a link to the page.
 */
function usableHash(hash: string, slug: string, context: DocLinkContext): string {
  const fragment = hash.slice(1).toLowerCase();
  if (!fragment) {
    return '';
  }
  return context.headingSlugs.get(slug)?.has(fragment) ? hash : '';
}

/**
 * Rewrite links and images inside aggregated documentation:
 * - relative `*.md`/`*.mdx` links (and extensionless wiki links) to known pages
 *   become base-relative doc links;
 * - relative links to other source paths become absolute GitHub blob URLs;
 * - relative images are rewritten to the configured absolute `imageBase`.
 */
export function rewriteDocMarkdown(markdown: string, context: DocLinkContext): string {
  const linkPattern = /!?\[([^\][]*(?:\[[^\][]*\][^\][]*)*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  return markdown.replace(linkPattern, (match, label: string, target: string) => {
    const isImage = match.startsWith('!');
    const { path, hash } = stripUrlSuffix(target);
    if (isExternal(path)) {
      return match;
    }
    const extension = extensionOf(path).toLowerCase();
    const baseName = path.split(/[/\\]/).pop() ?? path;
    const candidateSlug = slugifyDocFile(baseName.replace(/\.(md|mdx)$/i, ''));

    if (DOC_EXTENSIONS.has(extension) || context.knownSlugs.has(candidateSlug)) {
      const slug = context.knownSlugs.has(candidateSlug) ? candidateSlug : slugifyDocFile(baseName);
      if (context.knownSlugs.has(slug)) {
        const rendered = isImage ? `![${label}]` : `[${label}]`;
        return `${rendered}(<doclink:${slug}>${usableHash(hash, slug, context)})`;
      }
      const fallback = `https://github.com/${context.repository}/blob/${context.branch}/${resolveRepoPath(context.sourcePath, path)}${hash}`;
      const rendered = isImage ? `![${label}]` : `[${label}]`;
      return `${rendered}(${fallback})`;
    }

    if (IMAGE_EXTENSIONS.has(extension) && isImage) {
      if (context.imageBase) {
        return `![${label}](${context.imageBase}${encodePath(path)}${hash})`;
      }
      return match;
    }

    if (!isImage) {
      // Any other relative link (e.g. `src/src/Foo`, `../README`) is a
      // repository path. Rewrite it to an absolute GitHub blob URL so it is
      // never treated as a broken site-internal link.
      const fallback = `https://github.com/${context.repository}/blob/${context.branch}/${resolveRepoPath(context.sourcePath, path)}${hash}`;
      return `[${label}](${fallback})`;
    }

    return match;
  });
}

/** Replace `<doclink:slug>` placeholders with base-relative doc links. */
export function resolveDoclinks(markdown: string, fromSlug: string): string {
  return markdown.replace(/<doclink:([a-z0-9-]+)>/g, (_, slug: string) =>
    resolveDocRelativeLink(fromSlug, slug),
  );
}
