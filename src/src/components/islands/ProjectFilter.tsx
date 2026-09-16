import { useEffect, useState } from 'preact/hooks';

const STORAGE_KEY = 'purview.project-filter.v1';

interface FilterState {
  search: string;
  category: string;
  status: string;
}

interface Props {
  categories: string[];
  statuses: string[];
}

function initialFilters(): FilterState {
  if (typeof window === 'undefined') {
    return { search: '', category: 'all', status: 'all' };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FilterState>;
      return {
        search: typeof parsed.search === 'string' ? parsed.search : '',
        category: typeof parsed.category === 'string' ? parsed.category : 'all',
        status: typeof parsed.status === 'string' ? parsed.status : 'all',
      };
    }
  } catch {
    // Ignore unreadable storage; fall back to defaults.
  }
  return { search: '', category: 'all', status: 'all' };
}

export default function ProjectFilter({ categories, statuses }: Props) {
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // Storage may be unavailable (private mode); filtering still works.
    }

    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-project-id]'));
    const query = filters.search.trim().toLowerCase();
    let visible = 0;
    for (const card of cards) {
      const category = card.dataset.category ?? '';
      const status = card.dataset.status ?? '';
      const searchText = card.dataset.search ?? '';
      const matchesCategory = filters.category === 'all' || category === filters.category;
      const matchesStatus = filters.status === 'all' || status === filters.status;
      const matchesSearch = query === '' || searchText.includes(query);
      const show = matchesCategory && matchesStatus && matchesSearch;
      card.hidden = !show;
      if (show) {
        visible += 1;
      }
    }
    setVisibleCount(visible);
  }, [filters]);

  const selectClasses =
    'rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground';

  return (
    <div class="flex flex-wrap items-center gap-3">
      <label
        class="border-border bg-surface flex min-w-56 flex-1 items-center gap-2 rounded-md border px-3 py-2"
        htmlFor="project-search"
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
          id="project-search"
          type="search"
          value={filters.search}
          onInput={(event) =>
            setFilters((current) => ({
              ...current,
              search: (event.target as HTMLInputElement).value,
            }))
          }
          placeholder="Search projects…"
          class="w-full bg-transparent text-sm outline-none"
        />
      </label>

      <label class="sr-only" htmlFor="filter-category">
        Filter by category
      </label>
      <select
        id="filter-category"
        class={selectClasses}
        value={filters.category}
        onChange={(event) =>
          setFilters((current) => ({
            ...current,
            category: (event.target as HTMLSelectElement).value,
          }))
        }
      >
        <option value="all">All categories</option>
        {categories.map((category) => (
          <option value={category} key={category}>
            {category}
          </option>
        ))}
      </select>

      <label class="sr-only" htmlFor="filter-status">
        Filter by status
      </label>
      <select
        id="filter-status"
        class={selectClasses}
        value={filters.status}
        onChange={(event) =>
          setFilters((current) => ({
            ...current,
            status: (event.target as HTMLSelectElement).value,
          }))
        }
      >
        <option value="all">All statuses</option>
        {statuses.map((status) => (
          <option value={status} key={status}>
            {status}
          </option>
        ))}
      </select>

      <p class="text-muted text-sm" aria-live="polite">
        {visibleCount} project{visibleCount === 1 ? '' : 's'}
      </p>
    </div>
  );
}
