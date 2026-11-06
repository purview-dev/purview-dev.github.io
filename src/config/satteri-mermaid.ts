import type { MdastPluginDefinition } from 'satteri';

import { defineMdastPlugin } from 'satteri';

/**
 * Render opted-in Mermaid fences as `<pre class="mermaid">` before the code
 * block is highlighted, so the browser-side Mermaid script can draw them.
 *
 * This is the Sätteri equivalent of the remark plugin the site used before
 * Astro 7.4 made Sätteri the default Markdown processor: a Sätteri plugin
 * declares one visitor per node type rather than a single tree walker, so only
 * `code` nodes are visited. Replacing the node with an `html` node is
 * deliberate — the output is exactly the element the Mermaid runtime expects,
 * and it does not depend on the converter honouring `data.hName`.
 *
 * `markdown.processor` is the site's own; astroc4 appends its ```likec4 fence
 * transform to whatever processor the site registered, so the two coexist.
 */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const mermaidFences: MdastPluginDefinition = defineMdastPlugin({
  name: 'purview-mermaid-fences',
  code(node, ctx) {
    if (node.lang !== 'mermaid') {
      return;
    }
    ctx.replaceNode(node, {
      type: 'html',
      value: `<pre class="mermaid">${escapeHtml(node.value)}</pre>`,
    });
  },
});
