import type { ResolvedProject } from '../manifest/load';
import type { ReleaseCacheData } from '../releases/types';

import { compareNuGetVersions, formatNuGetVersion } from '../nuget-version';
import {
  effectivePrerelease,
  isPrereleaseRelease,
  isValidVersion,
  normalizePrereleaseVersion,
  selectVersions,
  sortGitHubReleasesDescending,
} from '../releases/normalize';

/**
 * Documentation channels (ADR 0009).
 *
 * A project can publish up to two views of its documentation:
 *
 * - `live` — the latest **non-prerelease** release, i.e. what a reader can
 *   install today. It owns the canonical `/docs/<id>/` URLs.
 * - `prerelease` — the line that has not shipped yet, served at
 *   `/docs/<id>/prerelease/`.
 *
 * Each channel is pinned to a git ref. Because the answer to "is `main` a
 * prerelease?" is not observable offline, the manifest states the intent with
 * ref tokens (`latest-stable`, `latest-prerelease`, `default`) and this module
 * resolves them against the release cache deterministically. A project with no
 * `docs.channels` keeps the historical behaviour: one channel on the default
 * branch, no channel UI.
 */
export const DOC_CHANNELS = ['live', 'prerelease'] as const;

export type DocChannelId = (typeof DOC_CHANNELS)[number];

/** How a resolved channel ref is addressed on GitHub. */
export type DocRefKind = 'branch' | 'tag' | 'sha';

/** What a channel follows when `ref` is omitted. */
export const DEFAULT_CHANNEL_REFS: Record<DocChannelId, string> = {
  live: 'latest-stable',
  prerelease: 'default',
};

/** Human-facing channel names used by the sidebar and the page switcher. */
export const CHANNEL_LABELS: Record<DocChannelId, string> = {
  live: 'Live',
  prerelease: 'Prerelease',
};

export interface ResolvedDocChannel {
  id: DocChannelId;
  /** Git ref the content is read from (`main`, `v2.4.2`, a commit SHA). */
  ref: string;
  refKind: DocRefKind;
  /** Display version when the ref is a version tag (e.g. `3.0.0-prerelease.2`). */
  version: string | null;
  /** Display label: the version when there is one, otherwise the ref itself. */
  label: string;
  /** True for the channel that owns the canonical `/docs/<id>/` URLs. */
  default: boolean;
}

export interface ResolvedDocChannels {
  channels: ResolvedDocChannel[];
  /** Human-readable notes printed by the docs sync (never fatal). */
  warnings: string[];
}

/** The layout fields a channel may override, already merged with the shared block. */
export interface ChannelLayout {
  path: string;
  rootPage?: string;
  readmeAsIndex?: boolean;
  order?: string[];
  exclude?: string[];
}

type RefResolution = Omit<ResolvedDocChannel, 'id' | 'default'>;

function defaultBranch(project: ResolvedProject, data: ReleaseCacheData): string {
  return data.repos[project.repository]?.defaultBranch?.trim() || 'main';
}

/** A release tag turned into a channel source, with its display version. */
function tagRef(ref: string): RefResolution {
  const normalized = normalizePrereleaseVersion(ref);
  const version = isValidVersion(normalized) ? formatNuGetVersion(normalized) : null;
  return { ref, refKind: 'tag', version, label: version ?? ref };
}

function branchRef(branch: string): RefResolution {
  return { ref: branch, refKind: 'branch', version: null, label: branch };
}

/**
 * Resolve one `ref` token to a concrete git ref. Returns null when the token
 * names a release the repository does not have (the caller decides whether to
 * fall back or drop the channel).
 */
export function resolveChannelRef(
  project: ResolvedProject,
  data: ReleaseCacheData,
  token: string,
): RefResolution | null {
  const releases = sortGitHubReleasesDescending(data.releases[project.repository] ?? []);
  switch (token) {
    case 'default':
      return branchRef(defaultBranch(project, data));
    case 'latest-stable': {
      const release = releases.find((candidate) => !isPrereleaseRelease(candidate));
      return release ? tagRef(release.tagName) : null;
    }
    case 'latest-prerelease': {
      const release = releases.find((candidate) => isPrereleaseRelease(candidate));
      return release ? tagRef(release.tagName) : null;
    }
    default: {
      const normalized = normalizePrereleaseVersion(token);
      if (releases.some((release) => normalizePrereleaseVersion(release.tagName) === normalized)) {
        return tagRef(token);
      }
      if (/^[0-9a-f]{7,40}$/i.test(token)) {
        return { ref: token, refKind: 'sha', version: null, label: token.slice(0, 7) };
      }
      return branchRef(token);
    }
  }
}

/**
 * The highest stable and prerelease versions a project has actually published,
 * from GitHub release tags and NuGet package versions together.
 *
 * Both sources matter: a package can ship before its GitHub release exists, and
 * a repository can tag a release whose packages publish later. A prerelease is
 * reported only while it outranks the stable version, so `prerelease === null`
 * means "nothing is in flight ahead of the release".
 */
export interface ProjectReleaseLine {
  stable: string | null;
  prerelease: string | null;
}

export function projectReleaseLine(
  project: ResolvedProject,
  data: ReleaseCacheData,
): ProjectReleaseLine {
  const selection = selectVersions(publishedVersions(project, data));
  return {
    stable: selection.stable,
    prerelease: effectivePrerelease(selection.stable, selection.prerelease),
  };
}

/** Every version the project has published, from GitHub release tags and NuGet indexes. */
function publishedVersions(project: ResolvedProject, data: ReleaseCacheData): string[] {
  const versions: string[] = [];
  for (const release of data.releases[project.repository] ?? []) {
    versions.push(release.tagName);
  }
  for (const pkg of project.packages) {
    versions.push(...(data.packages[pkg.id]?.versions ?? []));
  }
  return versions;
}

export interface PrereleaseChannelGate {
  publish: boolean;
  /** Why the channel is withheld, phrased for the sync log and the catalogue guard. */
  reason?: string;
}

/**
 * Whether the project's prerelease line has been released: no prerelease is
 * published, or the newest stable version is at least as new as it. This is the
 * promotion signal, and it is derived only from published GitHub releases and
 * NuGet versions — never from the manifest — so it needs no human decision.
 */
export function prereleaseLinePromoted(
  project: ResolvedProject,
  data: ReleaseCacheData,
): PrereleaseChannelGate {
  const line = projectReleaseLine(project, data);
  if (line.prerelease !== null) {
    return { publish: true };
  }
  // The line is retired. Distinguish "no prerelease was ever cut" from "the
  // stable release caught up", so the sync log and the catalogue guard explain
  // which one happened.
  const published = selectVersions(publishedVersions(project, data)).prerelease;
  return {
    publish: false,
    reason:
      published === null
        ? 'no prerelease is published'
        : `stable ${line.stable} has caught up with ${published}`,
  };
}

/**
 * Whether a prerelease channel still has anything to say.
 *
 * This is what makes promotion **automatic**: a prerelease channel documents a
 * version ahead of the released one, so as soon as a stable release catches up
 * with it (or passes it) the channel is withheld — no manifest edit, no pull
 * request, just the next deploy. It returns by itself when the project
 * publishes its next prerelease.
 *
 * A branch-based prerelease channel is judged by the newest published
 * prerelease (the branch is the line preparing it); a tag-based one by its own
 * version.
 */
export function prereleaseChannelGate(
  project: ResolvedProject,
  data: ReleaseCacheData,
  channel: { id: DocChannelId; refKind: DocRefKind; version: string | null },
): PrereleaseChannelGate {
  if (channel.id !== 'prerelease') {
    return { publish: true };
  }
  const line = projectReleaseLine(project, data);
  if (channel.refKind === 'tag' && channel.version !== null) {
    if (
      line.stable !== null &&
      compareNuGetVersions(
        normalizePrereleaseVersion(channel.version),
        normalizePrereleaseVersion(line.stable),
      ) <= 0
    ) {
      return {
        publish: false,
        reason: `stable ${line.stable} has caught up with ${channel.version}`,
      };
    }
    return { publish: true };
  }
  return prereleaseLinePromoted(project, data);
}

/**
 * Resolve a project's declared channels. Guarantees:
 *
 * - at least one channel, with exactly one marked `default` (`live` wins, else
 *   the only declared channel — a prerelease-only project serves its docs at
 *   the canonical `/docs/<id>/` URLs);
 * - `live` falls back to the default branch when the repository has no stable
 *   release, so a project is never left without documentation;
 * - `prerelease` is dropped when there is no matching release, when it
 *   duplicates another channel's ref, or when a stable release has caught up
 *   with it (automatic promotion);
 * - if every declared channel is dropped, the project falls back to one live
 *   channel on the default branch rather than losing its documentation.
 */
export function resolveDocChannels(
  project: ResolvedProject,
  data: ReleaseCacheData,
): ResolvedDocChannels {
  const warnings: string[] = [];
  const config = project.docs;
  if (!config) {
    return { channels: [], warnings };
  }

  const branch = defaultBranch(project, data);
  // Wiki and README sources have a single version; the schema rejects
  // `channels` on them, so only `github-path` can reach the multi-channel path.
  const declared = config.source === 'github-path' ? config.channels : undefined;
  if (!declared) {
    return { channels: [{ id: 'live', ...branchRef(branch), default: true }], warnings };
  }

  const resolved: ResolvedDocChannel[] = [];
  for (const id of DOC_CHANNELS) {
    if (declared[id] === undefined) {
      continue;
    }
    const token = declared[id]?.ref?.trim() || DEFAULT_CHANNEL_REFS[id];
    const resolution = resolveChannelRef(project, data, token);
    if (resolution) {
      resolved.push({ id, ...resolution, default: false });
      continue;
    }
    if (id === 'live') {
      warnings.push(
        `live documentation is pinned to "${token}" but the repository has no such release; following "${branch}" instead.`,
      );
      resolved.push({ id, ...branchRef(branch), default: false });
      continue;
    }
    warnings.push(
      `prerelease documentation is pinned to "${token}" but the repository has no such release; the channel was skipped.`,
    );
  }

  const seen = new Map<string, DocChannelId>();
  const deduped: ResolvedDocChannel[] = [];
  for (const channel of resolved) {
    const existing = seen.get(channel.ref);
    if (existing !== undefined) {
      warnings.push(
        `"${channel.id}" and "${existing}" both resolve to "${channel.ref}"; "${channel.id}" was skipped because it would duplicate the other channel. This resolves itself; no manifest change is needed.`,
      );
      continue;
    }
    seen.set(channel.ref, channel.id);
    deduped.push(channel);
  }

  // Automatic promotion: withhold a prerelease channel whose line has been
  // released. The declaration stays in the manifest so the channel returns by
  // itself with the next prerelease — a deploy needs no reviewable data edit.
  const published: ResolvedDocChannel[] = [];
  for (const channel of deduped) {
    const gate = prereleaseChannelGate(project, data, channel);
    if (!gate.publish) {
      warnings.push(
        `prerelease documentation is not published: ${gate.reason}. The channel returns automatically with the next prerelease release.`,
      );
      continue;
    }
    published.push(channel);
  }

  const defaultChannel = published.find((channel) => channel.id === 'live') ?? published[0];
  if (!defaultChannel) {
    // Every declared channel was dropped (nothing published yet, or the
    // prerelease line was promoted). A documented project must still publish
    // something, so it falls back to the default branch.
    warnings.push('every declared channel was skipped; following the default branch instead.');
    return {
      channels: [{ id: 'live', ...branchRef(branch), default: true }],
      warnings,
    };
  }
  return {
    channels: published.map((channel) => ({
      id: channel.id,
      ref: channel.ref,
      refKind: channel.refKind,
      version: channel.version,
      label: channel.label,
      default: channel === defaultChannel,
    })),
    warnings,
  };
}

/**
 * The layout a channel aggregates with: the shared `docs` block, with any
 * per-channel overrides applied. Channels may override the layout because a
 * release tag's documentation tree can differ from the default branch.
 */
export function channelLayout(
  project: ResolvedProject,
  channel: ResolvedDocChannel,
): ChannelLayout | null {
  const config = project.docs;
  if (!config) {
    return null;
  }
  if (config.source !== 'github-path') {
    return config.source === 'wiki'
      ? {
          path: '',
          rootPage: config.rootPage,
          readmeAsIndex: config.readmeAsIndex,
          order: config.order,
          exclude: config.exclude,
        }
      : { path: '' };
  }
  const override = channel.default ? undefined : config.channels?.[channel.id];
  return {
    path: override?.path ?? config.path,
    rootPage: override?.rootPage ?? config.rootPage,
    readmeAsIndex: override?.readmeAsIndex ?? config.readmeAsIndex,
    order: override?.order ?? config.order,
    exclude: override?.exclude ?? config.exclude,
  };
}

/**
 * The date a pinned release was published (`YYYY-MM-DD`), used as the
 * `lastReviewed` value for tag-based channels: a tagged page does not change,
 * so its review date is the release date rather than the branch's commit feed.
 */
export function releaseDateForRef(
  project: ResolvedProject,
  data: ReleaseCacheData,
  ref: string,
): string | null {
  const normalized = normalizePrereleaseVersion(ref);
  const release = (data.releases[project.repository] ?? []).find(
    (candidate) => normalizePrereleaseVersion(candidate.tagName) === normalized,
  );
  return release?.publishedAt?.slice(0, 10) ?? null;
}

/** `Live v2.4.2` / `Prerelease main`, used by the sidebar and page switcher. */
export function channelDisplayLabel(channel: { id: DocChannelId; label: string }): string {
  return `${CHANNEL_LABELS[channel.id]} ${channel.label}`;
}

/** URL path for a channel's landing page: `/docs/<id>/` or `/docs/<id>/<channel>/`. */
export function channelBasePath(
  projectId: string,
  channelId: DocChannelId,
  isDefault: boolean,
): string {
  return isDefault ? `/docs/${projectId}/` : `/docs/${projectId}/${channelId}/`;
}
