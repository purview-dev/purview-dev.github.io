import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LOCAL_PATH_PATTERNS, SECRET_PATTERNS } from '../../src/lib/build-paths';
import { DISCOVERY_MANIFEST_SCHEMA_VERSION } from '../../src/lib/discovery/types';
import { readDocsManifest } from '../../src/lib/docs/aggregate';
import { channelDisplayLabel } from '../../src/lib/docs/channels';
import { buildLlmsDetails } from '../../src/lib/llms-details';
import { loadProjects } from '../../src/lib/manifest/load';
import { compareNuGetVersions } from '../../src/lib/nuget-version';
import { getReleaseIndex } from '../../src/lib/releases/runtime';
import { projectReleaseSummary } from '../../src/lib/releases/transform';

const DIST = resolve('dist');

function requireBuilt(file: string): string {
  const path = resolve(DIST, file);
  if (!existsSync(path)) {
    throw new Error(`Required build output missing: ${file}. Run \`just build\` first.`);
  }
  return readFileSync(path, 'utf8');
}

describe('built llms outputs', () => {
  test('all three llms files exist', () => {
    expect(existsSync(resolve(DIST, 'llms.txt'))).toBe(true);
    expect(existsSync(resolve(DIST, 'llms-small.txt'))).toBe(true);
    expect(existsSync(resolve(DIST, 'llms-full.txt'))).toBe(true);
  });

  test('llms.txt uses canonical production URLs', () => {
    const content = requireBuilt('llms.txt');
    expect(content).toContain('https://purview.dev/llms-small.txt');
    expect(content).toContain('https://purview.dev/llms-full.txt');
    expect(content).toContain('https://github.com/purview-dev');
  });

  test('llms.txt suite narrative is generated from the catalogue', () => {
    const content = requireBuilt('llms.txt');
    // The narrative must be exactly what the generator produces, so it cannot
    // drift from the published projects or be hand-edited back into the config.
    for (const paragraph of buildLlmsDetails(loadProjects()).split('\n\n')) {
      expect(content, `llms.txt is missing generated paragraph: ${paragraph}`).toContain(paragraph);
    }
  });

  test('llms-full.txt includes aggregated documentation content', () => {
    const content = requireBuilt('llms-full.txt');
    expect(content.trim().length).toBeGreaterThan(10_000);
    expect(content).toContain('Purview');
  });

  test('llms outputs exclude secrets and local build paths', () => {
    const content = [
      requireBuilt('llms.txt'),
      requireBuilt('llms-small.txt'),
      requireBuilt('llms-full.txt'),
    ].join('\n');
    for (const pattern of SECRET_PATTERNS) {
      expect(content, `llms outputs match secret pattern ${pattern}`).not.toMatch(pattern);
    }
    for (const pattern of LOCAL_PATH_PATTERNS) {
      expect(content, `llms outputs match local path pattern ${pattern}`).not.toMatch(pattern);
    }
  });
});

describe('built per-project llms outputs', () => {
  const docsProjects = loadProjects().filter(
    (project) => project.docs && project.status !== 'archived',
  );

  // The discovery integration emits a concise and a full machine-readable bundle
  // for every documented, non-archived project at the llms.txt convention path
  // under /projects/<id>/. The UI links to those exact paths.
  test('both bundles are built for every documented project', () => {
    expect(docsProjects.length).toBeGreaterThan(0);
    for (const project of docsProjects) {
      const summary = requireBuilt(`projects/${project.id}/llms.txt`);
      expect(summary.trim().length, `${project.id} llms.txt is empty`).toBeGreaterThan(0);
      expect(summary, `${project.id} llms.txt lacks the project name`).toContain(project.name);
      const full = requireBuilt(`projects/${project.id}/llms-full.txt`);
      expect(full.trim().length, `${project.id} llms-full.txt is empty`).toBeGreaterThan(0);
      expect(full, `${project.id} llms-full.txt lacks aggregated content`).toContain('Purview');
    }
  });

  test('the llms.txt entrypoint links every project bundle', () => {
    const content = requireBuilt('llms.txt');
    for (const project of docsProjects) {
      expect(content, `llms.txt does not link ${project.id}`).toContain(
        `https://purview.dev/projects/${project.id}/llms.txt`,
      );
    }
  });

  test('scoped bundles exclude secrets and local build paths', () => {
    for (const project of docsProjects) {
      const content = [
        requireBuilt(`projects/${project.id}/llms.txt`),
        requireBuilt(`projects/${project.id}/llms-full.txt`),
      ].join('\n');
      for (const pattern of SECRET_PATTERNS) {
        expect(content, `${project.id} bundle matches secret pattern ${pattern}`).not.toMatch(
          pattern,
        );
      }
      for (const pattern of LOCAL_PATH_PATTERNS) {
        expect(content, `${project.id} bundle matches local path pattern ${pattern}`).not.toMatch(
          pattern,
        );
      }
    }
  });
});
describe('built project pages', () => {
  test('the ZodSharp project page credits its upstream work', () => {
    const content = requireBuilt('projects/zodsharp/index.html');
    expect(content).toContain('Acknowledgments');
    expect(content).toContain('https://github.com/colinhacks/zod');
    expect(content).toContain('https://github.com/guinhx/ZodSharp');
  });

  test('the Where it fits panels use theme-aware classes', () => {
    const content = requireBuilt('projects/zodsharp/index.html');
    expect(content).toContain('class="pv-fit-panel rounded-xl p-5"');
    expect(content).toContain('class="pv-avoid-panel rounded-xl p-5"');
    // The previous utilities mixed against transparency rather than against
    // --color-surface, so the tint vanished in dark mode and the two panels
    // became indistinguishable.
    expect(content).not.toContain('border-brand/20 bg-brand/5 p-5');
  });
});

describe('built GitHub links and star calls to action', () => {
  test('project pages link to the repository and invite a star', () => {
    const content = requireBuilt('projects/event-sourcing/index.html');
    expect(content).toContain('https://github.com/purview-dev/event-sourcing');
    expect(content).toContain('Star on GitHub');
  });

  test('documentation pages link to the repository and invite a star', () => {
    const content = requireBuilt('docs/event-sourcing/index.html');
    expect(content).toContain('https://github.com/purview-dev/event-sourcing');
    expect(content).toContain('Star on GitHub');
  });
});

describe('built docs strip mkdocs markup', () => {
  // `containers` still publishes a mkdocs Material site, whose attr_list
  // buttons (`[x](y){ .md-button }`) rendered as literal text through the
  // portal. `src/lib/docs/mkdocs.ts` strips them during aggregation.
  test('aggregated pages render no mkdocs-only markup', () => {
    const content = requireBuilt('docs/containers/index.html');
    expect(content).not.toContain('md-button');
    expect(content).toContain('/docs/containers/getting-started/');
  });
});

describe('built agent skills', () => {
  test('skills live with their project, and the old list page redirects', () => {
    // `/skills/` was a site-wide list out of context; each project page now owns
    // its skills, so the old URL forwards to the catalogue instead of 404ing.
    const redirect = requireBuilt('skills/index.html');
    expect(redirect).toContain('http-equiv="refresh" content="0; url=/projects/"');
    expect(redirect).toContain('name="robots" content="noindex, follow"');

    const manifest = JSON.parse(requireBuilt('skills.json')) as {
      schema: number;
      projects: {
        id: string;
        install: { command: string; commands: { id: string; command: string }[] };
        skills: { name: string; description: string | null; url: string }[];
      }[];
    };
    expect(manifest.schema).toBe(2);
    const pmSkills = manifest.projects.find((project) => project.id === 'pm-skills');
    expect(pmSkills?.skills.length).toBe(14);
    expect(pmSkills?.install.command).toBe('npx skills add purview-dev/pm-skills');
    expect(pmSkills?.install.commands.map((command) => command.id)).toEqual([
      'npm',
      'bun',
      'pnpm',
      'yarn',
    ]);
    expect(pmSkills?.skills[0]?.url).toStartWith('https://purview.dev/skills/pm-skills/');

    // A folded (`description: >-`) skill still reports its prose description.
    const zodsharp = manifest.projects.find((project) => project.id === 'zodsharp');
    expect(zodsharp?.skills.length).toBeGreaterThan(0);
    expect(
      zodsharp?.skills.every((skill) => skill.description !== null && skill.description !== '>-'),
    ).toBe(true);
  });

  test('every declared skill is served from purview.dev', () => {
    expect(requireBuilt('skills/pm-skills/pm-park/SKILL.md')).toContain('pm-park');
    expect(requireBuilt('skills/results/purview-results-core/SKILL.md')).toContain(
      'purview-results-core',
    );
  });

  test('the project page lists its skills with descriptions', () => {
    const page = requireBuilt('projects/results/index.html');
    expect(page).toContain('id="agent-skills"');
    expect(page).toContain('purview-results-core');
    // The description comes from the skill's own front matter.
    expect(page).toMatch(/purview-results-core[\s\S]{0,400}text-muted/);
  });

  test('every package manager is shown as copyable Expressive Code', () => {
    const page = requireBuilt('projects/results/index.html');
    for (const command of [
      'npx skills add purview-dev/results',
      'bunx skills add purview-dev/results',
      'pnpm dlx skills add purview-dev/results',
      'yarn dlx skills add purview-dev/results',
    ]) {
      expect(page).toContain(command);
    }
    // Expressive Code renders a copy button per command, so the reader pastes
    // instead of retyping. `data-code` is the exact text it copies.
    expect(page).toContain('title="Copy to clipboard"');
    expect(page).toContain('data-code="bunx skills add purview-dev/results"');
    expect(page).toContain('data-code="pnpm dlx skills add purview-dev/results"');
  });
});

describe('built use cases', () => {
  test('project pages render a use-case section with concrete code', () => {
    const content = requireBuilt('projects/telemetry-sourcegenerator/index.html');
    expect(content).toContain('Use cases');
    expect(content).toContain('IOrderServiceTelemetry');
    expect(content).toContain('pv-code-frame');
    expect(content).toContain('What you get:');
    // Shiki (Astro's built-in <Code>) highlights the snippet at build time.
    expect(content).toContain('astro-code');
    expect(content).toContain('data-language="csharp"');
    // Long lines wrap rather than producing a horizontal scrollbar.
    expect(content).toContain('white-space: pre-wrap');
  });

  test('the home page shows what it looks like in practice', () => {
    const content = requireBuilt('index.html');
    expect(content).toContain('What it looks like in practice');
    expect(content).toContain('/use-cases/');
  });

  test('the use-cases page lists filterable, audience-tagged examples', () => {
    const content = requireBuilt('use-cases/index.html');
    expect(content).toContain('All audiences');
    expect(content).toContain('data-usecase-audience="developer"');
    expect(content).toContain('data-usecase-search=');
  });

  test('deep-linked use cases resolve to real docs paths', () => {
    // Existence of the target page is enforced by the post-build link crawl
    // (`just check-links`); this guards the rendered link shape.
    const content = requireBuilt('projects/event-sourcing/index.html');
    expect(content).toContain('/docs/event-sourcing/sql-server-guide/');
  });
});

describe('built package versions', () => {
  test('a package prerelease that trails its stable release is withheld', () => {
    const telemetry = loadProjects().find((project) => project.id === 'telemetry-sourcegenerator');
    expect(telemetry).toBeDefined();
    const index = getReleaseIndex();
    const summary = projectReleaseSummary(telemetry!, index.data, index.source);
    const pkg = summary.packages.find(
      (entry) => entry.packageId === 'Purview.Telemetry.SourceGenerator',
    );
    expect(pkg?.latestStable).not.toBeNull();
    expect(pkg?.latestPrerelease).not.toBeNull();
    // The package is a trailing prerelease (e.g. 5.0.0-prerelease.19 beside
    // stable 5.0.2), so the table must not advertise it as a current version.
    expect(compareNuGetVersions(pkg!.latestPrerelease!, pkg!.latestStable!)).toBeLessThan(0);
    const content = requireBuilt('projects/telemetry-sourcegenerator/index.html');
    expect(content).not.toContain(pkg!.latestPrerelease!);
  });

  test('a package with only prereleases is still listed', () => {
    // Purview.ZodSharp.Http has never published a stable version. The package
    // listing is not a stable-only view: the stable cell is empty and the
    // prerelease version is shown (and pinned in its install snippet).
    const zodsharp = loadProjects().find((project) => project.id === 'zodsharp');
    expect(zodsharp).toBeDefined();
    const index = getReleaseIndex();
    const summary = projectReleaseSummary(zodsharp!, index.data, index.source);
    const pkg = summary.packages.find((entry) => entry.packageId === 'Purview.ZodSharp.Http');
    expect(pkg).toBeDefined();
    expect(pkg?.latestStable).toBeNull();
    expect(pkg?.latestPrerelease).toBe('3.0.0-prerelease.2');

    const content = requireBuilt('projects/zodsharp/index.html');
    expect(content).toContain('Purview.ZodSharp.Http');
    expect(content).toContain('3.0.0-prerelease.2');
  });
});

describe('built llms links', () => {
  // The LLM text bundles are plain files rather than site pages, so every link
  // to one must opt into the external-link treatment.
  test('every llms text link opens in a new tab like an external link', () => {
    const { glob } = require('fast-glob');
    const files = glob.sync('**/*.html', { cwd: DIST });
    const anchor = /<a\b[^>]*href="[^"]*llms(?:-small|-full)?\.txt"[^>]*>/g;

    let checked = 0;
    for (const file of files) {
      const content = readFileSync(resolve(DIST, file), 'utf8');
      for (const tag of content.match(anchor) ?? []) {
        checked += 1;
        expect(tag, `${file}: ${tag}`).toContain('target="_blank"');
        expect(tag, `${file}: ${tag}`).toContain('rel="noopener noreferrer"');
      }
    }

    // Guard against the assertions silently passing if the regex stops matching.
    expect(checked).toBeGreaterThan(0);
  });
});

describe('built SEO outputs', () => {
  test('sitemap index references the partitioned child sitemaps', () => {
    const content = requireBuilt('sitemap-index.xml');
    expect(content).toContain('https://purview.dev/sitemaps/pages.xml');
    expect(content).toContain('https://purview.dev/sitemaps/projects.xml');
    expect(content).toContain('https://purview.dev/sitemaps/llms.xml');
  });

  test('robots.txt references the sitemap index', () => {
    const content = requireBuilt('robots.txt');
    expect(content).toContain('Sitemap: https://purview.dev/sitemap-index.xml');
  });

  test('discover.json is generated and references the canonical site', () => {
    const manifest = JSON.parse(requireBuilt('discover.json')) as {
      schemaVersion: number;
      url: string;
      sitemaps: { index: string };
      resources: unknown[];
      projects: { slug: string }[];
    };
    expect(manifest.schemaVersion).toBe(DISCOVERY_MANIFEST_SCHEMA_VERSION);
    expect(manifest.url).toBe('https://purview.dev/');
    expect(manifest.sitemaps.index).toBe('https://purview.dev/sitemap-index.xml');
    expect(manifest.resources.length).toBeGreaterThan(0);
    expect(manifest.projects.length).toBeGreaterThan(0);
  });

  test('project pages expose their machine-readable representation', () => {
    const content = requireBuilt('projects/zodsharp/index.html');
    expect(content).toContain('rel="alternate"');
    expect(content).toContain('https://purview.dev/projects/zodsharp/llms-full.txt');
    expect(content).toContain('/projects/zodsharp/llms.txt');
    expect(content).toContain('"@type":"SoftwareSourceCode"');
  });

  test('key brand assets are present in the build', () => {
    for (const file of [
      'favicon.svg',
      'favicon-32.png',
      'apple-touch-icon.png',
      'og/default.png',
      'site.webmanifest',
    ]) {
      expect(existsSync(resolve(DIST, file)), `missing ${file}`).toBe(true);
    }
  });
});

describe('built HTML safety', () => {
  test('no local paths or secrets leak into generated pages', () => {
    const { glob } = require('fast-glob');
    const files = glob.sync('**/*.html', { cwd: DIST });
    for (const file of files) {
      const content = readFileSync(resolve(DIST, file), 'utf8');
      for (const pattern of LOCAL_PATH_PATTERNS) {
        expect(content, `${file} matches local path pattern ${pattern}`).not.toMatch(pattern);
      }
      for (const pattern of SECRET_PATTERNS) {
        expect(content, `${file} matches secret pattern ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});

describe('built home-page version snapshot', () => {
  test('renders one rolled-up version row per active project', () => {
    const content = requireBuilt('index.html');
    const rows = content.match(/data-project-id="[^"]+"/g) ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(8);
    // The per-package table (and its legacy filter hook) moved to /releases/.
    expect(content).not.toContain('data-package-project');
    expect(content).not.toContain('PackageVersions');
    // The rows are server-rendered with the build-time versions, and the page
    // also ships the payload and script the browser uses to re-check NuGet, so a
    // published version appears without a redeploy (ADR 0008).
    expect(content).toContain('pv-version-badge');
    expect(content).toContain('id="pv-version-data"');
  });
});

describe('built footer version', () => {
  test('homepage footer shows the workspace root version', () => {
    const manifest = JSON.parse(readFileSync(resolve('..', 'package.json'), 'utf8')) as {
      version?: string;
    };
    const version = manifest.version;
    expect(version).toBeTruthy();

    const content = requireBuilt('index.html');
    expect(content).toContain(`>\nv${version} <`);
    expect(content).toContain('https://github.com/purview-dev/purview-dev.github.io/releases');
  });
});

describe('built documentation channels', () => {
  // ADR 0009: a project publishes a live channel (canonical URLs) and, while a
  // prerelease line is in flight, a second channel at `/docs/<id>/prerelease/`.
  // Promotion is automatic, so this block has to hold in *both* worlds: the
  // two-channel assertions run only while that channel exists, and the promoted
  // shape — no switcher at all, retired URLs redirecting — is asserted instead of
  // being assumed away. Labels come from the docs cache, so nothing hard-codes
  // the current release.
  const manifest = readDocsManifest();
  const zodsharp = manifest?.projects.find((project) => project.projectId === 'zodsharp');
  const live = zodsharp?.channels.find((channel) => channel.default);
  const prerelease = zodsharp?.channels.find((channel) => !channel.default);
  const prereleaseIndex = 'docs/zodsharp/prerelease/index.html';

  test('ZodSharp publishes its live channel, and a prerelease tree only while that line is in flight', () => {
    expect(live?.pages.length ?? 0).toBeGreaterThan(0);
    expect(existsSync(resolve(DIST, 'docs/zodsharp/index.html'))).toBe(true);
    if (prerelease) {
      expect(prerelease.pages.length).toBeGreaterThan(0);
      // A published channel owns its URLs: no redirect may shadow it.
      expect(requireBuilt(prereleaseIndex)).not.toContain('http-equiv="refresh"');
    }
  });

  test.skipIf(!prerelease)('each documentation version is its own sidebar topic', () => {
    // Versions are distinct sidebar entries, not groups inside one project
    // topic: the same product, two documentation sets. The topic picker lists
    // both, each pointing at its own landing page.
    const content = requireBuilt(prereleaseIndex);
    expect(content).toContain(`ZodSharp ${live!.label}`);
    expect(content).toContain(`ZodSharp ${prerelease!.label}`);
    expect(content).toContain('value="/docs/zodsharp/"');
    expect(content).toContain('value="/docs/zodsharp/prerelease/"');
  });

  test.skipIf(!prerelease)('each documentation version publishes its own llms bundles', () => {
    for (const file of [
      'projects/zodsharp/llms.txt',
      'projects/zodsharp/llms-full.txt',
      'projects/zodsharp/prerelease/llms.txt',
      'projects/zodsharp/prerelease/llms-full.txt',
    ]) {
      expect(existsSync(resolve(DIST, file))).toBe(true);
    }
    // Every bundle names the version it documents...
    expect(requireBuilt('projects/zodsharp/llms.txt')).toContain(`- Version: ${live!.version}`);
    const prereleaseFull = requireBuilt('projects/zodsharp/prerelease/llms-full.txt');
    expect(prereleaseFull).toContain(`- Version: ${prerelease!.version}`);
    expect(prereleaseFull).toContain('/docs/zodsharp/prerelease/');
    // ...and carries one version's pages only, so a model cannot mix them.
    expect(requireBuilt('projects/zodsharp/llms-full.txt')).not.toContain(
      '/docs/zodsharp/prerelease/',
    );
    // discover.json describes each version as its own docs site.
    const discover = JSON.parse(requireBuilt('discover.json')) as {
      projects: { slug: string; docsChannels: { id: string; llms: { summary: string } }[] }[];
    };
    const zodsharpEntry = discover.projects.find((project) => project.slug === 'zodsharp');
    expect(zodsharpEntry?.docsChannels.map((channel) => channel.id)).toEqual([
      'live',
      'prerelease',
    ]);
    expect(zodsharpEntry?.docsChannels[1]?.llms.summary).toBe(
      'https://purview.dev/projects/zodsharp/prerelease/llms.txt',
    );
  });

  test.skipIf(!prerelease)('each version overview links its own machine-readable bundles', () => {
    // The overview page of a version advertises that version's bundle, not the
    // project's default one: the link follows the docs the reader is reading.
    const prereleaseContent = requireBuilt(prereleaseIndex);
    expect(prereleaseContent).toContain('href="/projects/zodsharp/prerelease/llms.txt"');
    expect(prereleaseContent).toContain('href="/projects/zodsharp/prerelease/llms-full.txt"');
    const liveContent = requireBuilt('docs/zodsharp/index.html');
    expect(liveContent).toContain('href="/projects/zodsharp/llms.txt"');
    expect(liveContent).not.toContain('href="/projects/zodsharp/prerelease/llms.txt"');
  });

  test.skipIf(!prerelease)('the live page offers the prerelease channel', () => {
    const content = requireBuilt('docs/zodsharp/index.html');
    expect(content).toContain('/docs/zodsharp/prerelease/');
    expect(content).toContain(channelDisplayLabel(live!));
    expect(content).toContain(channelDisplayLabel(prerelease!));
  });

  test.skipIf(!prerelease)('a prerelease page says so and links back to the live channel', () => {
    const content = requireBuilt(prereleaseIndex);
    expect(content).toContain('Prerelease.');
    expect(content).toContain('href="/docs/zodsharp/"');
  });

  test.skipIf(!prerelease)('the channel switcher is a drop-down that names each version', () => {
    const content = requireBuilt('docs/zodsharp/index.html');
    // A native disclosure keeps every version reachable without JavaScript, and
    // each option stays a real link.
    expect(content).toContain('class="doc-channel-menu');
    expect(content).toContain('<summary');
    expect(content).toContain('class="doc-channel-options');
    // The option names the version the branch ships — not the branch — and the
    // branch stays available as the tooltip.
    expect(channelDisplayLabel(prerelease!)).not.toContain('main');
    expect(content).toContain(channelDisplayLabel(prerelease!));
    expect(content).toContain(`title="Documentation from ${prerelease!.ref}"`);
  });

  test.skipIf(prerelease !== undefined)(
    'a promoted channel leaves nothing of itself in the UI',
    () => {
      // The line shipped, so the channel is withheld: the switcher has to disappear
      // rather than advertise a version that no longer exists, and the live page
      // must not link the retired tree.
      const content = requireBuilt('docs/zodsharp/index.html');
      expect(content).not.toContain('doc-channel-menu');
      expect(content).not.toContain('/docs/zodsharp/prerelease/');
      expect(content).not.toContain('Prerelease ');
      // One channel means one tree: the sidebar keeps its flat list, and the docs
      // landing page stops counting versions.
      expect(content).not.toContain('Live 2');
      expect(requireBuilt('docs/index.html')).not.toContain('2 versions');
    },
  );

  test.skipIf(prerelease !== undefined)(
    'a promoted channel redirects its retired URLs to the live pages',
    () => {
      const redirect = requireBuilt(prereleaseIndex);
      expect(redirect).toContain('<meta http-equiv="refresh" content="0; url=/docs/zodsharp/"');
      expect(redirect).toContain('<link rel="canonical" href="https://purview.dev/docs/zodsharp/"');
      expect(redirect).toContain('<meta name="robots" content="noindex, follow"');
      expect(redirect).toContain('data-pagefind-ignore');
      // A deep page keeps its slug, so an old bookmark still lands on that page.
      expect(requireBuilt('docs/zodsharp/prerelease/core-concepts/index.html')).toContain(
        'url=/docs/zodsharp/core-concepts/',
      );
    },
  );

  test('the single-channel projects keep the canonical layout', () => {
    // Event Sourcing declares no channels, so it must not grow a second tree.
    expect(existsSync(resolve(DIST, 'docs/event-sourcing/index.html'))).toBe(true);
    expect(existsSync(resolve(DIST, 'docs/event-sourcing/prerelease'))).toBe(false);
  });
});
