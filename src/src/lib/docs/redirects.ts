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
}

/** Schema-relative file path for a redirect target directory (`/a/b/` → `a/b/index.html`). */
export function redirectFilePath(redirect: DocChannelRedirect): string {
  return join(...redirect.from.split('/').filter(Boolean), 'index.html');
}

/**
 * URLs of every declared-but-withheld channel, mapped to the live page with the
 * same slug. Projects without channels, archived projects, and channels that are
 * currently published produce no redirects.
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
    for (const channelId of DOC_CHANNELS) {
      if (declared[channelId] === undefined || published.has(channelId)) {
        continue;
      }
      for (const page of live.pages) {
        redirects.push({
          from:
            page.slug === 'index'
              ? `/docs/${project.id}/${channelId}/`
              : `/docs/${project.id}/${channelId}/${page.slug}/`,
          to: page.slug === 'index' ? `/docs/${project.id}/` : `/docs/${project.id}/${page.slug}/`,
        });
      }
    }
  }
  return redirects;
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
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Redirecting to the live documentation…</title>
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="noindex, follow" />
    <meta http-equiv="refresh" content="0; url=${href}" />
  </head>
  <body data-pagefind-ignore>
    <p>
      This page documented a prerelease that has since been released.
      Continue to <a href="${href}">${href}</a>.
    </p>
  </body>
</html>
`;
}

/**
 * Write the retired-channel redirect pages into a built site. Existing files are
 * never overwritten: a published channel owns its URLs, and a redirect must not
 * shadow a real page. Returns the paths written, relative to `dist`.
 */
export function writeRetiredChannelRedirects(
  dist: string,
  projects: readonly ResolvedProject[],
  manifest: DocsManifest | null,
): string[] {
  const written: string[] = [];
  for (const redirect of retiredChannelRedirects(projects, manifest)) {
    const relative = redirectFilePath(redirect);
    const target = join(dist, relative);
    if (existsSync(target)) {
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, renderChannelRedirect(redirect), 'utf8');
    written.push(relative);
  }
  return written;
}
