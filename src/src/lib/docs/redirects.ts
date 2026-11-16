import type { ResolvedProject } from '../manifest/load';
import type { DocsManifest } from './aggregate';

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { absoluteUrl, withBase } from '../urls';
import { defaultDocsChannel } from './aggregate';
import { DOC_CHANNELS } from './channels';

/**
 * Redirects that keep retired documentation-channel URLs working (ADR 0009).
 *
 * A channel is *retired* when the manifest still declares it but the sync
 * withheld it — which happens automatically the moment a stable release catches
 * up with the prerelease line. purview.dev is served from GitHub Pages, which
 * only serves files, so each retired URL becomes a meta-refresh page pointing at
 * the live equivalent instead of a 404 for readers following a bookmark or an
 * old link.
 *
 * The set is derived from the live channel's own pages rather than a history
 * file: after promotion the pages that survive carry the same slugs as their
 * live counterparts, so this covers every URL that still has a destination
 * without persisting generated state between builds.
 */
export interface DocChannelRedirect {
  /** Site path that no longer resolves, e.g. `/docs/zodsharp/prerelease/core-concepts/`. */
  from: string;
  /** Live site path it now belongs to. */
  to: string;
  /** Page title; defaults to the documentation wording. */
  title?: string;
  /** Plain-text explanation shown above the link. */
  message?: string;
}

/**
 * Pages that moved and must not 404 (ADR 0010).
 *
 * `/skills/` was a site-wide list of every project's skills, shown away from
 * the project that authors them. Each project page now owns its skills, so the
 * old entry point forwards to the catalogue where those pages live.
 */
export const RETIRED_PAGE_REDIRECTS: readonly DocChannelRedirect[] = [
  {
    from: '/skills/',
    to: '/projects/',
    title: 'Skills moved to the project pages…',
    message: 'Agent skills are now listed on the project that authors them.',
  },
];

/** Schema-relative file path for a redirect target directory (`/a/b/` → `a/b/index.html`). */
export function redirectFilePath(redirect: DocChannelRedirect): string {
  return join(...redirect.from.split('/').filter(Boolean), 'index.html');
}

/**
 * URLs of every declared-but-withheld channel, mapped to the live page that now
 * carries the same content. Projects without channels, archived projects, and
 * channels that are currently published produce no redirects.
 *
 * Two kinds of URL are retired, because a retired channel is not synced at all:
 *
 * - every slug the live channel publishes, forwarded slug-for-slug (`R/T` → `L/T`);
 * - every slug the project declared as moved (`docs.redirects`), whose flat
 *   address only ever existed in the retired channel, forwarded to the live
 *   channel's new address (`R/F` → `L/T`). The live channel has no such page to
 *   copy the slug from, so the declared map is the only record that the old
 *   address ever resolved to that content.
 *
 * A moved pair whose old slug is still a live page is skipped: that URL is a real
 * page on the canonical channel, so its own slug is the honest destination.
 */
export function retiredChannelRedirects(
  projects: readonly ResolvedProject[],
  manifest: DocsManifest | null,
): DocChannelRedirect[] {
  const redirects: DocChannelRedirect[] = [];
  for (const project of projects) {
    if (!project.docs || project.status === 'archived') {
      continue;
    }
    const declared = project.docs.source === 'github-path' ? project.docs.channels : undefined;
    if (!declared) {
      continue;
    }
    const entry = manifest?.projects.find((candidate) => candidate.projectId === project.id);
    const live = defaultDocsChannel(entry);
    if (!live) {
      continue;
    }
    const published = new Set((entry?.channels ?? []).map((channel) => channel.id));
    const liveSlugs = new Set(live.pages.map((page) => page.slug));
    const moved = project.docs.source === 'github-path' ? (project.docs.redirects ?? {}) : {};
    for (const channelId of DOC_CHANNELS) {
      if (declared[channelId] === undefined || published.has(channelId)) {
        continue;
      }
      const emitted = new Set<string>();
      const push = (from: string, to: string) => {
        if (emitted.has(from)) {
          return;
        }
        emitted.add(from);
        redirects.push({ from, to });
      };
      for (const page of live.pages) {
        push(
          page.slug === 'index'
            ? `/docs/${project.id}/${channelId}/`
            : `/docs/${project.id}/${channelId}/${page.slug}/`,
          page.slug === 'index' ? `/docs/${project.id}/` : `/docs/${project.id}/${page.slug}/`,
        );
      }
      for (const [from, to] of Object.entries(moved)) {
        if (!liveSlugs.has(to) || liveSlugs.has(from)) {
          continue;
        }
        push(`/docs/${project.id}/${channelId}/${from}/`, `/docs/${project.id}/${to}/`);
      }
    }
  }
  return redirects;
}

/**
 * URLs a project declared it moved (`docs.redirects`), mapped to their new home.
 *
 * Unlike retired channels, a moved page has no derivable destination: the old slug
 * and the new one share nothing, so the mapping is declared in the project
 * catalogue. `writeStaticRedirect` never overwrites a file, which is what makes
 * the declaration timing-safe - while the `live` channel still reads an older tag,
 * the old slug is a real page and the redirect is simply not written.
 *
 * Every channel this build publishes owns URLs of its own, so a move is forwarded
 * from each published base: the default channel at `/docs/<id>/` and, when the
 * project publishes it, the prerelease one at `/docs/<id>/prerelease/`. A tree can
 * be reorganised on the default branch long before the release that carries it is
 * promoted, and the readers on the prerelease channel are following URLs that
 * change at the same moment. A declared-but-withheld channel is deliberately not a
 * base: it publishes nothing in this build, so its retired addresses belong to
 * `retiredChannelRedirects`, which forwards them to the live page (and, for a slug
 * that only ever lived in the retired channel, to the live channel's new address).
 *
 * A repository may also record its own moves in `_redirects.yml` (ADR 0013).
 * That file is read at each channel's ref, so its pairs apply to that channel's
 * base only — the prerelease tree can move before the live one does. When the
 * catalogue and the file both name the same old slug, the catalogue wins: it is
 * the reviewed record on this side.
 */
export function docsPageRedirects(
  projects: readonly ResolvedProject[],
  manifest?: DocsManifest | null,
): DocChannelRedirect[] {
  const redirects: DocChannelRedirect[] = [];
  const seen = new Set<string>();
  const add = (base: string, from: string, to: string) => {
    const redirect = {
      from: pagePath(base, from),
      to: pagePath(base, to),
      title: 'This documentation page moved…',
      message: 'The page now lives at its new address.',
    };
    if (!seen.has(redirect.from)) {
      seen.add(redirect.from);
      redirects.push(redirect);
    }
  };
  for (const project of projects) {
    if (!project.docs || project.docs.source === 'readme' || project.status === 'archived') {
      continue;
    }
    const entry = manifest?.projects.find((candidate) => candidate.projectId === project.id);
    if (project.docs.source === 'github-path') {
      const moved = project.docs.redirects ?? {};
      const bases = publishedBases(project.id, entry);
      for (const [from, to] of Object.entries(moved)) {
        for (const base of bases) {
          add(base, from, to);
        }
      }
    }
    for (const channel of entry?.channels ?? []) {
      const base = channel.default ? `/docs/${project.id}` : `/docs/${project.id}/${channel.id}`;
      for (const [from, to] of Object.entries(channel.redirects ?? {})) {
        add(base, from, to);
      }
    }
  }
  return redirects;
}

/**
 * The site bases a project publishes in this build: its canonical
 * `/docs/<id>/` base, plus one per extra published channel.
 *
 * Without a docs manifest the build cannot tell which channels survived the
 * release gate, so only the canonical base is assumed: the writer's guards still
 * refuse to shadow a real page or forward into a 404.
 */
function publishedBases(
  projectId: string,
  entry: DocsManifest['projects'][number] | undefined,
): string[] {
  const canonical = `/docs/${projectId}`;
  if (!entry || entry.channels.length === 0) {
    return [canonical];
  }
  return entry.channels.map((channel) =>
    channel.default ? canonical : `${canonical}/${channel.id}`,
  );
}

/** Site path of a page slug under a docs base; `index` is the base itself. */
function pagePath(base: string, slug: string): string {
  return slug === 'index' ? `${base}/` : `${base}/${slug.replace(/\/index$/, '')}/`;
}

/**
 * Write the moved-page redirects into a built site. Returns the paths written, relative to `dist`.
 *
 * A redirect is written only when its destination is published *and* its source is not:
 *
 * - the source check is `writeStaticRedirect`'s - a real page owns its URL, so a redirect never shadows one;
 * - the destination check is this function's. A project that nests its pages changes every slug at once, but the
 *   default channel keeps reading the last release tag until the next release is promoted (ADR 0009), so the new
 *   address can be unpublished while the declaration is already in source. Forwarding a reader into a 404 is worse
 *   than leaving the old URL alone, and the post-build link crawl says so - which is how this was found.
 */
export function writeDocsPageRedirects(
  dist: string,
  projects: readonly ResolvedProject[],
  manifest?: DocsManifest | null,
): string[] {
  const written: string[] = [];
  for (const redirect of docsPageRedirects(projects, manifest)) {
    if (!isPublished(dist, redirect.to)) {
      continue;
    }
    const relative = writeStaticRedirect(dist, redirect);
    if (relative) {
      written.push(relative);
    }
  }
  return written;
}

/** Whether a site path was written by the build as a page (`/a/b/` → `a/b/index.html`). */
function isPublished(dist: string, path: string): boolean {
  return existsSync(join(dist, ...path.split('/').filter(Boolean), 'index.html'));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A static redirect page: meta refresh for the reader, `canonical` for search
 * engines, `noindex` so the redirect itself is never indexed, and
 * `data-pagefind-ignore` so it never becomes a search result.
 */
export function renderChannelRedirect(redirect: DocChannelRedirect): string {
  const href = escapeHtml(withBase(redirect.to));
  const canonical = escapeHtml(absoluteUrl(redirect.to));
  const title = escapeHtml(redirect.title ?? 'Redirecting to the live documentation…');
  const message = escapeHtml(
    redirect.message ?? 'This page documented a prerelease that has since been released.',
  );
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="noindex, follow" />
    <meta http-equiv="refresh" content="0; url=${href}" />
  </head>
  <body data-pagefind-ignore>
    <p>
      ${message}
      Continue to <a href="${href}">${href}</a>.
    </p>
  </body>
</html>
`;
}

/**
 * Write one redirect page. Existing files are never overwritten: a real page
 * owns its URL, and a redirect must never shadow it. Returns the path written,
 * relative to `dist`, or null when nothing was written.
 */
export function writeStaticRedirect(dist: string, redirect: DocChannelRedirect): string | null {
  const relative = redirectFilePath(redirect);
  const target = join(dist, relative);
  if (existsSync(target)) {
    return null;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, renderChannelRedirect(redirect), 'utf8');
  return relative;
}

/**
 * Write the retired-channel redirect pages into a built site. Returns the paths
 * written, relative to `dist`.
 */
export function writeRetiredChannelRedirects(
  dist: string,
  projects: readonly ResolvedProject[],
  manifest: DocsManifest | null,
): string[] {
  const written: string[] = [];
  for (const redirect of retiredChannelRedirects(projects, manifest)) {
    const relative = writeStaticRedirect(dist, redirect);
    if (relative) {
      written.push(relative);
    }
  }
  return written;
}

/** Write the pages that moved to a new home (see `RETIRED_PAGE_REDIRECTS`). */
export function writeRetiredPageRedirects(
  dist: string,
  redirects: readonly DocChannelRedirect[] = RETIRED_PAGE_REDIRECTS,
): string[] {
  const written: string[] = [];
  for (const redirect of redirects) {
    const relative = writeStaticRedirect(dist, redirect);
    if (relative) {
      written.push(relative);
    }
  }
  return written;
}
