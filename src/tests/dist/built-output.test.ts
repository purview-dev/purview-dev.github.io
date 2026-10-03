import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LOCAL_PATH_PATTERNS, SECRET_PATTERNS } from '../../src/lib/build-paths';
import { loadProjects } from '../../src/lib/manifest/load';

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
    expect(manifest.schemaVersion).toBe(1);
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
    // The snapshot is server-rendered: no island ships for the home page.
    expect(content).not.toContain('PackageVersions');
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
