import type { DocsManifest } from '../src/lib/docs/aggregate';
import type { ResolvedProject } from '../src/lib/manifest/load';
import type { ReleaseCacheData } from '../src/lib/releases/types';

import { readDocsManifest } from '../src/lib/docs/aggregate';
import { slugifyDocFile } from '../src/lib/docs/links';
import {
  ManifestValidationError,
  loadExternalProjects,
  loadProjects,
} from '../src/lib/manifest/load';
import { readReleaseCache, readReleaseFixture } from '../src/lib/releases/cache';
import { selectStableVersion } from '../src/lib/releases/normalize';
import { OWNER } from '../src/lib/site';

/**
 * Deterministic catalogue guard (ADR 0003).
 *
 * Proves the invariants of `src/src/data/projects.yml` against the generated
 * docs mirror/cache and the release cache/fixtures. Offline only: it never
 * performs network I/O, so it can run inside `just validate` and CI.
 *
 * It fails (exit 1) on blockers and drift; quality observations are printed as
 * warnings so they do not break the build.
 */

interface Finding {
  project: string;
  field: string;
  observed: string;
  expected: string;
  remediation: string;
}

const errors: Finding[] = [];
const warnings: Finding[] = [];

function fail(finding: Finding): void {
  errors.push(finding);
}

function warn(finding: Finding): void {
  warnings.push(finding);
}

function describeVersions(count: number): string {
  return count === 0 ? 'no published versions' : `${count} published versions`;
}

/** Use cases must be concrete: code requires a language, and a docs link requires docs. */
function checkUseCases(project: ResolvedProject, docsPages: Set<string> | undefined): void {
  if (project.status !== 'archived' && project.useCases.length === 0) {
    fail({
      project: project.id,
      field: 'useCases',
      observed: 'none',
      expected: 'at least one concrete use case (ADR 0002)',
      remediation:
        'add a use case with audience, title, scenario, outcome, and code + language evidence.',
    });
  }
  for (const useCase of project.useCases) {
    if (useCase.code !== undefined && useCase.language === undefined) {
      fail({
        project: project.id,
        field: `useCases["${useCase.title}"].language`,
        observed: 'missing',
        expected: 'a language id such as csharp/json/yaml',
        remediation: 'set `language` for every use case that carries a `code` snippet.',
      });
    }
    if (useCase.docsPage === undefined) {
      continue;
    }
    if (!project.docs) {
      fail({
        project: project.id,
        field: `useCases["${useCase.title}"].docsPage`,
        observed: useCase.docsPage,
        expected: 'a project with a `docs` configuration',
        remediation: 'add a `docs` block or remove the `docsPage` deep link.',
      });
      continue;
    }
    if (docsPages && !docsPages.has(useCase.docsPage)) {
      fail({
        project: project.id,
        field: `useCases["${useCase.title}"].docsPage`,
        observed: useCase.docsPage,
        expected: 'a slug present in the aggregated documentation',
        remediation:
          'point `docsPage` at an aggregated page slug (see `just data-sync` output) or re-run the docs sync.',
      });
    }
  }
}

/** Documentation must resolve for every documented, non-archived project. */
function checkDocs(
  project: ResolvedProject,
  docsManifest: DocsManifest | null,
): Set<string> | undefined {
  if (!project.docs) {
    return undefined;
  }
  if (slugifyDocFile(project.name) !== project.id) {
    fail({
      project: project.id,
      field: 'name',
      observed: project.name,
      expected: `a display name that slugifies to "${project.id}"`,
      remediation:
        'rename the project (or its id) so the per-project LLM bundle at /_llms-txt/<id>.txt resolves.',
    });
  }
  const docsProject = docsManifest?.projects.find((entry) => entry.projectId === project.id);
  const pages = new Set((docsProject?.pages ?? []).map((page) => page.slug));
  if (project.status === 'archived') {
    return pages;
  }
  if (!docsProject) {
    fail({
      project: project.id,
      field: 'docs',
      observed: 'no aggregated pages',
      expected: 'at least one page under /docs/<id>/',
      remediation: `check that ${project.docs.source} resolves on branch main, run \`just live-data-sync\`, and review the sync output.`,
    });
    return pages;
  }
  if (docsProject.pages.length === 0) {
    fail({
      project: project.id,
      field: 'docs',
      observed: '0 pages',
      expected: 'at least one page',
      remediation: 'fix the docs source/exclude configuration and re-run `just data-sync`.',
    });
  }
  if (!pages.has('index')) {
    warn({
      project: project.id,
      field: 'docs',
      observed: 'no index page',
      expected: 'a landing page at /docs/<id>/',
      remediation: 'add a conventional index.md/Home.md/readme.md or set `docs.rootPage`.',
    });
  }
  return pages;
}

/** Package declarations must resolve to published NuGet versions. */
function checkPackages(project: ResolvedProject, data: ReleaseCacheData): void {
  if (project.packages.length > 1) {
    const primaries = project.packages.filter((pkg) => pkg.primary === true);
    if (primaries.length !== 1) {
      fail({
        project: project.id,
        field: 'packages',
        observed: `${project.packages.length} packages, ${primaries.length} marked primary`,
        expected: 'exactly one package marked `primary: true`',
        remediation: 'mark the package a reader should install first.',
      });
    }
  }

  for (const pkg of project.packages) {
    const index = data.packages[pkg.id];
    if (!index) {
      warn({
        project: project.id,
        field: `packages["${pkg.id}"]`,
        observed: 'no release data',
        expected: 'a NuGet index entry',
        remediation: 'run `just fetch-releases` (or `just refresh-fixtures`) to cover the package.',
      });
      continue;
    }
    if (index.versions.length === 0) {
      fail({
        project: project.id,
        field: `packages["${pkg.id}"]`,
        observed: describeVersions(0),
        expected: 'at least one published version on NuGet',
        remediation:
          'publish the package before declaring it, or correct the package id in projects.yml.',
      });
    }
  }

  if (project.status === 'stable' && project.packages.length > 0) {
    const hasStable = project.packages.some(
      (pkg) => selectStableVersion(data.packages[pkg.id]?.versions ?? []) !== null,
    );
    if (!hasStable) {
      fail({
        project: project.id,
        field: 'status',
        observed: 'stable',
        expected: 'a stable (non-prerelease) NuGet version',
        remediation: 'set `status: preview` until a stable release ships.',
      });
    }
  }
}

/** Repository metadata is the site's tag source and a stability signal. */
function checkRepoMetadata(project: ResolvedProject, data: ReleaseCacheData): void {
  const repo = data.repos[project.repository];
  if (!repo) {
    warn({
      project: project.id,
      field: 'repository',
      observed: 'no repository metadata',
      expected: 'a GitHub repository record',
      remediation: 'run `just fetch-releases` so topics/archived/default branch can be checked.',
    });
    return;
  }

  if (repo.archived && project.status !== 'archived') {
    fail({
      project: project.id,
      field: 'status',
      observed: project.status,
      expected: 'archived',
      remediation:
        'the GitHub repository is archived; set `status: archived` (and `supersededBy`).',
    });
  }
  if (!repo.archived && project.status === 'archived') {
    fail({
      project: project.id,
      field: 'status',
      observed: 'archived',
      expected: 'stable or preview',
      remediation: 'the GitHub repository is active; correct `status`.',
    });
  }

  if (project.status !== 'archived' && repo.topics.length === 0) {
    fail({
      project: project.id,
      field: 'repository topics',
      observed: 'none',
      expected: 'topics that describe the project (they are the site tag chips)',
      remediation: `set topics on ${project.repository} — see .agents/skills/github-repo-metadata/SKILL.md.`,
    });
  }

  if (project.docs && repo.defaultBranch !== 'main') {
    fail({
      project: project.id,
      field: 'repository.default_branch',
      observed: repo.defaultBranch,
      expected: 'main',
      remediation:
        'docs aggregation always reads branch `main`; rename the default branch or move the docs.',
    });
  }

  if (project.discussions && !repo.hasDiscussions) {
    fail({
      project: project.id,
      field: 'discussions',
      observed: 'discussions: true',
      expected: 'GitHub Discussions enabled on the repository',
      remediation: 'enable Discussions, or set `discussions: false`.',
    });
  }
  if (!project.discussions && repo.hasDiscussions && project.status !== 'archived') {
    warn({
      project: project.id,
      field: 'discussions',
      observed: 'repository Discussions enabled, manifest links none',
      expected: 'consider `discussions: true`',
      remediation: `set \`discussions: true\` to surface ${project.repository}/discussions.`,
    });
  }
}

/** Collect every catalogue finding. Exported so it can be unit-tested. */
export function checkProjects(): { errors: Finding[]; warnings: Finding[] } {
  errors.length = 0;
  warnings.length = 0;

  let projects: ResolvedProject[];
  try {
    projects = loadProjects();
  } catch (error) {
    if (error instanceof ManifestValidationError) {
      fail({
        project: '(manifest)',
        field: 'schema',
        observed: 'invalid manifest',
        expected: 'a schema-valid projects.yml',
        remediation: error.message,
      });
      return { errors, warnings };
    }
    throw error;
  }

  const data = readReleaseCache() ?? readReleaseFixture('index');
  const docsManifest = readDocsManifest();
  const documented = projects.filter((project) => project.docs);
  if (!docsManifest && documented.length > 0) {
    fail({
      project: '(manifest)',
      field: 'docs',
      observed: `${documented.length} documented project(s) but no docs cache`,
      expected: 'src/.cache/docs/index.json',
      remediation: 'run `just data-sync` before `just check-projects` (or `just live-data-sync`).',
    });
  }

  const ids = new Map<string, number>();
  const orders = new Map<number, string[]>();
  for (const project of projects) {
    ids.set(project.id, (ids.get(project.id) ?? 0) + 1);
    orders.set(project.order, [...(orders.get(project.order) ?? []), project.id]);
  }
  for (const [id, count] of ids) {
    if (count > 1) {
      fail({
        project: id,
        field: 'id',
        observed: `${count} projects share this id`,
        expected: 'a unique id',
        remediation: 'give each project a distinct id.',
      });
    }
  }
  for (const [order, projectIds] of orders) {
    if (projectIds.length > 1) {
      fail({
        project: projectIds.join(', '),
        field: 'order',
        observed: `${order} used by ${projectIds.length} projects`,
        expected: 'unique order values',
        remediation: 'assign distinct order values so the catalogue order is deterministic.',
      });
    }
  }

  for (const project of projects) {
    const docsPages = checkDocs(project, docsManifest);
    checkUseCases(project, docsPages);
    if (data) {
      checkPackages(project, data);
      checkRepoMetadata(project, data);
    }
  }

  for (const external of loadExternalProjects()) {
    if (external.repository !== null && external.repository.split('/')[0] === OWNER) {
      fail({
        project: external.id,
        field: 'repository',
        observed: external.repository,
        expected: `${OWNER} projects belong in \`projects:\``,
        remediation: 'move the entry to `projects:` or link the external repository instead.',
      });
    }
  }

  return { errors, warnings };
}

function printFindings(findings: Finding[], symbol: string): void {
  for (const finding of findings) {
    console.error(`  ${symbol} [${finding.project}] ${finding.field}: ${finding.observed}`);
    console.error(`      expected: ${finding.expected}`);
    console.error(`      fix: ${finding.remediation}`);
  }
}

function run(): number {
  console.log('Checking the project catalogue...');
  const { errors: blockers, warnings: observations } = checkProjects();

  if (observations.length > 0) {
    console.warn(`${observations.length} catalogue observation(s):`);
    printFindings(observations, '!');
  }

  if (blockers.length > 0) {
    console.error(`Catalogue check failed with ${blockers.length} issue(s):`);
    printFindings(blockers, '✗');
    return 1;
  }

  const projects = loadProjects();
  console.log(
    `Catalogue check passed: ${projects.length} projects, ${loadExternalProjects().length} collaboration(s).`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(run());
}
