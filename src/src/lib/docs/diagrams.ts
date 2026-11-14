import { posix } from 'node:path';

/**
 * Diagram pairs: one diagram, two renderers (ADR 0013).
 *
 * A product repository's documentation is read in two places — on GitHub, which
 * renders Mermaid but not LikeC4, and on purview.dev, which renders LikeC4
 * through astroc4. A repository marks a Mermaid fence as the GitHub rendering of
 * a LikeC4 view by wrapping it in a pair of HTML comments:
 *
 * ````md
 * <!-- purview:likec4 file="./diagrams/the-loop.c4" view="theLoop" title="The loop" -->
 * ```mermaid
 * flowchart LR
 *   resume --> next
 * ```
 * [LikeC4 model](./diagrams/the-loop.c4)
 * <!-- /purview:likec4 -->
 * ````
 *
 * GitHub hides the comments and shows everything between them. The docs sync
 * replaces the whole block — markers, Mermaid fence and model link — with a
 * ```` ```likec4 ```` fence whose body is the `.c4` file, so the site shows only
 * the LikeC4 view. A block whose model cannot be read, or whose view the model
 * does not declare, keeps its Mermaid content and the sync reports why: the
 * reader still gets a diagram, and the build never fails on an upstream file.
 */

export const DIAGRAM_OPEN = /^ {0,3}<!--\s*purview:likec4\b(.*?)-->\s*$/;
export const DIAGRAM_CLOSE = /^ {0,3}<!--\s*\/purview:likec4\s*-->\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Fence options astroc4 understands; `file` is consumed by the sync instead. */
const PASSTHROUGH_OPTIONS = [
  'view',
  'project',
  'title',
  'description',
  'height',
  'collapsible',
  'defaultOpen',
];

export interface DiagramBlock {
  /** Index of the opening marker line. */
  start: number;
  /** Index of the closing marker line. */
  end: number;
  options: Record<string, string>;
  /** Lines between the markers: the GitHub rendering (Mermaid, a link to the model). */
  inner: string;
}

/** Parse `key="value" key='value' key=bare` pairs from a marker. */
export function parseDiagramOptions(source: string): Record<string, string> {
  const options: Record<string, string> = {};
  const pattern = /([A-Za-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    options[match[1] ?? ''] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return options;
}

/**
 * Every marked block in a page, skipping markers that sit inside a code fence (a
 * page documenting the convention shows the markers as an example).
 */
export function findDiagramBlocks(markdown: string): {
  blocks: DiagramBlock[];
  problems: string[];
} {
  const lines = markdown.split('\n');
  const blocks: DiagramBlock[] = [];
  const problems: string[] = [];
  let fence: { char: string; length: number } | null = null;
  let open: { start: number; options: Record<string, string> } | null = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const run = fenceMatch[1] ?? '';
      if (!fence) {
        fence = { char: run[0] ?? '`', length: run.length };
        continue;
      }
      if (run[0] === fence.char && run.length >= fence.length && line.trim() === run) {
        fence = null;
        continue;
      }
    }
    if (fence) {
      continue;
    }
    const opening = DIAGRAM_OPEN.exec(line);
    if (opening) {
      if (open) {
        problems.push(
          `line ${open.start + 1}: a purview:likec4 block is not closed before the next one opens.`,
        );
      }
      open = { start: index, options: parseDiagramOptions(opening[1] ?? '') };
      continue;
    }
    if (DIAGRAM_CLOSE.test(line)) {
      if (!open) {
        problems.push(`line ${index + 1}: a closing purview:likec4 marker has no opening marker.`);
        continue;
      }
      blocks.push({
        start: open.start,
        end: index,
        options: open.options,
        inner: lines.slice(open.start + 1, index).join('\n'),
      });
      open = null;
    }
  }
  if (open) {
    problems.push(`line ${open.start + 1}: a purview:likec4 block is never closed.`);
  }
  return { blocks, problems };
}

/**
 * Repository path of a model file named relative to the page that names it, or
 * null when it would leave the repository. A leading `/` is the repository root,
 * the way GitHub resolves it.
 */
export function resolveDiagramPath(pagePath: string, file: string): string | null {
  const joined = file.startsWith('/')
    ? posix.normalize(file.slice(1))
    : posix.normalize(posix.join(posix.dirname(pagePath), file));
  if (joined === '.' || joined.startsWith('../') || joined === '..') {
    return null;
  }
  return joined;
}

/** View ids a LikeC4 source declares (`view theLoop { … }`, `dynamic view theLoop { … }`). */
export function declaredViews(source: string): Set<string> {
  const views = new Set<string>();
  const pattern = /(?:^|[\s{;])(?:dynamic\s+|deployment\s+)?view\s+([A-Za-z_][\w-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    views.add(match[1] ?? '');
  }
  return views;
}

/** A ```` ```likec4 ```` fence holding `source`, long enough that nothing inside closes it. */
export function renderLikec4Fence(source: string, options: Record<string, string>): string {
  const longest = Math.max(2, ...[...source.matchAll(/`+/g)].map((run) => run[0].length));
  const ticks = '`'.repeat(longest + 1);
  const meta = PASSTHROUGH_OPTIONS.filter((key) => options[key] !== undefined)
    .map((key) => `${key}="${(options[key] ?? '').replace(/"/g, "'")}"`)
    .join(' ');
  return `${ticks}likec4${meta ? ` ${meta}` : ''}\n${source.replace(/\s+$/, '')}\n${ticks}`;
}

/** Repository paths of the model files a page's diagram blocks name. */
export function diagramModelPaths(markdown: string, pagePath: string): string[] {
  const paths = new Set<string>();
  for (const block of findDiagramBlocks(markdown).blocks) {
    const file = block.options.file;
    const resolved = file ? resolveDiagramPath(pagePath, file) : null;
    if (resolved) {
      paths.add(resolved);
    }
  }
  return [...paths];
}

/**
 * Replace each diagram block with its LikeC4 fence. `models` maps a repository
 * path to the file's text, or null when it could not be read. A block that cannot
 * be rendered as LikeC4 keeps its GitHub content, and the reason is returned.
 */
export function applyDiagramBlocks(
  markdown: string,
  pagePath: string,
  models: ReadonlyMap<string, string | null>,
): { markdown: string; warnings: string[] } {
  const { blocks, problems } = findDiagramBlocks(markdown);
  const warnings = problems.map((problem) => `${pagePath} ${problem}`);
  if (blocks.length === 0) {
    return { markdown, warnings };
  }
  const lines = markdown.split('\n');
  const output: string[] = [];
  let cursor = 0;
  for (const block of blocks) {
    output.push(...lines.slice(cursor, block.start));
    cursor = block.end + 1;
    const where = `${pagePath} line ${block.start + 1}`;
    const file = block.options.file;
    if (!file) {
      warnings.push(
        `${where}: the purview:likec4 marker has no file="…"; the Mermaid rendering is kept.`,
      );
      output.push(block.inner);
      continue;
    }
    const path = resolveDiagramPath(pagePath, file);
    const source = path ? models.get(path) : null;
    if (!path || source === null || source === undefined) {
      warnings.push(`${where}: ${file} could not be read; the Mermaid rendering is kept.`);
      output.push(block.inner);
      continue;
    }
    const view = block.options.view;
    if (view && !declaredViews(source).has(view)) {
      warnings.push(`${where}: ${file} declares no view "${view}"; the Mermaid rendering is kept.`);
      output.push(block.inner);
      continue;
    }
    output.push(renderLikec4Fence(source, block.options));
  }
  output.push(...lines.slice(cursor));
  return { markdown: output.join('\n'), warnings };
}
