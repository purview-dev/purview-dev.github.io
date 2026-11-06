import { posix } from 'node:path';

/**
 * Deterministic transforms applied to aggregated documentation so the source
 * markdown renders correctly inside Starlight and never leaks build paths.
 */

const DOC_EXTENSIONS = new Set(['md', 'mdx']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif']);

/** Reduce one path segment to lower-case letters, digits and dashes, with no leading or trailing dash. */
function reduceSegment(segment: string): string {
  return segment
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/** Slugify a wiki/doc file name into a Starlight route slug. */
export function slugifyDocFile(fileName: string): string {
  const parts = fileName.split('.');
  const base = parts.length > 1 ? parts.slice(0, -1).join('.') : fileName;
  return reduceSegment(base);
}

/**
 * Slug for a page from its path relative to the docs root.
 *
 * A flat corpus (`Getting-Started.md`) keeps the single-segment slug it always
 * had, so no published URL moves. A page in a topic folder keeps the folder as a
 * path segment (`schemas/Custom-Rules.md` → `schemas/custom-rules`), so the
 * published URL mirrors the source tree and the reader can tell where a page
 * lives from its address. Each segment is slugified independently, which is why
 * the folder survives instead of being folded into the file name.
 *
 * Folders are therefore supported without restriction, including names that would
 * need encoding in an address (`Topic Folder`, `Q&A`, `v2.guides`): every segment
 * is reduced to lower-case ASCII letters, digits and inner dashes, and only the
 * file's own `.md`/`.mdx` extension is dropped. `isUrlSafeDocSlug` is the contract
 * a slug has to satisfy before it is published.
 *
 * A nested `README.md` is its folder's index page, the way GitHub renders it, so
 * `guide/README.md` publishes at the folder's own address (`guide/index`). The
 * docs root's own README keeps the `readme` slug, because root selection maps it
 * to the project landing page (`index`).
 */
export function docSlug(relativePath: string): string {
  const segments = relativePath
    .split(/[/\\]/)
    .filter((segment) => segment !== '' && segment !== '.');
  return segments
    .map((segment, index) => {
      if (index < segments.length - 1) {
        return reduceSegment(segment);
      }
      const fileName = segment.replace(/\.(md|mdx)$/i, '');
      return segments.length > 1 && fileName.toLowerCase() === 'readme'
        ? 'index'
        : reduceSegment(fileName);
    })
    .join('/');
}

/** A slug segment as this sync publishes it: no character needs percent-encoding. */
const URL_SAFE_SEGMENT = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Whether a page slug can be used in a published URL verbatim.
 *
 * Every `/`-separated segment must be non-empty and made of lower-case ASCII
 * letters, digits and inner dashes only, so a folder can be nested as deeply as a
 * project likes without any address needing percent-encoding. A path whose folder
 * or file name reduces to nothing (`___/Page.md`) produces an empty segment, which
 * is the case this rejects.
 */
export function isUrlSafeDocSlug(slug: string): boolean {
  return slug !== '' && slug.split('/').every((segment) => URL_SAFE_SEGMENT.test(segment));
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
  /**
   * Source path of the page being rewritten, relative to the docs root
   * (`schemas/Custom-Rules.md`), so relative links resolve against the page they
   * appear on rather than against the docs root.
   */
  pagePath?: string;
  /** Absolute base URL for relative image references, or null to leave them relative. */
  imageBase: string | null;
  /** Lowercased heading slugs per page slug, used to validate link fragments. */
  headingSlugs: Map<string, Set<string>>;
  /** Source-file slugs that render at a different project-relative slug. */
  slugAliases?: Map<string, string>;
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

/**
 * Compute a base-relative href from one doc slug to another.
 *
 * A slug is also the page's URL directory (`schemas/custom-rules` is served at
 * `/docs/<project>/schemas/custom-rules/`), so the number of `..` hops depends on
 * how deep the page is: a page in a folder reaches a sibling folder with `../../`,
 * while a flat corpus keeps the single `../` it always had. An `index` page is
 * its own directory, which is why it is trimmed before the comparison.
 */
export function resolveDocRelativeLink(fromSlug: string, toSlug: string): string {
  const relative = posix.relative(pageDirectory(fromSlug), pageDirectory(toSlug));
  return relative === '' || relative === '.' ? './' : `${relative}/`;
}

/** The URL directory a page slug occupies: the slug itself, except for an `index` page. */
function pageDirectory(slug: string): string {
  if (slug === '' || slug === 'index') {
    return '.';
  }
  return slug.endsWith('/index') ? slug.slice(0, -'/index'.length) || '.' : slug;
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

/** The directory part of a `/`-separated path (`schemas/Foo.md` → `schemas`). */
function directoryOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
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
  markdown = markdown.replace(/!\[\s*\]\(([^)\s]+)/g, (_match, target: string) => {
    const file = stripUrlSuffix(target).path.split('/').pop() ?? '';
    const alt = decodeURIComponent(file.replace(/\.[a-z0-9]+$/i, ''))
      .replace(/[-_.]+/g, ' ')
      .trim();
    return `![${alt || 'Image'}](${target}`;
  });
  const linkPattern = /!?\[([^\][]*(?:\[[^\][]*\][^\][]*)*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  return markdown.replace(linkPattern, (match, label: string, target: string) => {
    const isImage = match.startsWith('!');
    const { path, hash } = stripUrlSuffix(target);
    if (isExternal(path)) {
      return match;
    }
    const extension = extensionOf(path).toLowerCase();
    const baseName = path.split(/[/\\]/).pop() ?? path;
    // A link resolves against the page it appears on, exactly as it does on
    // GitHub: a page in `schemas/` names a sibling by file name and anything else
    // by its path from there (`../concepts/Core-Concepts.md`). A bare file name
    // also still resolves by name, so a flat corpus keeps working unchanged.
    const pageDir = context.pagePath
      ? directoryOf(resolveRepoPath(context.sourcePath, context.pagePath))
      : context.sourcePath;
    const linkPath = resolveRepoPath(pageDir, path);
    const docRelativePath = linkPath.startsWith(`${context.sourcePath}/`)
      ? linkPath.slice(context.sourcePath.length + 1)
      : linkPath;
    const candidates = path.includes('/')
      ? [docSlug(docRelativePath)]
      : [docSlug(docRelativePath), slugifyDocFile(baseName.replace(/\.(md|mdx)$/i, ''))];
    const matched = candidates.find(
      (candidate) => context.knownSlugs.has(candidate) || context.slugAliases?.has(candidate),
    );

    if (DOC_EXTENSIONS.has(extension) || matched !== undefined) {
      const slug =
        matched === undefined
          ? (candidates[0] ?? '')
          : (context.slugAliases?.get(matched) ?? matched);
      if (context.knownSlugs.has(slug)) {
        const rendered = isImage ? `![${label}]` : `[${label}]`;
        return `${rendered}(<doclink:${slug}>${usableHash(hash, slug, context)})`;
      }
      const fallback = `https://github.com/${context.repository}/blob/${context.branch}/${linkPath}${hash}`;
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
      const fallback = `https://github.com/${context.repository}/blob/${context.branch}/${linkPath}${hash}`;
      return `[${label}](${fallback})`;
    }

    return match;
  });
}

/** Replace `<doclink:slug>` placeholders with base-relative doc links. */
export function resolveDoclinks(markdown: string, fromSlug: string): string {
  // Slugs may carry folder segments (`schemas/custom-rules`), so the placeholder accepts `/` as well.
  return markdown.replace(/<doclink:([a-z0-9/-]+)>/g, (_, slug: string) =>
    resolveDocRelativeLink(fromSlug, slug),
  );
}
