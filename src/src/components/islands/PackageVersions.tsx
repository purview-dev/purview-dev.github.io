import { useMemo, useState } from 'preact/hooks';
import { compare, valid } from 'semver';

export interface PackageRow {
  projectId: string;
  projectName: string;
  packageId: string;
  latestStable: string | null;
  latestPrerelease: string | null;
  totalDownloads: number | null;
  nugetUrl: string;
  projectUrl: string;
  deprecated?: boolean;
}

type SortKey = 'package' | 'project' | 'stable' | 'prerelease' | 'downloads';
type SortDir = 'asc' | 'desc';

interface Props {
  packages: PackageRow[];
  /** Show the project column and allow grouping by project. Set to false on a single-project page, where the project is already implicit. */
  showProject?: boolean;
}

function normalizeVersion(version: string | null): string | null {
  if (!version) {
    return null;
  }
  return version.replace(/^v/i, '').replace(/reprelease/gi, 'prerelease');
}

function compareVersions(a: string | null, b: string | null): number {
  const va = normalizeVersion(a);
  const vb = normalizeVersion(b);
  if (va && vb) {
    const pa = valid(va);
    const pb = valid(vb);
    if (pa && pb) {
      return compare(pa, pb);
    }
  }
  return (va ?? '').localeCompare(vb ?? '');
}

function formatDownloads(value: number | null): string {
  return value == null ? '—' : value.toLocaleString('en-US');
}

function VersionBadge({
  version,
  tone,
}: {
  version: string | null;
  tone: 'stable' | 'prerelease';
}) {
  if (!version) {
    return <span class="text-muted text-xs">—</span>;
  }
  return (
    <span
      class={[
        'inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-xs',
        tone === 'stable'
          ? 'border-success/30 bg-success/10 text-success'
          : 'border-warning/30 bg-warning/10 text-warning',
      ].join(' ')}
    >
      {version}
    </span>
  );
}

export default function PackageVersions({ packages, showProject = true }: Props) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('project');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [groupByProject, setGroupByProject] = useState(true);

  const query = search.trim().toLowerCase();
  const canGroup = showProject && new Set(packages.map((row) => row.projectId)).size > 1;
  const isGrouped = canGroup && groupByProject;
  const showProjectColumn = showProject && !isGrouped;
  const columns: { key: SortKey; label: string; title: string }[] = [
    { key: 'package', label: 'Package', title: 'Sort by package name' },
    ...(showProjectColumn
      ? ([{ key: 'project', label: 'Project', title: 'Sort by project name' }] as const)
      : []),
    { key: 'stable', label: 'Stable', title: 'Sort by latest stable version' },
    { key: 'prerelease', label: 'Prerelease', title: 'Sort by latest prerelease version' },
    { key: 'downloads', label: 'Downloads', title: 'Sort by total downloads' },
  ];

  const rows = packages
    .filter(
      (row) =>
        query === '' ||
        row.packageId.toLowerCase().includes(query) ||
        row.projectName.toLowerCase().includes(query) ||
        (row.latestStable?.toLowerCase().includes(query) ?? false) ||
        (row.latestPrerelease?.toLowerCase().includes(query) ?? false),
    )
    .toSorted((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'package':
          return a.packageId.localeCompare(b.packageId) * dir;
        case 'project':
          return (
            (a.projectName.localeCompare(b.projectName) || a.packageId.localeCompare(b.packageId)) *
            dir
          );
        case 'stable': {
          const aNull = a.latestStable ? 0 : 1;
          const bNull = b.latestStable ? 0 : 1;
          return (aNull - bNull || compareVersions(a.latestStable, b.latestStable)) * dir;
        }
        case 'prerelease': {
          const aNull = a.latestPrerelease ? 0 : 1;
          const bNull = b.latestPrerelease ? 0 : 1;
          return (aNull - bNull || compareVersions(a.latestPrerelease, b.latestPrerelease)) * dir;
        }
        case 'downloads':
          return ((a.totalDownloads ?? -1) - (b.totalDownloads ?? -1)) * dir;
      }
    });

  const groups = useMemo(() => {
    if (!canGroup || !groupByProject) {
      return null;
    }
    const byProject = new Map<
      string,
      { projectName: string; projectUrl: string; rows: PackageRow[] }
    >();
    for (const row of rows) {
      const existing = byProject.get(row.projectId);
      if (existing) {
        existing.rows.push(row);
      } else {
        byProject.set(row.projectId, {
          projectName: row.projectName,
          projectUrl: row.projectUrl,
          rows: [row],
        });
      }
    }
    return [...byProject.values()].toSorted((a, b) => a.projectName.localeCompare(b.projectName));
  }, [canGroup, groupByProject, rows]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'downloads' ? 'desc' : 'asc');
  }

  const colSpan = columns.length;

  function renderRow(row: PackageRow) {
    return (
      <tr key={row.packageId} class="border-border hover:bg-surface/60 border-b last:border-0">
        <td class="px-4 py-3">
          <a
            href={row.nugetUrl}
            rel="noopener noreferrer"
            target="_blank"
            class="pv-link break-all"
          >
            {row.packageId}
          </a>
          {row.deprecated && (
            <span class="border-warning/40 bg-warning/10 text-warning ml-2 rounded-full border px-2 py-0.5 text-xs">
              deprecated
            </span>
          )}
        </td>
        {showProjectColumn && (
          <td class="px-4 py-3">
            <a href={row.projectUrl} class="pv-link">
              {row.projectName}
            </a>
          </td>
        )}
        <td class="px-4 py-3">
          <VersionBadge version={row.latestStable} tone="stable" />
        </td>
        <td class="px-4 py-3">
          <VersionBadge version={row.latestPrerelease} tone="prerelease" />
        </td>
        <td
          class="text-muted px-4 py-3 text-xs"
          title={row.totalDownloads == null ? 'Not yet indexed by NuGet search' : undefined}
        >
          {formatDownloads(row.totalDownloads)}
        </td>
      </tr>
    );
  }

  return (
    <div>
      <div class="flex flex-wrap items-center gap-3">
        <label
          class="border-border bg-surface flex min-w-56 flex-1 items-center gap-2 rounded-md border px-3 py-2"
          htmlFor="package-search"
        >
          <span class="sr-only">Search packages</span>
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
            id="package-search"
            type="search"
            value={search}
            onInput={(event) => setSearch((event.target as HTMLInputElement).value)}
            placeholder="Search packages…"
            class="w-full bg-transparent text-sm outline-none"
          />
        </label>
        {canGroup && (
          <label class="text-muted flex items-center gap-2 text-sm" htmlFor="package-group">
            <input
              id="package-group"
              type="checkbox"
              checked={groupByProject}
              onChange={(event) => setGroupByProject((event.target as HTMLInputElement).checked)}
              class="border-border text-brand focus:ring-focus rounded"
            />
            Group by project
          </label>
        )}
        <p class="text-muted text-sm" aria-live="polite">
          {rows.length} package{rows.length === 1 ? '' : 's'}
        </p>
      </div>

      <div class="pv-card mt-4 overflow-hidden overflow-x-auto">
        <table class="w-full min-w-[52rem] text-left text-sm">
          <thead class="border-border bg-surface/80 border-b backdrop-blur">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  class="px-4 py-3"
                  aria-sort={
                    sortKey === column.key
                      ? sortDir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(column.key)}
                    class="hover:text-accent font-semibold"
                    title={column.title}
                  >
                    {column.label}
                    {sortKey === column.key && (
                      <span aria-hidden="true">{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups
              ? groups.map((group) => {
                  const subtotal = group.rows.reduce(
                    (sum, row) => (row.totalDownloads == null ? sum : sum + row.totalDownloads),
                    0,
                  );
                  const hasAnyDownloads = group.rows.some((row) => row.totalDownloads != null);
                  return (
                    <>
                      <tr
                        key={`group-${group.projectName}`}
                        class="border-border bg-brand/5 border-b"
                      >
                        <th
                          scope="colgroup"
                          colspan={colSpan - 1}
                          class="px-4 py-2 text-left text-xs font-semibold tracking-wider uppercase"
                        >
                          <a href={group.projectUrl} class="text-brand-emphasis hover:underline">
                            {group.projectName}
                          </a>
                        </th>
                        <td class="text-muted px-4 py-2 text-right text-xs font-semibold">
                          {hasAnyDownloads ? `${formatDownloads(subtotal)} total` : '—'}
                        </td>
                      </tr>
                      {group.rows.map((row) => renderRow(row))}
                    </>
                  );
                })
              : rows.map((row) => renderRow(row))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <p class="border-border bg-surface text-muted mt-4 rounded-lg border p-6">
          No packages match your search.
        </p>
      )}
    </div>
  );
}
