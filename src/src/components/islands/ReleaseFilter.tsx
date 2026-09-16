import { useEffect, useState } from 'preact/hooks';

const STORAGE_KEY = 'purview.release-filter.v1';

interface FilterState {
  project: string;
  stability: string;
}

interface ProjectOption {
  id: string;
  name: string;
}

interface Props {
  projects: ProjectOption[];
}

function initialFilters(): FilterState {
  if (typeof window === 'undefined') {
    return { project: 'all', stability: 'all' };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FilterState>;
      return {
        project: typeof parsed.project === 'string' ? parsed.project : 'all',
        stability: typeof parsed.stability === 'string' ? parsed.stability : 'all',
      };
    }
  } catch {
    // Ignore unreadable storage.
  }
  return { project: 'all', stability: 'all' };
}

export default function ReleaseFilter({ projects }: Props) {
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // Storage may be unavailable; filtering still works.
    }

    const entries = Array.from(document.querySelectorAll<HTMLElement>('[data-release-project]'));
    let visible = 0;
    for (const entry of entries) {
      const project = entry.dataset.releaseProject ?? '';
      const prerelease = entry.dataset.releasePrerelease === 'true';
      const matchesProject = filters.project === 'all' || project === filters.project;
      const matchesStability =
        filters.stability === 'all' ||
        (filters.stability === 'prerelease' && prerelease) ||
        (filters.stability === 'stable' && !prerelease);
      const show = matchesProject && matchesStability;
      entry.hidden = !show;
      if (show) {
        visible += 1;
      }
    }

    // The package-versions table follows the project filter (rows show both
    // stable and prerelease columns, so the stability filter does not apply).
    const packageRows = Array.from(
      document.querySelectorAll<HTMLElement>('[data-package-project]'),
    );
    for (const row of packageRows) {
      const project = row.dataset.packageProject ?? '';
      row.hidden = !(filters.project === 'all' || project === filters.project);
    }

    setVisibleCount(visible);
  }, [filters]);

  const selectClasses =
    'rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground';

  return (
    <div class="flex flex-wrap items-center gap-3">
      <label class="sr-only" htmlFor="release-project">
        Filter by project
      </label>
      <select
        id="release-project"
        class={selectClasses}
        value={filters.project}
        onChange={(event) =>
          setFilters((current) => ({
            ...current,
            project: (event.target as HTMLSelectElement).value,
          }))
        }
      >
        <option value="all">All projects</option>
        {projects.map((project) => (
          <option value={project.id} key={project.id}>
            {project.name}
          </option>
        ))}
      </select>

      <label class="sr-only" htmlFor="release-stability">
        Filter by stability
      </label>
      <select
        id="release-stability"
        class={selectClasses}
        value={filters.stability}
        onChange={(event) =>
          setFilters((current) => ({
            ...current,
            stability: (event.target as HTMLSelectElement).value,
          }))
        }
      >
        <option value="all">All releases</option>
        <option value="stable">Stable</option>
        <option value="prerelease">Prerelease</option>
      </select>

      <p class="text-muted text-sm" aria-live="polite">
        {visibleCount} release{visibleCount === 1 ? '' : 's'}
      </p>
    </div>
  );
}
