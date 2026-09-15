import { slugifyDocFile } from './links';

export interface DocFrontmatter {
  title: string;
  description: string;
  owners: string[];
  status: 'stable' | 'preview' | 'archived';
  lastReviewed: string;
  sourceProject: string;
  sourceRepo: string;
  sourcePath: string;
  editUrl: string;
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

const MARKDOWN_SOURCE_PATTERN = /^```.*$/gm;

/** Extract a short description from the first non-heading paragraph. */
export function extractDescription(markdown: string, maxLength = 160): string {
  const withoutCodeBlocks = markdown.replace(MARKDOWN_SOURCE_PATTERN, '');
  const paragraphs = withoutCodeBlocks
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(
      (block) =>
        block !== '' && !block.startsWith('#') && !block.startsWith('>') && !block.startsWith(':'),
    )
    .map((block) =>
      block
        .replace(/[`*_[\]()]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  const first = paragraphs[0];
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
  lines.push(`lastReviewed: ${JSON.stringify(frontmatter.lastReviewed)}`);
  lines.push(`sourceProject: ${quote(frontmatter.sourceProject)}`);
  lines.push(`sourceRepo: ${quote(frontmatter.sourceRepo)}`);
  lines.push(`sourcePath: ${quote(frontmatter.sourcePath)}`);
  lines.push(`editUrl: ${quote(frontmatter.editUrl)}`);
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
