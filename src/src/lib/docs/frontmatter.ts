import type { ProjectStatus } from '../manifest/schema';

import { slugifyDocFile } from './links';

export interface DocFrontmatter {
  title: string;
  description: string;
  owners: string[];
  status: ProjectStatus;
  /**
   * True when the catalogue flags the owning project as experimental
   * (ADR 0004). The manifest keeps `status` and the flag on separate axes, so
   * the front matter carries both and the site collapses them for display.
   */
  experimental?: boolean;
  lastReviewed: string;
  sourceProject: string;
  sourceRepo: string;
  /** Display name of the owning project (from the catalogue manifest). */
  projectName?: string;
  sourcePath: string;
  editUrl: string;
  /** Repository topics, surfaced as tags on the documentation page. */
  tags?: string[];
  sidebarLabel?: string;
  sidebarOrder?: number;
}

/** Extract the title from the first top-level markdown heading. */
export function extractTitle(markdown: string, fileName: string): string {
  const heading = /^#\s+(.+)$/m.exec(markdown);
  if (heading?.[1]) {
    return heading[1].trim();
  }
  const slug = slugifyDocFile(fileName);
  return slug
    .split('-')
    .map((word) => (word ? word[0]?.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** Keep one document title while preserving later source headings as sections. */
export function normalizeDocumentHeadings(markdown: string): string {
  let foundTitle = false;
  let fence: '```' | '~~~' | null = null;

  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const fenceMatch = /^(\s*)(```|~~~)/.exec(line);
      if (fenceMatch?.[2]) {
        const marker = fenceMatch[2] as '```' | '~~~';
        fence = fence === marker ? null : (fence ?? marker);
        return line;
      }
      if (fence || !/^#\s+\S/.test(line)) {
        return line;
      }
      if (!foundTitle) {
        foundTitle = true;
        return line;
      }
      return `#${line}`;
    })
    .join('\n');
}

const FRONTMATTER_PATTERN = /^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/;
const FENCED_CODE_PATTERN = /^(?:```|~~~)[^\r\n]*\r?\n[\s\S]*?^(?:```|~~~)\s*$/gm;

function markdownParagraphToPlainText(block: string): string {
  return block
    .replace(/^>\s?/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/<https?:\/\/[^>]+>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_~]/g, '')
    .replace(/\\([\\`*_[\]{}()#+.!<>-])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function isProseParagraph(block: string): boolean {
  const firstLine = block.split(/\r?\n/, 1)[0]?.trim() ?? '';
  return (
    firstLine !== '' &&
    !/^(?:#{1,6}\s|:::|---$|___$|\*\*\*$)/.test(firstLine) &&
    !/^>\s*\[![A-Z]+\]/i.test(firstLine) &&
    !/^(?:[-+*]|\d+[.)])\s+/.test(firstLine) &&
    !firstLine.startsWith('|') &&
    !/^\[[^\]]+\]:\s+/.test(firstLine) &&
    !/^<(?:div|table|details|picture|figure|img|!--)\b/i.test(firstLine)
  );
}

/** Extract a short description from the first non-heading paragraph. */
export function extractDescription(markdown: string, maxLength = 160): string {
  const prose = markdown.replace(FRONTMATTER_PATTERN, '').replace(FENCED_CODE_PATTERN, '');
  const first = prose
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(isProseParagraph)
    .map(markdownParagraphToPlainText)
    .find((block) => /[A-Za-z0-9]/.test(block));
  if (!first) {
    return '';
  }
  const collapsed = first.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  const truncated = collapsed.slice(0, maxLength - 1);
  const lastSpace = truncated.lastIndexOf(' ');
  return `${lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated}…`;
}

/** Serialize front matter in a small, deterministic YAML subset. */
export function renderFrontmatter(frontmatter: DocFrontmatter): string {
  const lines: string[] = ['---'];
  lines.push(`title: ${quote(frontmatter.title)}`);
  if (frontmatter.description) {
    lines.push(`description: ${quote(frontmatter.description)}`);
  }
  lines.push(`owners: [${frontmatter.owners.join(', ')}]`);
  lines.push(`status: ${frontmatter.status}`);
  if (frontmatter.experimental) {
    lines.push('experimental: true');
  }
  lines.push(`lastReviewed: ${JSON.stringify(frontmatter.lastReviewed)}`);
  lines.push(`sourceProject: ${quote(frontmatter.sourceProject)}`);
  lines.push(`sourceRepo: ${quote(frontmatter.sourceRepo)}`);
  if (frontmatter.projectName !== undefined) {
    lines.push(`projectName: ${quote(frontmatter.projectName)}`);
  }
  lines.push(`sourcePath: ${quote(frontmatter.sourcePath)}`);
  lines.push(`editUrl: ${quote(frontmatter.editUrl)}`);
  if (frontmatter.tags && frontmatter.tags.length > 0) {
    lines.push(`tags: [${frontmatter.tags.join(', ')}]`);
  }
  if (frontmatter.sidebarLabel !== undefined) {
    lines.push('sidebar:');
    lines.push(`  label: ${quote(frontmatter.sidebarLabel)}`);
    lines.push(`  order: ${frontmatter.sidebarOrder ?? 0}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function quote(value: string): string {
  if (/^[a-zA-Z0-9 _./-]+$/.test(value) && !value.includes(': ')) {
    return value;
  }
  return JSON.stringify(value);
}
