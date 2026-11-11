import type { PackageRegistry } from '~/lib/manifest/schema';

import { useEffect, useMemo, useState } from 'preact/hooks';

import {
  isStale,
  latestFromVersions,
  livePackageKey,
  mergeVersionPair,
  readLiveVersions,
  refreshLiveVersions,
  rollupPackageVersions,
  versionStatusMessage,
  type LivePackageRef,
  type LiveVersions,
  type PackageVersionPair,
} from '~/lib/releases/live';
import { DISPLAY_STATUS_LABELS, type DisplayStatus } from '~/lib/status';

/**
 * The releases page quick view: one card per project, rolled up from its packages
 * and re-checked against NuGet/npm in the browser (ADR 0008, ADR 0012). It is the
 * single-page overview of the whole catalogue, so a reader can see what is
 * current without opening each project.
 */

/** A package behind a project row, as the browser needs it to recompute live. */
export interface ReleaseOverviewPackage {
  id: string;
  registry: PackageRegistry;
  stable: string | null;
  prerelease: string | null;
}

/** One project's build-time snapshot; the browser recomputes the rollup from `packages`. */
export interface ReleaseOverviewRow {
  projectId: string;
  projectName: string;
  projectUrl: string;
  docsUrl: string | null;
  repositoryUrl: string;
  status: DisplayStatus;
  category: string;
  packageCount: number;
  skillCount: number;
  packages: ReleaseOverviewPackage[];
  latestRelease: {
    tagName: string;
    url: string;
    publishedAt: string | null;
  } | null;
  downloads: number | null;
  downloadsPeriod: 'total' | 'weekly';
  tags: string[];
}

interface Props {
  rows: ReleaseOverviewRow[];
}

type RefreshStatus = 'idle' | 'checking' | 'live' | 'stored' | 'unavailable';

function formatDate(value: string | null): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDownloads(value: number | null, period: 'total' | 'weekly'): string | null {
  if (value == null) {
    return null;
  }
  return period === 'weekly'
    ? `${value.toLocaleString('en-US')}/wk`
    : value.toLocaleString('en-US');
}

export default function ReleaseOverview({ rows }: Props) {
  const [search, setSearch] = useState('');
  const [live, setLive] = useState<LiveVersions | null>(null);
  const [status, setStatus] = useState<RefreshStatus>('idle');

  const packageRefs = useMemo<LivePackageRef[]>(
    () =>
      rows.flatMap((row) => row.packages.map((pkg) => ({ id: pkg.id, registry: pkg.registry }))),
    [rows],
  );

  // The build-time snapshot renders first; on mount the stored copy is applied
  // instantly and the registries are re-checked only when the stored copy is
  // missing or older than the TTL (ADR 0008, ADR 0012).
  useEffect(() => {
    let cancelled = false;
    const stored = readLiveVersions();
    if (stored) {
      setLive(stored);
      setStatus('stored');
    }
    if (stored && !isStale(stored)) {
      return () => {
        cancelled = true;
      };
    }
    setStatus('checking');
    void refreshLiveVersions(packageRefs, stored).then((refreshed) => {
      if (cancelled) {
        return;
      }
      if (refreshed) {
        setLive(refreshed);
        setStatus('live');
      } else {
        setStatus(stored ? 'stored' : 'unavailable');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [packageRefs]);

  // Recompute each project's rollup from the package-level versions, so a newer
  // version of any package moves the project's stable/prerelease badges. A live
  // version never downgrades a build-time one (`mergeVersionPair`).
  const resolved = useMemo(() => {
    if (!live) {
      return rows.map((row) => ({ row, rollup: rollupPackageVersions(row.packages) }));
    }
    return rows.map((row) => {
      const pairs: PackageVersionPair[] = row.packages.map((pkg) => {
        const current = { stable: pkg.stable, prerelease: pkg.prerelease };
        const versions = live.versions[livePackageKey({ id: pkg.id, registry: pkg.registry })];
        return versions ? mergeVersionPair(current, latestFromVersions(versions)) : current;
      });
      return { row, rollup: rollupPackageVersions(pairs) };
    });
  }, [rows, live]);

  const query = search.trim().toLowerCase();
  const visible = resolved.filter(
    ({ row }) =>
      query === '' ||
      row.projectName.toLowerCase().includes(query) ||
      row.category.toLowerCase().includes(query) ||
      row.tags.some((tag) => tag.toLowerCase().includes(query)),
  );
  const currentCount = visible.filter(
    ({ rollup }) => rollup.stableVersion !== null || rollup.prereleaseVersion !== null,
  ).length;

  return (
    <div>
      <div class="flex flex-wrap items-center gap-3">
        <label
          class="border-border bg-surface flex min-w-56 flex-1 items-center gap-2 rounded-md border px-3 py-2"
          htmlFor="release-overview-search"
        >
          <span class="sr-only">Search projects</span>
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path stroke-linecap="round" d="m20 20-3.5-3.5" />
          </svg>
          <input
            id="release-overview-search"
            type="search"
            value={search}
            onInput={(event) => setSearch((event.target as HTMLInputElement).value)}
            placeholder="Search projects…"
            class="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <p class="text-muted text-sm" aria-live="polite">
          {currentCount} of {visible.length} project{visible.length === 1 ? '' : 's'} publishing a
          version
        </p>
      </div>

      <div class="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map(({ row, rollup }) => {
          const downloads = formatDownloads(row.downloads, row.downloadsPeriod);
          return (
            <article
              key={row.projectId}
              class="pv-card flex flex-col gap-3 p-5"
              data-release-overview={row.projectId}
            >
              <div class="flex items-start justify-between gap-3">
                <a
                  href={row.projectUrl}
                  class="text-foreground text-lg leading-snug font-semibold no-underline hover:underline"
                >
                  {row.projectName}
                </a>
                <span class={['pv-chip shrink-0', `pv-status-${row.status}`].join(' ')}>
                  {DISPLAY_STATUS_LABELS[row.status]}
                </span>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="pv-version-badge"
                  data-tone="stable"
                  data-version={rollup.stableVersion ?? ''}
                  title="Highest stable version across the project's packages"
                >
                  {rollup.stableVersion ?? '—'}
                </span>
                <span
                  class="pv-version-badge"
                  data-tone="prerelease"
                  data-version={rollup.prereleaseVersion ?? ''}
                  title="Highest prerelease that outranks the stable release"
                >
                  {rollup.prereleaseVersion ?? '—'}
                </span>
                {row.latestRelease && (
                  <a
                    href={row.latestRelease.url}
                    rel="noopener noreferrer"
                    target="_blank"
                    class="pv-link font-mono text-xs whitespace-nowrap"
                  >
                    {row.latestRelease.tagName}
                  </a>
                )}
              </div>

              <p class="text-muted text-xs">
                {row.latestRelease?.publishedAt ? (
                  <time datetime={row.latestRelease.publishedAt}>
                    Released {formatDate(row.latestRelease.publishedAt)}
                  </time>
                ) : (
                  'No GitHub release yet'
                )}
                <span aria-hidden="true"> · </span>
                {row.packageCount === 0 ? (
                  <span>No packages published yet</span>
                ) : rollup.laggingPackageCount > 0 ? (
                  <span title="Packages that trail the project's headline version">
                    {rollup.laggingPackageCount} of {row.packageCount} packages behind
                  </span>
                ) : (
                  <span>
                    {row.packageCount} package{row.packageCount === 1 ? '' : 's'} in step
                  </span>
                )}
              </p>

              <div class="mt-auto flex flex-wrap items-center gap-2 pt-1">
                <span class="pv-chip">{row.category}</span>
                {row.skillCount > 0 && (
                  <span class="pv-chip">
                    {row.skillCount} skill{row.skillCount === 1 ? '' : 's'}
                  </span>
                )}
                {downloads && (
                  <span class="pv-chip" title="Downloads reported by the package registry">
                    ↓ {downloads}
                  </span>
                )}
                {row.docsUrl && (
                  <a href={row.docsUrl} class="pv-link text-xs">
                    Docs →
                  </a>
                )}
                <a
                  href={row.repositoryUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                  class="pv-link text-xs"
                >
                  Repository ↗
                </a>
              </div>
            </article>
          );
        })}
      </div>

      {visible.length === 0 && (
        <p class="border-border bg-surface text-muted mt-6 rounded-lg border p-6">
          No projects match your search.
        </p>
      )}

      {status !== 'idle' && (
        <p class="text-muted mt-4 text-xs" aria-live="polite">
          {versionStatusMessage(status, live)}
        </p>
      )}
    </div>
  );
}
