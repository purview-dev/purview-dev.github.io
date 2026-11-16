import { describe, expect, test } from 'bun:test';

import { readDocsManifest } from '../../src/lib/docs/aggregate';
import { docSectionTrail } from '../../src/lib/docs/sidebar';
import { getProjects, loadProjects } from '../../src/lib/manifest/load';
import {
  categoryPhrase,
  docsDescription,
  docsIndexTitle,
  docsPageTitle,
  firstSentence,
  humaniseTag,
  hubDescription,
  hubTitle,
  metaDescription,
  productName,
  projectPageDescription,
  projectPageTitle,
  truncate,
} from '../../src/lib/seo';

/**
 * Search metadata is derived from the catalogue, so these tests assert the two
 * things that make it worth deriving: a title leads with what a reader searches
 * for, and a documentation page always names its project.
 */

const unions = loadProjects().find((project) => project.id === 'unions');
if (!unions) {
  throw new Error('the catalogue must define unions for these tests');
}

describe('firstSentence', () => {
  test('stops at the first sentence and drops its punctuation', () => {
    expect(firstSentence('Enforce architecture policy as tests. Then more prose.')).toBe(
      'Enforce architecture policy as tests',
    );
  });

  test('returns the whole text when there is no terminator', () => {
    expect(firstSentence('Typed Aspire resource kits')).toBe('Typed Aspire resource kits');
  });

  test('collapses whitespace and handles empty input', () => {
    expect(firstSentence('  a\n  b  ')).toBe('a b');
    expect(firstSentence('   ')).toBe('');
  });
});

describe('truncate', () => {
  test('prefers a sentence boundary inside the limit', () => {
    const text = `${'a'.repeat(130)}. ${'b'.repeat(60)}`;
    expect(truncate(text, 160)).toBe(`${'a'.repeat(130)}.`);
  });

  test('falls back to the last whole word', () => {
    const text = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo';
    const result = truncate(text, 40);
    expect(result.endsWith('…')).toBe(true);
    expect(result).not.toContain('  ');
    expect(result.length).toBeLessThanOrEqual(41);
  });
});

describe('metaDescription', () => {
  test('pads a short description with the supplied context', () => {
    const result = metaDescription(
      'Zero-allocation schema validation for C#.',
      'A guide in the ZodSharp documentation — open-source .NET tooling from Purview Dev, with installation, use cases and examples on purview.dev.',
    );
    expect(result).toContain('Zero-allocation schema validation');
    expect(result).toContain('ZodSharp documentation');
    expect(result.length).toBeGreaterThanOrEqual(120);
    expect(result.length).toBeLessThanOrEqual(160);
  });

  test('never exceeds the maximum', () => {
    const result = metaDescription('word '.repeat(80));
    expect(result.length).toBeLessThanOrEqual(160);
  });
});

describe('humaniseTag', () => {
  test('maps the topic vocabulary a reader actually types', () => {
    expect(humaniseTag('c-sharp')).toBe('C#');
    expect(humaniseTag('value-types')).toBe('value types');
    expect(humaniseTag('dotnet')).toBe('.NET');
    expect(humaniseTag('opentelemetry')).toBe('OpenTelemetry');
    expect(humaniseTag('net11')).toBe('.NET 11');
  });
});

describe('categoryPhrase', () => {
  test('turns a catalogue slug into words', () => {
    expect(categoryPhrase('source-generation')).toBe('source generation');
    expect(categoryPhrase('something-new')).toBe('something new');
  });
});

describe('project metadata', () => {
  test('the product name is the primary package id', () => {
    expect(productName(unions)).toBe('Purview.Unions');
  });

  test('the title leads with the product and the searchable phrase', () => {
    const title = projectPageTitle(unions);
    expect(title.startsWith('Purview.Unions — ')).toBe(true);
    // The searched words survive the budget: "C# 15 unions", not an abbreviation.
    expect(title).toContain('C# 15 unions');
    expect(title.endsWith('| Purview Dev')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(70);
  });

  test('a project with a long name falls back to its category rather than overflowing', () => {
    const telemetry = loadProjects().find((project) => project.id === 'telemetry-sourcegenerator');
    expect(telemetry).toBeDefined();
    const title = projectPageTitle(telemetry!);
    // "Purview.Telemetry.SourceGenerator" is 34 characters on its own: the phrase
    // cannot fit, so the title stays inside the budget without losing the product.
    expect(title.startsWith('Purview.Telemetry.SourceGenerator — ')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(70);
  });

  test('a description mentions the project and stays within the limit', () => {
    const description = projectPageDescription(unions);
    // The first sentence is the substance; framework and topic detail is added
    // while there is room, and the cut prefers a sentence end (see `truncate`).
    expect(description).toContain('C#');
    expect(description.length).toBeGreaterThanOrEqual(70);
    expect(description.length).toBeLessThanOrEqual(160);
  });
});

describe('documentation metadata', () => {
  test('every title fits the budget and carries the brand', () => {
    const title = docsPageTitle({ pageTitle: 'Union design', projectName: 'Unions' });
    expect(title).toBe('Union design — Unions documentation | Purview Dev');
    expect(title.length).toBeLessThanOrEqual(70);
  });

  test('the landing page title differs from the catalogue page title', () => {
    const index = docsIndexTitle(unions);
    expect(index).toContain('Unions documentation');
    expect(index).not.toBe(projectPageTitle(unions));
    expect(index.length).toBeLessThanOrEqual(70);
  });

  test('a folder is part of the title, because it is part of the URL', () => {
    expect(
      docsPageTitle({
        pageTitle: 'Custom rules',
        projectName: 'ZodSharp',
        sectionTrail: ['Schemas'],
      }),
    ).toBe('Schemas · Custom rules — ZodSharp documentation | Purview Dev');
  });

  test('the section is dropped when the title would exceed the budget', () => {
    const options = { pageTitle: 'Step cache tests', projectName: 'Telemetry SourceGenerator' };
    const withoutSection = docsPageTitle(options);
    const withSections = docsPageTitle({
      ...options,
      sectionTrail: ['Testing', 'Reference'],
    });
    expect(withoutSection).toBe('Step cache tests — Telemetry SourceGenerator | Purview Dev');
    // The project name survives; the section and "documentation" do not.
    expect(withSections).toBe(withoutSection);
    expect(withSections.length).toBeLessThanOrEqual(70);
  });

  test('a short page title keeps the word "documentation"', () => {
    expect(docsPageTitle({ pageTitle: 'Interop', projectName: 'Unions' })).toBe(
      'Interop — Unions documentation | Purview Dev',
    );
  });

  test('a second documentation version is distinguishable by title', () => {
    const live = docsPageTitle({ pageTitle: 'Core concepts', projectName: 'ZodSharp' });
    const prerelease = docsPageTitle({
      pageTitle: 'Core concepts',
      projectName: 'ZodSharp',
      qualifier: 'Prerelease 3.0.0-prerelease.2',
    });
    expect(prerelease).not.toBe(live);
    expect(prerelease).toContain('Prerelease');
    expect(prerelease.length).toBeLessThanOrEqual(70);
  });

  test('the description names the page and the project', () => {
    const description = docsDescription({
      summary: 'Tries each option in order.',
      pageTitle: 'Union design',
      projectName: 'Unions',
    });
    expect(description).toContain('Union design');
    expect(description).toContain('Unions');
    expect(description.length).toBeLessThanOrEqual(160);
  });

  test('a passage that already fills a description is used as it stands', () => {
    // 124 characters: long enough to be the description, so the context is not
    // appended and the text is not cut.
    const summary = 'word '.repeat(25).trim();
    const description = docsDescription({
      summary,
      pageTitle: 'Union design',
      projectName: 'Unions',
    });
    expect(description).toBe(summary);
  });

  test('a long passage keeps its first sentence and fills the rest with context', () => {
    // The aggregation extracts more of the first paragraph than a description
    // holds (400 characters) precisely so this cut is available to it.
    const sentence = `${'a'.repeat(88)}.`;
    const summary = `${sentence} ${'b'.repeat(200)}`;
    const description = docsDescription({
      summary,
      pageTitle: 'Union design',
      projectName: 'Unions',
    });
    expect(description.startsWith(sentence)).toBe(true);
    expect(description).toContain('Unions');
    expect(description.length).toBeLessThanOrEqual(160);
  });
});

describe('the title policy over the real catalogue', () => {
  const manifest = readDocsManifest();
  const projects = getProjects().filter((project) => project.docs && project.status !== 'archived');

  /** Every title the site would publish for documentation, as (title, project) pairs. */
  function samples(): { title: string; projectName: string }[] {
    const result: { title: string; projectName: string }[] = [];
    for (const project of projects) {
      const entry = manifest?.projects.find((candidate) => candidate.projectId === project.id);
      const channels = entry?.channels.length ? entry.channels : [undefined];
      for (const channel of channels) {
        // The landing page carries the version; a deep page carries the family,
        // so a long version label cannot push the page title out.
        const indexQualifier = channel && !channel.default ? channel.label : undefined;
        const pageQualifier = channel && !channel.default ? 'Prerelease' : undefined;
        result.push({
          title: docsIndexTitle(project, { qualifier: indexQualifier }),
          projectName: project.name,
        });
        for (const page of channel?.pages ?? []) {
          result.push({
            title: docsPageTitle({
              pageTitle: page.title,
              projectName: project.name,
              sectionTrail: docSectionTrail(page.slug),
              qualifier: pageQualifier,
            }),
            projectName: project.name,
          });
        }
      }
    }
    return result;
  }

  const all = samples();

  test('there is something to check', () => {
    expect(projects.length).toBeGreaterThan(0);
    expect(all.length).toBeGreaterThan(50);
  });

  test('every title fits what a search result shows', () => {
    for (const { title } of all) {
      expect(title.length, `${title} (${title.length})`).toBeLessThanOrEqual(70);
    }
  });

  test('every catalogue page title fits too', () => {
    for (const project of getProjects().filter((candidate) => candidate.status !== 'archived')) {
      const title = projectPageTitle(project);
      expect(title.length, `${title} (${title.length})`).toBeLessThanOrEqual(70);
      // Whatever is trimmed, the product name is what a reader searches for.
      expect(title, title).toContain(productName(project));
    }
  });

  test('every title names the project it documents', () => {
    for (const { title, projectName } of all) {
      expect(title, title).toContain(projectName);
    }
  });
});

describe('hub metadata', () => {
  test('titles describe the collection and stay short', () => {
    expect(hubTitle('union types', 'topic')).toBe('Union types — Purview .NET projects and guides');
    expect(hubTitle('source generation', 'category')).toBe(
      'Source generation — Purview .NET projects',
    );
  });

  test('descriptions name the projects the hub indexes', () => {
    const description = hubDescription({
      label: 'C#',
      kind: 'topic',
      projectNames: ['Unions', 'ZodSharp'],
    });
    expect(description).toContain('Unions');
    expect(description).toContain('ZodSharp');
    expect(description.length).toBeLessThanOrEqual(160);
  });
});
