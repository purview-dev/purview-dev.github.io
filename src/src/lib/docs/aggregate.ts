import type { ResolvedProject } from '../manifest/load';
import type { DocFrontmatter } from './frontmatter';
import type { DocLinkContext } from './links';

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { getReleaseIndex } from '../releases/runtime';
import { OWNER } from '../site';
import { convertGithubAlerts } from './alerts';
import { extractDescription, extractTitle, renderFrontmatter } from './frontmatter';
import { extractHeadingSlugs, rewriteDocMarkdown, resolveDoclinks, slugifyDocFile } from './links';

export const DOCS_OUTPUT_DIR = resolve('src/content/docs');
export const DOCS_CACHE_DIR = resolve('.cache/docs');

export const DOCS_MANIFEST_SCHEMA = 1;

export interface AggregatedPage {
  slug: string;
  title: string;
  description: string;
  body: string;
  lastReviewed: string;
  sourcePath: string;
  order: number;
}

export interface AggregatedProjectDocs {
  projectId: string;
  pages: AggregatedPage[];
}

export interface DocsManifest {
  schema: typeof DOCS_MANIFEST_SCHEMA;
  syncedAt: string;
  projects: { projectId: string; pages: { slug: string; title: string; order: number }[] }[];
}

export interface RawSourceFile {
  path: string;
  content: string;
  lastModified: string;
}

async function githubJson(path: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'purview-dev-website',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${path}`);
  }
  return response.json() as Promise<unknown>;
}

const commitDateCache = new Map<string, string>();

/**
 * Last commit date (YYYY-MM-DD) for a path in a repository, via the GitHub
 * Atom commit feed. The feed is served by github.com (not the REST API) so it
 * does not consume the unauthenticated API rate limit.
 */
async function lastCommitDate(repository: string, branch: string, path: string): Promise<string> {
  const key = `${repository}:${path}`;
  const cached = commitDateCache.get(key);
  if (cached) {
    return cached;
  }
  try {
    const url = `https://github.com/${repository}/commits/${branch}/${path}.atom`;
    const response = await fetch(url);
    if (response.ok) {
      const body = await response.text();
      const updated = /<updated>([^<]+)<\/updated>/.exec(body);
      if (updated?.[1] && /^\d{4}-\d{2}-\d{2}/.test(updated[1])) {
        commitDateCache.set(key, updated[1].slice(0, 10));
        return updated[1].slice(0, 10);
      }
    }
  } catch {
    // Fall through to "unknown" rather than failing the whole sync.
  }
  commitDateCache.set(key, 'unknown');
  return 'unknown';
}

async function fetchRawFile(
  repository: string,
  branch: string,
  path: string,
): Promise<RawSourceFile | null> {
  const url = `https://raw.githubusercontent.com/${repository}/${branch}/${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }
  const content = await response.text();
  const lastModified = await lastCommitDate(repository, branch, path);
  return { path, content, lastModified };
}

async function listRepositoryFiles(repository: string, branch: string): Promise<string[]> {
  const tree = (await githubJson(`/repos/${repository}/git/trees/${branch}?recursive=1`)) as {
    tree?: { path?: string }[];
  };
  return (tree.tree ?? []).map((entry) => entry.path ?? '');
}

async function cloneWiki(
  repository: string,
): Promise<{ files: Map<string, string>; snapshot: string }> {
  const target = resolve(tmpdir(), `purview-wiki-${repository.replace('/', '-')}`);
  rmSync(target, { recursive: true, force: true });
  const process = Bun.spawnSync([
    'git',
    'clone',
    '--depth',
    '1',
    `https://github.com/${repository}.wiki.git`,
    target,
  ]);
  if (process.exitCode !== 0) {
    throw new Error(`Failed to clone wiki for ${repository}: ${process.stderr.toString()}`);
  }
  const files = new Map<string, string>();
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }
    files.set(entry.name, readFileSync(join(target, entry.name), 'utf8'));
  }
  const headDate = Bun.spawnSync(['git', '-C', target, 'log', '-1', '--format=%cs']);
  const snapshot = headDate.stdout.toString().trim() || new Date().toISOString().slice(0, 10);
  rmSync(target, { recursive: true, force: true });
  return { files, snapshot };
}

function parseWikiSidebar(sidebar: string | undefined): string[] {
  if (!sidebar) {
    return [];
  }
  const order: string[] = [];
  const pattern = /\]\(([^)]+\.md)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sidebar))) {
    const file = match[1] ?? '';
    if (file) {
      order.push(file);
    }
  }
  return order;
}

function isExcluded(fileName: string, exclude: string[] | undefined): boolean {
  return (exclude ?? []).some((pattern) => {
    if (pattern.includes('*')) {
      const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
      return regex.test(fileName);
    }
    return fileName === pattern;
  });
}

function isIndexFile(baseName: string): boolean {
  return ['home.md', 'index.md', 'readme.md'].includes(baseName.toLowerCase());
}

function sourceName(slug: string, raw: RawSourceFile): string {
  return slug === 'index' ? 'Home.md' : (raw.path.split('/').pop() ?? raw.path);
}

async function buildPage(
  project: ResolvedProject,
  branch: string,
  sourceDir: string,
  slug: string,
  raw: RawSourceFile,
  order: number,
  knownSlugs: Set<string>,
  headingSlugs: Map<string, Set<string>>,
): Promise<AggregatedPage> {
  const imageBase: string | null =
    project.docs?.source === 'wiki'
      ? `https://github.com/${project.repository}/wiki/raw/`
      : sourceDir
        ? `https://github.com/${project.repository}/raw/${branch}/${sourceDir}/`
        : null;

  const linkContext: DocLinkContext = {
    projectId: project.id,
    repository: project.repository,
    branch,
    knownSlugs,
    sourcePath: sourceDir,
    imageBase,
    headingSlugs,
  };

  const converted = convertGithubAlerts(raw.content);
  const rewritten = rewriteDocMarkdown(converted, linkContext);
  const content = resolveDoclinks(rewritten, slug);
  // The project's landing page uses the catalogue display name, not the source
  // README's first heading (which can repeat a "Purview.*" package name).
  const title = slug === 'index' ? project.name : extractTitle(raw.content, sourceName(slug, raw));
  const repo = getReleaseIndex().data.repos[project.repository];
  const repoTags = repo?.topics ?? [];
  const repoDescription = repo?.description?.trim() || null;
  const description =
    extractDescription(raw.content) || repoDescription || project.shortDescription;
  const editSourcePath = raw.path.replace(/^\/+/, '');

  const frontmatter: DocFrontmatter = {
    title,
    description,
    owners: [OWNER],
    status: project.status,
    lastReviewed: raw.lastModified,
    sourceProject: project.id,
    sourceRepo: project.repository,
    projectName: project.name,
    sourcePath: editSourcePath,
    editUrl: `https://github.com/${project.repository}/edit/${branch}/${editSourcePath}`,
    tags: repoTags.length > 0 ? repoTags : undefined,
    sidebarLabel: title,
    sidebarOrder: order,
  };

  return {
    slug,
    title,
    description,
    body: `${renderFrontmatter(frontmatter)}\n\n${content}\n`,
    lastReviewed: raw.lastModified,
    sourcePath: editSourcePath,
    order,
  };
}

async function collectGithubPathDocs(
  project: ResolvedProject,
  branch: string,
): Promise<AggregatedProjectDocs> {
  const config = project.docs;
  if (!config || config.source !== 'github-path') {
    return { projectId: project.id, pages: [] };
  }
  const files = await listRepositoryFiles(project.repository, branch);
  const docRoot = config.path.replace(/\/+$/, '');
  const docFiles = files
    .filter((path) => path.startsWith(`${docRoot}/`) && path.endsWith('.md'))
    .filter((path) => !isExcluded(path.split('/').pop() ?? '', config.exclude))
    .toSorted();

  const rawFiles: RawSourceFile[] = [];
  for (const path of docFiles) {
    const raw = await fetchRawFile(project.repository, branch, path);
    if (raw) {
      rawFiles.push(raw);
    }
  }

  // The wiki mirror ships a `_Sidebar.md` that declares the intended page order.
  // It is fetched separately because it is excluded from the rendered pages.
  const sidebarPath = files.find((path) => path.endsWith('_Sidebar.md'));
  const sidebarOrder = sidebarPath
    ? parseWikiSidebar((await fetchRawFile(project.repository, branch, sidebarPath))?.content)
    : [];
  const orderBySidebar = new Map<string, number>();
  sidebarOrder.forEach((name, index) => orderBySidebar.set(slugifyDocFile(name), index));

  const indexSource = rawFiles.find((raw) => isIndexFile(raw.path.slice(docRoot.length + 1)));
  const regular = rawFiles.filter((raw) => raw !== indexSource);

  if (config.readmeAsIndex) {
    const readme = await fetchRawFile(project.repository, branch, 'README.md');
    if (readme) {
      rawFiles.unshift(readme);
    }
  }

  const knownSlugs = new Set<string>(['index']);
  for (const raw of regular) {
    knownSlugs.add(slugifyDocFile(raw.path.slice(docRoot.length + 1)));
  }

  const index = config.readmeAsIndex ? rawFiles[0] : indexSource;
  const headingSlugs = new Map<string, Set<string>>();
  for (const raw of [...regular, ...(index ? [index] : [])]) {
    const slug = raw === index ? 'index' : slugifyDocFile(raw.path.slice(docRoot.length + 1));
    headingSlugs.set(slug, extractHeadingSlugs(raw.content));
  }

  const pages: AggregatedPage[] = [];
  if (index) {
    pages.push(
      await buildPage(project, branch, config.path, 'index', index, -1, knownSlugs, headingSlugs),
    );
  }
  for (const raw of regular) {
    const relative = raw.path.slice(docRoot.length + 1);
    const slug = slugifyDocFile(relative);
    const explicitOrder = config.order?.indexOf(slug);
    const order =
      explicitOrder !== undefined && explicitOrder >= 0
        ? explicitOrder
        : (orderBySidebar.get(slug) ?? 1000);
    pages.push(
      await buildPage(project, branch, config.path, slug, raw, order, knownSlugs, headingSlugs),
    );
  }

  pages.sort((a, b) => a.order - b.order);
  return { projectId: project.id, pages };
}

async function collectWikiDocs(project: ResolvedProject): Promise<AggregatedProjectDocs> {
  const config = project.docs;
  if (!config || config.source !== 'wiki') {
    return { projectId: project.id, pages: [] };
  }
  const { files, snapshot } = await cloneWiki(project.repository);
  const sidebarOrder = parseWikiSidebar(files.get('_Sidebar.md'));
  const candidates: { name: string; content: string }[] = [];

  for (const [name, content] of files) {
    if (name === '_Sidebar.md' || name === '_Footer.md') {
      continue;
    }
    if (isExcluded(name, config.exclude)) {
      continue;
    }
    candidates.push({ name, content });
  }

  const orderBySidebar = new Map<string, number>();
  sidebarOrder.forEach((name, index) => orderBySidebar.set(slugifyDocFile(name), index));

  const knownSlugs = new Set<string>(['index']);
  for (const candidate of candidates) {
    knownSlugs.add(slugifyDocFile(candidate.name));
  }

  const headingSlugs = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    headingSlugs.set(slugifyDocFile(candidate.name), extractHeadingSlugs(candidate.content));
  }

  const pages: AggregatedPage[] = [];
  for (const candidate of candidates) {
    const slug = slugifyDocFile(candidate.name);
    const isIndex = candidate.name.toLowerCase() === 'home.md';
    const order = isIndex ? -1 : (orderBySidebar.get(slug) ?? 1000);
    const raw: RawSourceFile = {
      path: candidate.name,
      content: candidate.content,
      lastModified: snapshot,
    };
    pages.push(
      await buildPage(
        project,
        'main',
        'docs/wiki',
        isIndex ? 'index' : slug,
        raw,
        order,
        knownSlugs,
        headingSlugs,
      ),
    );
  }

  pages.sort((a, b) => a.order - b.order);
  return { projectId: project.id, pages };
}

async function collectReadmeDocs(project: ResolvedProject): Promise<AggregatedProjectDocs> {
  const readme = await fetchRawFile(project.repository, 'main', 'README.md');
  if (!readme) {
    return { projectId: project.id, pages: [] };
  }
  return {
    projectId: project.id,
    pages: [
      await buildPage(
        project,
        'main',
        '',
        'index',
        readme,
        -1,
        new Set(['index']),
        new Map([['index', extractHeadingSlugs(readme.content)]]),
      ),
    ],
  };
}

/** Aggregate documentation for all catalogue projects into pages + manifest. */
export async function aggregateDocs(projects: ResolvedProject[]): Promise<AggregatedProjectDocs[]> {
  const results: AggregatedProjectDocs[] = [];
  for (const project of projects) {
    if (!project.docs) {
      continue;
    }
    try {
      let aggregated: AggregatedProjectDocs;
      switch (project.docs.source) {
        case 'github-path':
          aggregated = await collectGithubPathDocs(project, 'main');
          break;
        case 'wiki':
          aggregated = await collectWikiDocs(project);
          break;
        case 'readme':
          aggregated = await collectReadmeDocs(project);
          break;
      }
      results.push(aggregated);
      console.log(`  docs ${project.id}: ${aggregated.pages.length} pages`);
    } catch (error) {
      console.warn(`  docs ${project.id}: ${(error as Error).message}`);
    }
  }
  return results;
}

/** Write aggregated docs into the Starlight content directory + cache manifest. */
export function writeDocs(
  aggregated: AggregatedProjectDocs[],
  outputDir = DOCS_OUTPUT_DIR,
): DocsManifest {
  rmSync(outputDir, { recursive: true, force: true });
  const manifest: DocsManifest = {
    schema: DOCS_MANIFEST_SCHEMA,
    syncedAt: new Date().toISOString(),
    projects: [],
  };

  for (const project of aggregated) {
    for (const page of project.pages) {
      // Pages are nested under `docs/` so they are served at `/docs/<project>/<page>/`.
      const target = resolve(outputDir, 'docs', project.projectId, `${page.slug}.md`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, page.body, 'utf8');
    }
    manifest.projects.push({
      projectId: project.projectId,
      pages: project.pages.map((page) => ({
        slug: page.slug,
        title: page.title,
        order: page.order,
      })),
    });
  }
  return manifest;
}

export function writeDocsManifest(manifest: DocsManifest): void {
  mkdirSync(DOCS_CACHE_DIR, { recursive: true });
  writeFileSync(
    resolve(DOCS_CACHE_DIR, 'index.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

export function readDocsManifest(): DocsManifest | null {
  const file = resolve(DOCS_CACHE_DIR, 'index.json');
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as Record<string, unknown>).schema === DOCS_MANIFEST_SCHEMA
    ) {
      return parsed as DocsManifest;
    }
    return null;
  } catch {
    return null;
  }
}
