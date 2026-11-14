/**
 * Manifest prose (`description`, `origin`, use-case `scenario`, …) is plain
 * text that may carry Markdown code: `inline` spans and fenced blocks. The
 * project pages render those two constructs and nothing else, so a field reads
 * the same on the site as it does in the YAML without opening the door to
 * arbitrary Markdown or HTML.
 */

export type ProseInline = { code: boolean; text: string };

export type ProseBlock =
  | { kind: 'paragraph'; inlines: ProseInline[] }
  | { kind: 'code'; code: string; language?: string };

/** An opening fence: three or more backticks or tildes, then an optional language. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;

/**
 * Split text into plain and inline-code segments following CommonMark code
 * spans: a run of N backticks closes at the next run of exactly N, line endings
 * inside a span become spaces, and one padding space is stripped from each side
 * when both are present. A run with no partner stays literal text.
 */
export function parseInlineCode(text: string): ProseInline[] {
  const parts: ProseInline[] = [];
  let plain = '';
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf('`', index);
    if (start === -1) {
      plain += text.slice(index);
      break;
    }
    let end = start;
    while (end < text.length && text[end] === '`') {
      end += 1;
    }
    const length = end - start;
    const close = findClosingRun(text, end, length);
    if (close === -1) {
      plain += text.slice(index, end);
      index = end;
      continue;
    }
    plain += text.slice(index, start);
    if (plain) {
      parts.push({ code: false, text: plain });
      plain = '';
    }
    let code = text.slice(end, close).replace(/\r?\n/g, ' ');
    if (code.length > 1 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') {
      code = code.slice(1, -1);
    }
    parts.push({ code: true, text: code });
    index = close + length;
  }
  if (plain) {
    parts.push({ code: false, text: plain });
  }
  return parts;
}

/** Index of the next backtick run of exactly `length` at or after `from`, or -1. */
function findClosingRun(text: string, from: number, length: number): number {
  let index = from;
  while (index < text.length) {
    const start = text.indexOf('`', index);
    if (start === -1) {
      return -1;
    }
    let end = start;
    while (end < text.length && text[end] === '`') {
      end += 1;
    }
    if (end - start === length) {
      return start;
    }
    index = end;
  }
  return -1;
}

/**
 * Split prose into paragraphs (separated by blank lines) and fenced code
 * blocks. A fence closes on a line of the same character at least as long as
 * the opener; an unclosed fence runs to the end of the text, as in CommonMark.
 */
export function parseProse(source: string): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const text = paragraph.join('\n').trim();
    if (text) {
      blocks.push({ kind: 'paragraph', inlines: parseInlineCode(text) });
    }
    paragraph = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const open = FENCE_OPEN.exec(line);
    if (open) {
      flushParagraph();
      const fence = open[1] ?? '```';
      const language = open[2] || undefined;
      const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`);
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !close.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      blocks.push({ kind: 'code', code: body.join('\n'), language });
      i += 1;
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
    } else {
      paragraph.push(line);
    }
    i += 1;
  }
  flushParagraph();
  return blocks;
}
