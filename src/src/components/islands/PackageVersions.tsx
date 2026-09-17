import { useState } from 'preact/hooks';
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
}

type SortKey = 'package' | 'project' | 'stable' | 'prerelease' | 'downloads';
type SortDir = 'asc' | 'desc';

interface Props {
  packages: PackageRow[];
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

const COLUMNS: { key: SortKey; label: string; title: string }[] = [
  { key: 'package', label: 'Package', title: 'Sort by package name' },
  { key: 'project', label: 'Project', title: 'Sort by project name' },
  { key: 'stable', label: 'Stable', title: 'Sort by latest stable version' },
  { key: 'prerelease', label: 'Prerelease', title: 'Sort by latest prerelease version' },
  { key: 'downloads', label: 'Downloads', title: 'Sort by total downloads' },
];

export default function PackageVersions({ packages }: Props) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('project');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const query = search.trim().toLowerCase();

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

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'downloads' ? 'desc' : 'asc');
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
        <p class="text-muted text-sm" aria-live="polite">
          {rows.length} package{rows.length === 1 ? '' : 's'}
        </p>
      </div>

      <div class="border-border mt-4 overflow-x-auto rounded-xl border">
        <table class="w-full min-w-[52rem] text-left text-sm">
          <thead class="border-border bg-surface border-b">
            <tr>
              {COLUMNS.map((column) => (
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
            {rows.map((row) => (
              <tr key={row.packageId} class="border-border border-b last:border-0">
                <td class="px-4 py-3">
                  <a
                    href={row.nugetUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                    class="pv-link break-all"
                  >
                    {row.packageId}
                  </a>
                </td>
                <td class="px-4 py-3">
                  <a href={row.projectUrl} class="pv-link">
                    {row.projectName}
                  </a>
                </td>
                <td class="px-4 py-3 font-mono text-xs">
                  {row.latestStable ?? <span class="text-muted">—</span>}
                </td>
                <td class="px-4 py-3 font-mono text-xs">
                  {row.latestPrerelease ?? <span class="text-muted">—</span>}
                </td>
                <td class="text-muted px-4 py-3 text-xs">
                  {row.totalDownloads == null ? '—' : row.totalDownloads.toLocaleString('en-US')}
                </td>
              </tr>
            ))}
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
