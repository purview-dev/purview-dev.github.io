import { parse } from 'yaml';

import { docSlug, isUrlSafeDocSlug } from './links';

/**
 * A repository's own record of the documentation pages it moved (ADR 0013).
 *
 * The catalogue's `docs.redirects` works, but it puts the knowledge of a move in
 * a second repository: whoever reorganises the docs tree has to open a pull
 * request here as well. `_redirects.yml` in the docs root lets the move and its
 * redirect land in the same commit. It is read at each channel's own ref, so a
 * tree reorganised on the default branch forwards the prerelease channel's URLs
 * without touching the live ones until the release that carries it is promoted.
 *
 * ```yaml
 * # previous: current — slugs, or paths from the docs root
 * redirects:
 *   getting-started: guide/getting-started
 *   Custom-Rules.md: schemas/Custom-Rules.md
 * ```
 *
 * A bare map (without the `redirects:` key) is accepted too. Each side may be a
 * slug or a Markdown path from the docs root; both are reduced to the slug the
 * page publishes at, exactly as the page itself is.
 */
export const REDIRECTS_FILE = '_redirects.yml';

export interface RedirectFileResult {
  redirects: Record<string, string>;
  /** Problems that make the file unusable; the caller decides how loudly to fail. */
  errors: string[];
}

/** Reduce one side of a pair to the slug it publishes at. */
function toSlug(value: string): string {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  return docSlug(/\.(md|mdx)$/i.test(trimmed) ? trimmed : `${trimmed}.md`);
}

export function parseRedirectFile(source: string): RedirectFileResult {
  let parsed: unknown;
  try {
    parsed = parse(source);
  } catch (error) {
    return {
      redirects: {},
      errors: [`not valid YAML: ${(error as Error).message.split('\n')[0]}`],
    };
  }
  if (parsed === null || parsed === undefined) {
    return { redirects: {}, errors: [] };
  }
  const root =
    typeof parsed === 'object' && !Array.isArray(parsed) && 'redirects' in parsed
      ? (parsed as { redirects: unknown }).redirects
      : parsed;
  if (root === null || root === undefined) {
    return { redirects: {}, errors: [] };
  }
  if (typeof root !== 'object' || Array.isArray(root)) {
    return { redirects: {}, errors: ['must be a map of `previous: current` pairs'] };
  }

  const redirects: Record<string, string> = {};
  const errors: string[] = [];
  for (const [rawFrom, rawTo] of Object.entries(root as Record<string, unknown>)) {
    if (typeof rawTo !== 'string' || rawTo.trim() === '') {
      errors.push(`"${rawFrom}" must map to a page slug or path`);
      continue;
    }
    const from = toSlug(rawFrom);
    const to = toSlug(rawTo);
    if (!isUrlSafeDocSlug(from) || !isUrlSafeDocSlug(to)) {
      errors.push(`"${rawFrom}: ${rawTo}" does not reduce to publishable slugs`);
      continue;
    }
    if (from === to) {
      errors.push(`"${rawFrom}" redirects to itself`);
      continue;
    }
    redirects[from] = to;
  }
  return { redirects, errors };
}
