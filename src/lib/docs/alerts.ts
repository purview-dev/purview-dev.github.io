/**
 * Convert GitHub-flavoured alert blockquotes (`> [!NOTE]`) into Starlight
 * aside directives (`:::note`). This is a line-oriented, deterministic pass
 * over the aggregated markdown.
 */

const TYPE_MAP: Record<string, string> = {
  NOTE: 'note',
  TIP: 'tip',
  IMPORTANT: 'caution',
  WARNING: 'caution',
  CAUTION: 'danger',
};

const ALERT_OPEN = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/;

export interface AlertBlock {
  type: string;
  title: string;
  lines: string[];
}

/** Parse contiguous GitHub alert blockquote blocks. */
export function parseGithubAlerts(markdown: string): AlertBlock[] {
  const blocks: AlertBlock[] = [];
  const lines = markdown.split('\n');
  let i = 0;
  while (i < lines.length) {
    const match = ALERT_OPEN.exec(lines[i] ?? '');
    if (!match) {
      i += 1;
      continue;
    }
    const type = TYPE_MAP[match[1] ?? 'NOTE'] ?? 'note';
    const title = (match[2] ?? '').trim();
    const body: string[] = [];
    i += 1;
    while (i < lines.length) {
      const line = lines[i] ?? '';
      if (!line.startsWith('>')) {
        break;
      }
      const blockQuote = /^>\s?(.*)$/.exec(line);
      body.push(blockQuote?.[1] ?? '');
      i += 1;
    }
    blocks.push({ type, title, lines: body });
  }
  return blocks;
}

/** Render Starlight aside directives for the parsed alert blocks. */
export function renderStarlightAsides(blocks: AlertBlock[]): string {
  return blocks
    .map((block) => {
      const opener = block.title ? `:::${block.type}[${block.title}]` : `:::${block.type}`;
      const body = block.lines.map((line) => line || '').join('\n');
      return [opener, body, ':::'].filter((part, index) => part !== '' || index === 1).join('\n');
    })
    .join('\n\n');
}

/** Convert GitHub alert blockquotes in a markdown document to Starlight asides. */
export function convertGithubAlerts(markdown: string): string {
  const lines = markdown.split('\n');
  const output: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const match = ALERT_OPEN.exec(lines[i] ?? '');
    if (!match) {
      output.push(lines[i] ?? '');
      i += 1;
      continue;
    }
    const type = TYPE_MAP[match[1] ?? 'NOTE'] ?? 'note';
    const title = (match[2] ?? '').trim();
    const body: string[] = [];
    i += 1;
    while (i < lines.length) {
      const line = lines[i] ?? '';
      if (!line.startsWith('>')) {
        break;
      }
      const blockQuote = /^>\s?(.*)$/.exec(line);
      body.push(blockQuote?.[1] ?? '');
      i += 1;
    }
    const opener = title ? `:::${type}[${title}]` : `:::${type}`;
    output.push(opener, body.join('\n'), ':::');
    if ((lines[i] ?? '').trim() !== '') {
      output.push('');
    }
  }
  return output.join('\n');
}
