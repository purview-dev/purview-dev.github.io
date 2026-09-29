import { useEffect, useState } from 'preact/hooks';

interface AudienceOption {
  value: string;
  label: string;
}

interface Props {
  audiences: AudienceOption[];
}

/**
 * Filters the use-case cards rendered on `/use-cases/`. Cards are
 * server-rendered and carry `data-audience` / `data-usecase-search`; this island
 * only toggles their `hidden` attribute, so the page stays fully usable without
 * JavaScript.
 */
export default function UseCaseFilter({ audiences }: Props) {
  const [audience, setAudience] = useState('all');
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[data-usecase-id]'));
    const query = search.trim().toLowerCase();
    let visible = 0;
    for (const item of items) {
      const matchesAudience =
        audience === 'all' || (item.dataset.usecaseAudience ?? '') === audience;
      const matchesSearch = query === '' || (item.dataset.usecaseSearch ?? '').includes(query);
      const show = matchesAudience && matchesSearch;
      item.hidden = !show;
      if (show) {
        visible += 1;
      }
    }
    setVisibleCount(visible);
  }, [audience, search]);

  const selectClasses =
    'rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground';

  return (
    <div class="flex flex-wrap items-center gap-3">
      <label
        class="border-border bg-surface flex min-w-56 flex-1 items-center gap-2 rounded-md border px-3 py-2"
        htmlFor="use-case-search"
      >
        <span class="sr-only">Search use cases</span>
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
          id="use-case-search"
          type="search"
          value={search}
          onInput={(event) => setSearch((event.target as HTMLInputElement).value)}
          placeholder="Search use cases…"
          class="w-full bg-transparent text-sm outline-none"
        />
      </label>

      <label class="sr-only" htmlFor="filter-audience">
        Filter by audience
      </label>
      <select
        id="filter-audience"
        class={selectClasses}
        value={audience}
        onChange={(event) => setAudience((event.target as HTMLSelectElement).value)}
      >
        <option value="all">All audiences</option>
        {audiences.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <p class="text-muted text-sm" aria-live="polite">
        {visibleCount} use case{visibleCount === 1 ? '' : 's'}
      </p>
    </div>
  );
}
