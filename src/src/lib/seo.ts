const MIN_LENGTH = 120;
const MAX_LENGTH = 160;

/**
 * How long a derived title may get, including the brand suffix. Search engines
 * show roughly this much, so a title that runs past it hides its own tail (which
 * is where the project name sits).
 */
const TITLE_MAX = 70;

/** The site name appended to a derived title, with its separator. */
function brandSuffix(brand: string): string {
  return ` | ${brand}`;
}

/**
 * Search-engine metadata for the pages the site generates.
 *
 * Two rules govern everything here:
 *
 * 1. **A title leads with the words a reader would search for.** The catalogue
 *    already carries those words — the package id, `shortDescription`, the
 *    GitHub topics and the category — so titles are *derived* from metadata
 *    rather than hand-written per page, and cannot drift from the catalogue.
 * 2. **A documentation page names its project.** `Unions | Purview Dev` tells a
 *    crawler nothing; `Union design — Unions documentation | Purview Dev` says
 *    which product the page documents, which is what makes a long-tail query
 *    resolvable.
 *
 * The module is dependency-free (no imports) so the docs aggregation, the Astro
 * config and any page can use it without creating an import cycle.
 */

/**
 * Fit a meta description to what search engines display.
 *
 * A passage that already fills a description is used as it stands, cut at a
 * sentence boundary where there is one (`truncate`). A shorter one is padded with
 * `context` — which is why the callers pass a context long enough to matter — and
 * only the padded result is cut at a word.
 */
export function metaDescription(
  text: string,
  context = 'Open-source .NET tooling from Purview Dev.',
): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const primary = collapsed.length > MAX_LENGTH ? truncate(collapsed, MAX_LENGTH) : collapsed;
  if (primary.length >= MIN_LENGTH || primary.endsWith('…')) {
    return primary;
  }
  const base = /[.!?]$/.test(primary) ? primary : `${primary}.`;
  const padded = `${base} ${context}`;
  return padded.length > MAX_LENGTH ? truncateWords(padded, MAX_LENGTH) : padded;
}

/**
 * The shortest a sentence-boundary cut may be. Below this a single short sentence
 * would throw away more information than it gains in readability, and a word cut
 * of the fuller text is the better trade.
 */
const SENTENCE_FLOOR = 70;

/** Cut to the last whole word inside the limit, marking the cut. */
export function truncateWords(text: string, limit: number): string {
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.—-]+$/, '')}…`;
}

/**
 * Truncate a passage to a limit.
 *
 * A sentence boundary inside the limit wins when at least `SENTENCE_FLOOR`
 * characters precede it: a description that ends where the author ended a
 * sentence reads as prose in a result snippet, while a mid-paragraph cut reads as
 * scraped text. Otherwise the cut falls back to the last whole word.
 */
export function truncate(text: string, limit: number): string {
  const cut = text.slice(0, limit);
  const sentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return sentenceEnd >= SENTENCE_FLOOR ? cut.slice(0, sentenceEnd + 1) : truncateWords(cut, limit);
}

/** The first sentence of a block of prose, without its terminating punctuation. */
export function firstSentence(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed === '') {
    return '';
  }
  const match = /^(.*?[.!?])(?:\s|$)/.exec(collapsed);
  return (match?.[1] ?? collapsed).replace(/[.!?]+$/, '').trim();
}
/** Category slugs are catalogue vocabulary; these are the words a reader types. */
export const CATEGORY_PHRASES: Record<string, string> = {
  'application-framework': 'application framework',
  validation: 'validation',
  observability: 'observability',
  'source-generation': 'source generation',
  'build-tooling': 'build tooling',
  'developer-tooling': 'developer tooling',
  aspire: 'Aspire',
};

export function categoryPhrase(category: string): string {
  return CATEGORY_PHRASES[category] ?? category.replace(/-/g, ' ');
}

/**
 * Acronyms and spellings that a generic "split on hyphens and capitalise" rule
 * gets wrong. This is the topic vocabulary (GitHub topics), not the folder
 * vocabulary the docs sidebar uses, so it is deliberately its own map.
 */
const TAG_WORDS: Record<string, string> = {
  api: 'API',
  aot: 'AOT',
  aspnetcore: 'ASP.NET Core',
  blazor: 'Blazor',
  cli: 'CLI',
  cosmosdb: 'Cosmos DB',
  'c-sharp': 'C#',
  csharp: 'C#',
  cs: 'C#',
  dotnet: '.NET',
  efcore: 'EF Core',
  'ef-core': 'EF Core',
  entityframework: 'Entity Framework',
  grpc: 'gRPC',
  http: 'HTTP',
  https: 'HTTPS',
  json: 'JSON',
  mcp: 'MCP',
  msbuild: 'MSBuild',
  mqtt: 'MQTT',
  net: '.NET',
  net10: '.NET 10',
  net11: '.NET 11',
  nuget: 'NuGet',
  opentelemetry: 'OpenTelemetry',
  rabbitmq: 'RabbitMQ',
  redis: 'Redis',
  roslyn: 'Roslyn',
  sdk: 'SDK',
  serilog: 'Serilog',
  sql: 'SQL',
  sqlserver: 'SQL Server',
  tunit: 'TUnit',
  ui: 'UI',
  uri: 'URI',
  url: 'URL',
  xunit: 'xUnit',
  xml: 'XML',
  yaml: 'YAML',
  zod: 'Zod',
  zodsharp: 'ZodSharp',
};

/** Display form of one topic: `c-sharp` -> `C#`, `value-types` -> `value types`. */
export function humaniseTag(tag: string): string {
  // A single word may spell out several (`c-sharp`, `ef-core`, `net11`), so the
  // whole tag is looked up before it is split.
  const whole = TAG_WORDS[tag.trim().toLowerCase()];
  if (whole !== undefined) {
    return whole;
  }
  return tag
    .split(/[-_]+/)
    .filter((word) => word !== '')
    .map((word) => TAG_WORDS[word.toLowerCase()] ?? word)
    .join(' ');
}

/** The fields of a catalogue project that derived metadata is built from. */
export interface SeoProjectFacts {
  name: string;
  shortDescription: string;
  category: string;
  packages?: readonly { id: string; primary?: boolean }[];
  /** GitHub topics, read through the release cache. */
  tags?: readonly string[];
  targetFrameworks?: readonly string[];
}

/**
 * The name a reader searches for: the primary package id when the project
 * publishes one (`Purview.Unions`), otherwise the catalogue display name.
 */
export function productName(project: SeoProjectFacts): string {
  const primary = project.packages?.find((pkg) => pkg.primary) ?? project.packages?.[0];
  return primary?.id ?? project.name;
}

/**
 * `<title>` for a project's catalogue page.
 *
 * `Purview.Unions — Dependency-free C# 15 unions that do not box value-type cases`
 *
 * The product name leads, so the keyword phrase is what gets trimmed when the pair
 * would run past what a result shows. The phrase is preferred over the category
 * because it is the words a reader searches with; the category is the fallback.
 */
export function projectPageTitle(
  project: SeoProjectFacts,
  options: { brand?: string } = {},
): string {
  const { brand = 'Purview Dev' } = options;
  const product = productName(project);
  const phrase = firstSentence(project.shortDescription);
  // What is left for the phrase once the product name, its separator and the brand
  // have taken their share of the title.
  const budget = TITLE_MAX - brandSuffix(brand).length - product.length - 3;
  const trimmed = trimPhrase(phrase, Math.max(24, budget));
  return fitTitle(
    [
      `${product} — ${phrase}`,
      // A trimmed phrase shorter than this says less than the category does.
      ...(trimmed.length >= 20 ? [`${product} — ${trimmed}`] : []),
      `${product} — ${categoryPhrase(project.category)}`,
      product,
    ],
    brand,
  );
}

/** Meta description for a project's catalogue page. */
export function projectPageDescription(project: SeoProjectFacts): string {
  const frameworks = project.targetFrameworks?.length
    ? ` Targets ${project.targetFrameworks.join(', ')}.`
    : '';
  const topics = project.tags?.slice(0, 6).join(', ') ?? '';
  return metaDescription(
    `${firstSentence(project.shortDescription)}.${frameworks}${topics ? ` Topics: ${topics}.` : ''}`,
    `${project.name} — ${categoryPhrase(project.category)} from Purview Dev, with installation, use cases and documentation.`,
  );
}

/**
 * Pick the first shape that fits the title budget.
 *
 * The shapes are ordered from most to least informative, and every one of them
 * identifies the page: the last candidate is used even when it overruns, because a
 * duplicate title (two pages competing for one slot) is a worse failure than a
 * long one, and search engines cut the tail rather than the head.
 */
function fitTitle(candidates: readonly string[], brand: string): string {
  const suffix = brandSuffix(brand);
  const fits = candidates.find((candidate) => candidate.length + suffix.length <= TITLE_MAX);
  return `${fits ?? candidates[candidates.length - 1]}${suffix}`;
}

/** Words a title phrase may not end on: a trimmed phrase must end on content. */
const DANGLING_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'but',
  'by',
  'do',
  'does',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'which',
  'with',
  'without',
]);

/** A keyword phrase shortened to a word boundary, without ending on a stop word. */
function trimPhrase(phrase: string, limit: number): string {
  if (phrase.length <= limit) {
    return phrase;
  }
  const cut = phrase.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  const words = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).split(' ').filter(Boolean);
  while (words.length > 0 && DANGLING_WORDS.has((words[words.length - 1] ?? '').toLowerCase())) {
    words.pop();
  }
  return words.join(' ').replace(/[\s,;:.—-]+$/, '');
}

/**
 * `<title>` for a project's documentation landing page.
 *
 * The landing page is a different page from the catalogue page, so it gets a
 * different title. Keeping both as the project name alone would make the two
 * compete for the same query.
 */
export function docsIndexTitle(
  project: SeoProjectFacts,
  options: { qualifier?: string; brand?: string } = {},
): string {
  const { qualifier, brand = 'Purview Dev' } = options;
  const version = qualifier ? ` (${qualifier})` : '';
  return fitTitle(
    [
      `${project.name} documentation — ${categoryPhrase(project.category)} for .NET${version}`,
      `${project.name} documentation${version}`,
      `${project.name} documentation`,
    ],
    brand,
  );
}

/**
 * `<title>` for one aggregated documentation page.
 *
 * The project name is always in the returned title — a documentation page whose
 * title omits its product is unreachable from a search for that product — and the
 * section and the word "documentation" are dropped, in that order, when keeping
 * them would push the title past what a result shows.
 */
export function docsPageTitle(options: {
  pageTitle: string;
  projectName: string;
  /** Display labels of the folders the page sits in, outermost first (ADR 0011). */
  sectionTrail?: readonly string[];
  /**
   * Version qualifier for a non-default documentation channel (`Prerelease`), so
   * the two versions of the same page never share a search-result title.
   */
  qualifier?: string;
  /** Site name appended to the title. */
  brand?: string;
}): string {
  const { pageTitle, projectName, sectionTrail = [], qualifier, brand = 'Purview Dev' } = options;
  const section = sectionTrail.length > 0 ? `${sectionTrail.join(' · ')} · ` : '';
  const version = qualifier ? ` (${qualifier})` : '';
  // What is left for the page's own title once the project name, its separator and
  // the brand have taken their share.
  const budget = TITLE_MAX - brandSuffix(brand).length - projectName.length - 3 - version.length;
  const trimmed = trimPhrase(pageTitle, Math.max(16, budget));
  return fitTitle(
    [
      `${section}${pageTitle} — ${projectName} documentation${version}`,
      `${section}${pageTitle} — ${projectName}${version}`,
      // A trimmed title below this says less than the project name does.
      ...(trimmed.length >= 8 ? [`${trimmed} — ${projectName}${version}`] : []),
      // Never less than this: the page's own title, whole.
      `${pageTitle} — ${projectName}${version}`,
    ],
    brand,
  );
}

/** Meta description for one aggregated documentation page. */
export function docsDescription(options: {
  summary: string;
  pageTitle: string;
  projectName: string;
  /** Version qualifier for a non-default documentation channel (`Prerelease`). */
  qualifier?: string;
}): string {
  const { summary, pageTitle, projectName, qualifier } = options;
  const version = qualifier ? ` (${qualifier})` : '';
  return metaDescription(
    summary,
    `${pageTitle} in the ${projectName} documentation${version} — open-source .NET tooling from Purview Dev.`,
  );
}

/** `<title>` subject for a topic or category hub page. */
export function hubTitle(label: string, kind: 'topic' | 'category'): string {
  const subject = label.charAt(0).toUpperCase() + label.slice(1);
  return kind === 'topic'
    ? `${subject} — Purview .NET projects and guides`
    : `${subject} — Purview .NET projects`;
}

/** Meta description for a topic or category hub page, naming what it indexes. */
export function hubDescription(options: {
  label: string;
  kind: 'topic' | 'category';
  projectNames: readonly string[];
}): string {
  const { label, kind, projectNames } = options;
  const names = projectNames.join(', ');
  return metaDescription(
    kind === 'topic'
      ? `Open-source .NET projects and documentation tagged ${label}: ${names}.`
      : `Purview .NET ${label} projects: ${names}.`,
    `Browse the ${label} projects, their packages, use cases and documentation.`,
  );
}
