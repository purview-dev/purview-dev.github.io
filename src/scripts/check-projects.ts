import type { DocsManifest } from '../src/lib/docs/aggregate';
import type { ResolvedProject } from '../src/lib/manifest/load';
import type { ProjectStatus } from '../src/lib/manifest/schema';
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
import {
  diffTargetFrameworks,
  isAnalyzerTargetFramework,
  isRecognizedTargetFramework,
  normalizeTargetFramework,
  runtimeTargetFrameworks,
  sortTargetFrameworks,
  TARGET_FRAMEWORK_SENTINELS,
} from '../src/lib/releases/target-frameworks';
import { projectReleaseSummary, projectVersionRollup } from '../src/lib/releases/transform';
import { OWNER } from '../src/lib/site';

/**
 * Deterministic catalogue guard (ADR 0003).
 *
 * Proves the invariants of the catalogue (`src/src/data/projects/*.yml` plus
 * `src/src/data/external-projects.yml`) against the generated
 * docs mirror/cache and the release cache/fixtures. Offline only: it never
 * performs network I/O, so it can run inside `just validate` and CI.
 *
 * It fails (exit 1) on blockers and drift; quality observations are printed as
 * warnings so they do not break the build.
 */

/**
 * A machine-applicable correction for an advisory observation. Only the
 * manifest-editable findings carry one; blockers and judgement calls (for
 * example replacing a deprecated package) do not.
 */
export type Autofix =
  | { kind: 'set-project-target-frameworks'; value: string[] }
  | { kind: 'set-package-target-frameworks'; packageId: string; value: string[] }
  | { kind: 'set-status'; value: ProjectStatus };

export interface Finding {
  project: string;
  field: string;
  observed: string;
  expected: string;
  remediation: string;
  /** A fix `just fix-projects` can apply, when the observation is unambiguous. */
  autofix?: Autofix;
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

/**
 * The `experimental` flag is an intent marker, so it stays orthogonal to the
 * release channel (ADR 0004). The one combination that is legal but worth a
 * second look is a stable release: the flag says "exploratory" while the
 * channel says "recommended for use". The contradictory pairing
 * (`experimental` with `status: archived`) is rejected by the manifest schema
 * before this runs, so it needs no rule here.
 */
function checkExperimental(project: ResolvedProject): void {
  if (!project.experimental || project.status !== 'stable') {
    return;
  }
  warn({
    project: project.id,
    field: 'experimental',
    observed: 'true with status: stable',
    expected: 'an experimental project normally publishes prereleases only',
    remediation:
      'confirm the intent; if the project is still an experiment, `status: preview` is the honest release channel.',
  });
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
          'publish the package before declaring it, or correct the package id in the project file.',
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

function joinDiff(diff: { missing: string[]; extra: string[] }): string {
  return [
    diff.missing.length > 0 ? `missing ${diff.missing.join(', ')}` : null,
    diff.extra.length > 0 ? `extra ${diff.extra.join(', ')}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join('; ');
}

/**
 * A project's declared release channel and package health should agree with what
 * it has actually published. These are recommendations rather than blockers: a
 * project may deliberately stay `preview`, but the mismatch is worth surfacing.
 * Exported so the rules can be unit-tested against synthetic release data.
 */
export function versionConsistencyFindings(
  project: ResolvedProject,
  data: ReleaseCacheData,
): Finding[] {
  const findings: Finding[] = [];
  if (project.status === 'archived') {
    return findings;
  }

  if (project.status === 'preview' && !project.experimental) {
    const stablePackage = project.packages.find(
      (pkg) => selectStableVersion(data.packages[pkg.id]?.versions ?? []) !== null,
    );
    if (stablePackage) {
      findings.push({
        project: project.id,
        field: 'status',
        observed: `preview while a stable NuGet version of ${stablePackage.id} exists`,
        expected: 'status: stable once a stable release ships',
        remediation:
          'confirm the channel: set `status: stable` if the release is supported, or keep `preview` and record why.',
        autofix: { kind: 'set-status', value: 'stable' },
      });
    }
  }

  for (const pkg of project.packages) {
    const search = data.packageSearch[pkg.id];
    if (search?.deprecated) {
      findings.push({
        project: project.id,
        field: `packages["${pkg.id}"]`,
        observed: 'deprecated on NuGet',
        expected: 'a package that is still recommended',
        remediation: 'replace the deprecated package or mark the project archived/superseded.',
      });
    }
    if (search && search.listed === false) {
      findings.push({
        project: project.id,
        field: `packages["${pkg.id}"]`,
        observed: 'unlisted on NuGet',
        expected: 'a listed package',
        remediation: 'list the package on NuGet or remove it from the catalogue.',
      });
    }
  }

  const rollup = projectVersionRollup(project, projectReleaseSummary(project, data, 'cache'));
  if (rollup.laggingPackageCount > 0) {
    findings.push({
      project: project.id,
      field: 'packages',
      observed: `${rollup.laggingPackageCount} package(s) trail the headline version`,
      expected: 'packages published together at the project version',
      remediation:
        'publish the lagging packages at the current version, or confirm the split is intentional.',
    });
  }

  return findings;
}

/**
 * Target frameworks should describe what the published packages actually
 * support. Analyzer/source-generator packages (`netstandard*`) are treated
 * separately: their framework is a build-time target, not a consumer framework,
 * so a project whose packages are all analyzers is not compared against them.
 * Exported so the rules can be unit-tested against synthetic release data.
 */
export function targetFrameworkFindings(
  project: ResolvedProject,
  data: ReleaseCacheData,
): Finding[] {
  const findings: Finding[] = [];
  const declaredProject = project.targetFrameworks ?? [];

  for (const { field, values } of [
    { field: 'targetFrameworks', values: declaredProject },
    ...project.packages.map((pkg) => ({
      field: `packages["${pkg.id}"].targetFrameworks`,
      values: pkg.targetFrameworks ?? [],
    })),
  ]) {
    for (const value of values) {
      if (!isRecognizedTargetFramework(value)) {
        findings.push({
          project: project.id,
          field,
          observed: value,
          expected: 'a valid TFM such as net8.0, net10.0, netstandard2.0, or the msbuild sentinel',
          remediation: 'correct the framework moniker or remove it.',
        });
      }
    }
  }

  const published = new Map<string, string[]>();
  for (const pkg of project.packages) {
    const frameworks = data.packages[pkg.id]?.targetFrameworks;
    if (frameworks && frameworks.length > 0) {
      published.set(pkg.id, frameworks);
    }
  }
  if (published.size === 0) {
    return findings;
  }

  const sentinels = new Set<string>(TARGET_FRAMEWORK_SENTINELS);
  const sentinelOnly =
    declaredProject.length > 0 &&
    declaredProject.every((value) => sentinels.has(normalizeTargetFramework(value)));
  const skipEquality =
    project.install === 'msbuild-sdk' || project.install === 'dotnet-tool' || sentinelOnly;

  const expectedRuntime = new Set(
    [...published].flatMap(([, frameworks]) =>
      frameworks.filter((tfm) => !isAnalyzerTargetFramework(tfm)).map(normalizeTargetFramework),
    ),
  );

  if (!skipEquality) {
    const declaredRuntime = runtimeTargetFrameworks(declaredProject, { excludeAnalyzer: true });
    if (declaredProject.length === 0) {
      if (expectedRuntime.size > 0) {
        findings.push({
          project: project.id,
          field: 'targetFrameworks',
          observed: 'none',
          expected: `the frameworks the packages target (${sortTargetFrameworks(expectedRuntime).join(', ')})`,
          remediation: 'declare the project targetFrameworks shown on the project page.',
          autofix: {
            kind: 'set-project-target-frameworks',
            value: sortTargetFrameworks(expectedRuntime),
          },
        });
      }
    } else if (expectedRuntime.size > 0) {
      const diff = diffTargetFrameworks(declaredRuntime, [...expectedRuntime]);
      if (diff.missing.length > 0 || diff.extra.length > 0) {
        findings.push({
          project: project.id,
          field: 'targetFrameworks',
          observed: `${sortTargetFrameworks(declaredRuntime).join(', ') || 'none'} (${joinDiff(diff)})`,
          expected: `the union of the runtime packages' frameworks (${sortTargetFrameworks(expectedRuntime).join(', ')})`,
          remediation:
            'align the project targetFrameworks with the packages, or add a package-level override.',
          autofix: {
            kind: 'set-project-target-frameworks',
            value: sortTargetFrameworks(expectedRuntime),
          },
        });
      }
    }

    for (const [packageId, frameworks] of published) {
      const declared = project.packages.find((pkg) => pkg.id === packageId)?.targetFrameworks ?? [];
      if (declared.length > 0) {
        const diff = diffTargetFrameworks(runtimeTargetFrameworks(declared), frameworks);
        if (diff.missing.length > 0 || diff.extra.length > 0) {
          findings.push({
            project: project.id,
            field: `packages["${packageId}"].targetFrameworks`,
            observed: `${sortTargetFrameworks(declared).join(', ')} (${joinDiff(diff)})`,
            expected: `the published frameworks (${sortTargetFrameworks(frameworks).join(', ')})`,
            remediation:
              'correct the package targetFrameworks, or remove them to inherit the project list.',
            autofix: {
              kind: 'set-package-target-frameworks',
              packageId,
              value: sortTargetFrameworks(frameworks),
            },
          });
        }
        continue;
      }
      const packageRuntime = frameworks.filter((tfm) => !isAnalyzerTargetFramework(tfm));
      const runtimeDiverges = packageRuntime.some(
        (tfm) => !expectedRuntime.has(normalizeTargetFramework(tfm)),
      );
      const analyzerOnly = packageRuntime.length === 0 && expectedRuntime.size > 0;
      if (runtimeDiverges || analyzerOnly) {
        findings.push({
          project: project.id,
          field: `packages["${packageId}"]`,
          observed: `targets ${sortTargetFrameworks(frameworks).join(', ')} without a package-level targetFrameworks`,
          expected:
            expectedRuntime.size > 0
              ? `the project frameworks (${sortTargetFrameworks(expectedRuntime).join(', ')})`
              : 'the project targetFrameworks',
          remediation: 'add `targetFrameworks` to the package, or align it with the project.',
          autofix: {
            kind: 'set-package-target-frameworks',
            packageId,
            value: sortTargetFrameworks(frameworks),
          },
        });
      }
    }
  }

  return findings;
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
        'the GitHub repository is archived; set `status: archived`, remove `experimental: true` if present, and add `supersededBy` when a successor exists.',
    });
  }
  if (!repo.archived && project.status === 'archived') {
    fail({
      project: project.id,
      field: 'status',
      observed: 'archived',
      expected: 'stable, preview or experimental',
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
        expected: 'a schema-valid project record',
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
    checkExperimental(project);
    if (data) {
      checkPackages(project, data);
      checkRepoMetadata(project, data);
      for (const finding of versionConsistencyFindings(project, data)) {
        warn(finding);
      }
      for (const finding of targetFrameworkFindings(project, data)) {
        warn(finding);
      }
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
