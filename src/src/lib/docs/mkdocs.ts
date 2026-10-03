/**
 * Remove mkdocs / Material markup that Starlight does not understand.
 *
 * Documentation is authored in the product repositories, several of which still
 * publish a mkdocs site (the root `mkdocs.yml` enables `admonition`,
 * `attr_list`, and `pymdownx.details`). When that markdown is aggregated into
 * the portal, mkdocs-only syntax renders as literal text — the clearest example
 * being Material button links:
 *
 *     [Get started](getting-started/){ .md-button .md-button--primary }
 *
 * which Starlight shows as `[Get started](getting-started/){ .md-button … }`.
 *
 * This pass strips that markup deterministically. It is line-oriented and
 * fence-aware: fenced code blocks and inline code spans are preserved
 * byte-for-byte, because a `{ … }` attribute-looking group inside C# or LikeC4
 * code must survive. Admonitions (`!!!`/`???`) are converted to Starlight
 * asides rather than dropped, so their prose is kept.
 */

/** Starlight aside types, used for the mkdocs admonition mapping. */
type AsideType = 'note' | 'tip' | 'caution' | 'danger';

const ADMONITION_TYPES: Record<string, AsideType> = {
  note: 'note',
  abstract: 'note',
  summary: 'note',
  tldr: 'note',
  info: 'note',
  todo: 'note',
  example: 'note',
  quote: 'note',
  tip: 'tip',
  hint: 'tip',
  important: 'tip',
  success: 'tip',
  check: 'tip',
  done: 'tip',
  warning: 'caution',
  caution: 'caution',
  attention: 'caution',
  question: 'caution',
  help: 'caution',
  faq: 'caution',
  danger: 'danger',
  error: 'danger',
  failure: 'danger',
  fail: 'danger',
  missing: 'danger',
  bug: 'danger',
};

/** `!!! note "Title"` / `???+ tip` — a mkdocs admonition opening line. */
const ADMONITION_OPEN = /^(\s*)(!{3}|\?{3})\+?\s+([A-Za-z][\w-]*)(?:\s+"([^"]*)")?\s*$/;

const FENCE_OPEN = /^\s*(```|~~~)/;
const SNIPPET_LINE = /^\s*--8<--/;

/**
 * Split a line into alternating plain-text and inline-code segments so
 * transforms only ever touch prose. A backtick run that has no closing partner
 * on the line is treated as code to the end of the line (a conservative choice:
 * it never rewrites something that might be code).
 */
function splitInlineCode(line: string): { code: boolean; text: string }[] {
  const parts: { code: boolean; text: string }[] = [];
  let index = 0;
  while (index < line.length) {
    const start = line.indexOf('`', index);
    if (start === -1) {
      parts.push({ code: false, text: line.slice(index) });
      break;
    }
    let end = start;
    while (end < line.length && line[end] === '`') {
      end += 1;
    }
    const ticks = line.slice(start, end);
    const close = line.indexOf(ticks, end);
    if (close === -1) {
      parts.push({ code: false, text: line.slice(index, start) });
      parts.push({ code: true, text: line.slice(start) });
      break;
    }
    parts.push({ code: false, text: line.slice(index, start) });
    parts.push({ code: true, text: line.slice(start, close + ticks.length) });
    index = close + ticks.length;
  }
  return parts;
}

/** Strip mkdocs markup from a single run of non-code text. */
function cleanSegment(text: string): string {
  return (
    text
      // TechDocs/Jinja statements (`{% … %}`) and variables (`{{ … }}`).
      .replace(/\{%[^%]*%\}/g, '')
      .replace(/\{\{[^{}]*\}\}/g, '')
      // Inline snippet includes (`--8<-- "snippets/foo.md"`).
      .replace(/--8<--\s*"[^"]*"/g, '')
      // Material attr_list attached to a link or image: `[x](y){ .md-button }`.
      .replace(/\]\(([^)]*)\)\s*\{[^}]*\}/g, ']($1)')
      // Inline attr_list: `text {: .class }`.
      .replace(/\s*\{:\s*[^}]*\}/g, '')
  );
}

/** Clean one non-fence line, leaving inline code spans untouched. */
function cleanLine(line: string): string {
  if (SNIPPET_LINE.test(line)) {
    return '';
  }
  return splitInlineCode(line)
    .map((part) => (part.code ? part.text : cleanSegment(part.text)))
    .join('');
}

/**
 * Convert mkdocs admonitions (`!!! note "Title"`) to Starlight asides. The
 * indented body is dedented by the admonition's own indent plus the four spaces
 * mkdocs uses for its content, preserving any deeper nesting.
 */
function convertAdmonitions(markdown: string): string {
  const lines = markdown.split('\n');
  const output: string[] = [];
  let fence: string | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const fenceMatch = FENCE_OPEN.exec(line);
    const marker = fenceMatch?.[1];
    if (marker !== undefined) {
      fence = fence === marker ? null : (fence ?? marker);
      output.push(line);
      i += 1;
      continue;
    }
    if (fence) {
      output.push(line);
      i += 1;
      continue;
    }

    const match = ADMONITION_OPEN.exec(line);
    if (!match) {
      output.push(line);
      i += 1;
      continue;
    }

    const markerIndent = (match[1] ?? '').length;
    const type = ADMONITION_TYPES[(match[3] ?? '').toLowerCase()] ?? 'note';
    const title = match[4];
    const body: string[] = [];
    let pendingBlank = 0;
    i += 1;

    while (i < lines.length) {
      const current = lines[i] ?? '';
      if (current.trim() === '') {
        pendingBlank += 1;
        i += 1;
        continue;
      }
      const currentIndent = current.length - current.trimStart().length;
      if (currentIndent <= markerIndent) {
        break;
      }
      for (let blank = 0; blank < pendingBlank; blank += 1) {
        body.push('');
      }
      pendingBlank = 0;
      body.push(current.slice(Math.min(currentIndent, markerIndent + 4)));
      i += 1;
    }

    const opener = title ? `:::${type}[${title}]` : `:::${type}`;
    output.push(opener, ...body, ':::');
  }

  return output.join('\n');
}

/** Remove mkdocs-only markup from aggregated markdown. */
export function stripMkdocsMarkup(markdown: string): string {
  const lines = convertAdmonitions(markdown).split('\n');
  const output: string[] = [];
  let fence: string | null = null;

  for (const line of lines) {
    const fenceMatch = FENCE_OPEN.exec(line);
    const marker = fenceMatch?.[1];
    if (marker !== undefined) {
      fence = fence === marker ? null : (fence ?? marker);
      output.push(line);
      continue;
    }
    if (fence) {
      output.push(line);
      continue;
    }
    // A heading attr_list (`# Title { #id }`) or a standalone attr_list line is
    // stripped from the line as a whole; `cleanLine` handles inline cases.
    const heading = /^(#{1,6}\s+.*?)\s*\{[^}]*\}\s*$/.exec(line);
    if (heading) {
      output.push(heading[1] ?? '');
      continue;
    }
    if (/^\s*\{[^}]*\}\s*$/.test(line)) {
      output.push('');
      continue;
    }
    output.push(cleanLine(line));
  }

  return output.join('\n');
}
