import type { ResolvedProject } from './manifest/load';

/** `1 project` / `2 projects`, so generated prose never reads "1 projects". */
function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * The suite-level narrative for the root `/llms.txt`, derived from the project
 * catalogue so it can never drift from the products the site actually ships.
 *
 * The text names only the projects present in the catalogue, groups them by
 * their declared `category` and reports the counts. Nothing here is authored by
 * hand: adding, archiving, renaming or recategorising a project changes the
 * generated narrative on the next build.
 */
export function buildLlmsDetails(projects: readonly ResolvedProject[]): string {
  const active = projects
    .filter((project) => project.status !== 'archived')
    .toSorted((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const byCategory = new Map<string, string[]>();
  for (const project of active) {
    const names = byCategory.get(project.category) ?? [];
    names.push(project.name);
    byCategory.set(project.category, names);
  }

  const groups = [...byCategory.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([category, names]) => `${category.replace(/-/g, ' ')} (${names.join(', ')})`)
    .join('; ');

  const documented = active.filter((project) => project.docs).length;

  const lead =
    active.length === 0
      ? 'Purview Dev builds open-source .NET developer tooling.'
      : `Purview Dev builds open-source .NET developer tooling across ${plural(active.length, 'project')} in ${plural(byCategory.size, 'category', 'categories')}: ${groups}.`;

  const documentation =
    documented === 0
      ? 'per-project guides'
      : `per-project guides (${plural(documented, 'documented project')})`;

  return `${lead}\n\nSee the projects catalogue for the full product family, the releases page for GitHub and NuGet version information, and the documentation portal for ${documentation}.`;
}
