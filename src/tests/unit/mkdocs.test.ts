import { describe, expect, test } from 'bun:test';

import { stripMkdocsMarkup } from '../../src/lib/docs/mkdocs';

describe('stripMkdocsMarkup', () => {
  test('drops Material attr_list from button links', () => {
    const markdown = [
      '[Get started](getting-started/){ .md-button .md-button--primary }',
      '[Choose a backend](backends/){ .md-button }',
    ].join('\n');
    const cleaned = stripMkdocsMarkup(markdown);
    expect(cleaned).toContain('[Get started](getting-started/)');
    expect(cleaned).toContain('[Choose a backend](backends/)');
    expect(cleaned).not.toContain('md-button');
  });

  test('drops inline attr_list from images and headings', () => {
    const markdown = [
      '![the dashboard](dashboard.png){ align=right }',
      '# Getting started { #custom-id }',
    ].join('\n');
    const cleaned = stripMkdocsMarkup(markdown);
    expect(cleaned).toContain('![the dashboard](dashboard.png)');
    expect(cleaned).toContain('# Getting started');
    expect(cleaned).not.toContain('align=right');
    expect(cleaned).not.toContain('custom-id');
  });

  test('removes a standalone attr_list line', () => {
    const cleaned = stripMkdocsMarkup(['Paragraph.', '', '{: .lead }', '', 'Next.'].join('\n'));
    expect(cleaned).not.toContain('.lead');
    expect(cleaned).toContain('Paragraph.');
    expect(cleaned).toContain('Next.');
  });

  test('removes TechDocs/Jinja macros and snippet includes', () => {
    const markdown = [
      '{% include "snippets/note.md" %}',
      'Version: {{ version }}',
      '--8<-- "snippets/prereqs.md"',
      'Keep this line.',
    ].join('\n');
    const cleaned = stripMkdocsMarkup(markdown);
    expect(cleaned).not.toContain('{%');
    expect(cleaned).not.toContain('{{');
    expect(cleaned).not.toContain('--8<--');
    expect(cleaned).toContain('Keep this line.');
  });

  test('converts mkdocs admonitions to Starlight asides', () => {
    const markdown = [
      '!!! note "Before you start"',
      '    The first line.',
      '',
      '    The second line.',
      '',
      'After the admonition.',
    ].join('\n');
    const cleaned = stripMkdocsMarkup(markdown);
    expect(cleaned).toContain(':::note[Before you start]');
    expect(cleaned).toContain('The first line.');
    expect(cleaned).toContain('The second line.');
    expect(cleaned).toContain(':::');
    expect(cleaned).not.toContain('!!!');
    expect(cleaned).toContain('After the admonition.');
  });

  test('maps the details and warning admonition variants', () => {
    const details = stripMkdocsMarkup(['??? tip "Bonus"', '    Hidden detail.'].join('\n'));
    expect(details).toContain(':::tip[Bonus]');
    expect(details).toContain('Hidden detail.');

    const warning = stripMkdocsMarkup(['!!! warning', '    Take care.'].join('\n'));
    expect(warning).toContain(':::caution');
    expect(warning).toContain('Take care.');
  });

  test('preserves attribute-looking braces inside fenced code', () => {
    const markdown = [
      '```csharp',
      'public string Name { get; private set { ... } }',
      'var next = options with { ... };',
      '[link](x){ .md-button }',
      '!!! note',
      '```',
    ].join('\n');
    expect(stripMkdocsMarkup(markdown)).toBe(markdown);
  });

  test('preserves braces inside inline code spans', () => {
    const markdown = 'Use `private set { ... }` and `x = { y }`.';
    expect(stripMkdocsMarkup(markdown)).toBe(markdown);
  });

  test('leaves already-converted Starlight asides untouched', () => {
    const markdown = [':::note[Title]', 'Body text.', ':::'].join('\n');
    expect(stripMkdocsMarkup(markdown)).toBe(markdown);
  });

  test('is idempotent', () => {
    const markdown = [
      '# Title { #id }',
      '',
      '[Go](guide/){ .md-button }',
      '',
      '!!! note "Heads up"',
      '    Body.',
    ].join('\n');
    const once = stripMkdocsMarkup(markdown);
    expect(stripMkdocsMarkup(once)).toBe(once);
  });
});
