import type { AsyncIconLoader } from 'mermaid';

import { mermaidIconPacks } from '../../config/mermaid-icons.mjs';

type Mermaid = (typeof import('mermaid'))['default'];
type Theme = 'default' | 'dark';

let library: Promise<Mermaid> | undefined;
let theme: Theme = 'default';
let generation = 0;
let nextId = 0;
let pending = false;
let running = false;
const renderedThemes = new WeakMap<HTMLElement, Theme>();

const readTheme = (): Theme =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default';

function themeVariables(selectedTheme: Theme) {
  const dark = selectedTheme === 'dark';
  return {
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: '15px',
    primaryColor: dark ? '#201b2c' : '#ffffff',
    primaryTextColor: dark ? '#f0edf6' : '#17141f',
    primaryBorderColor: dark ? '#a56cff' : '#7a32e6',
    secondaryColor: dark ? '#2a203c' : '#f3eaff',
    secondaryTextColor: dark ? '#f0edf6' : '#17141f',
    secondaryBorderColor: dark ? '#8b3dff' : '#8b3dff',
    tertiaryColor: dark ? '#18141f' : '#f8f5fc',
    tertiaryTextColor: dark ? '#f0edf6' : '#17141f',
    tertiaryBorderColor: dark ? '#625873' : '#d7cde5',
    lineColor: dark ? '#b991ff' : '#6820d2',
    textColor: dark ? '#f0edf6' : '#17141f',
    edgeLabelBackground: dark ? '#16131d' : '#f6f4fa',
    clusterBkg: dark ? '#16131d' : '#ffffff',
    clusterBorder: dark ? '#443a55' : '#d7cde5',
  };
}

const themeCss = `
  .node rect,
  .node polygon,
  .node path {
    stroke-width: 1.75px;
    filter: drop-shadow(0 3px 7px rgba(79, 34, 142, 0.14));
  }

  .node rect {
    rx: 10px;
    ry: 10px;
  }

  .nodeLabel,
  .label text {
    font-weight: 650;
    letter-spacing: -0.01em;
  }

  .nodeLabel p {
    line-height: 1.3;
  }

  .flowchart-link {
    stroke-width: 1.75px;
  }

  .arrowheadPath {
    stroke-width: 1px;
  }

  .edgeLabel {
    font-size: 0.8125rem;
    font-weight: 550;
  }
`;

function loadMermaid(): Promise<Mermaid> {
  return (library ??= import('mermaid')
    .then(({ default: mermaid }) => {
      mermaid.registerIconPacks(
        mermaidIconPacks.map(({ name, url }): AsyncIconLoader => ({
          name,
          loader: async () => {
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(`Unable to load ${name} icons: HTTP ${response.status}`);
            }
            return response.json() as ReturnType<AsyncIconLoader['loader']>;
          },
        })),
      );
      return mermaid;
    })
    .catch((error: unknown) => {
      library = undefined;
      throw error;
    }));
}

function showError(diagram: HTMLElement, error: unknown): void {
  diagram.textContent = `Unable to render diagram: ${error instanceof Error ? error.message : String(error)}`;
  diagram.classList.add('mermaid-error');
  diagram.dataset.processed = 'true';
}

async function renderPage(selectedTheme: Theme, revision: number): Promise<void> {
  const current = () => generation === revision && readTheme() === selectedTheme;
  const diagrams = [...document.querySelectorAll<HTMLElement>('pre.mermaid')].filter(
    (diagram) => renderedThemes.get(diagram) !== selectedTheme,
  );
  if (!diagrams.length) return;

  for (const diagram of diagrams) {
    diagram.dataset.diagram ??= diagram.textContent ?? '';
  }

  let mermaid: Mermaid;
  try {
    mermaid = await loadMermaid();
    if (!current()) return;
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: themeVariables(selectedTheme),
      themeCSS: themeCss,
      securityLevel: 'strict',
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: 'basis',
        nodeSpacing: 36,
        rankSpacing: 42,
        padding: 16,
      },
    });
  } catch (error) {
    console.error('[mermaid] Initialization failed:', error);
    for (const diagram of diagrams) {
      if (diagram.isConnected && current()) showError(diagram, error);
    }
    return;
  }

  for (const diagram of diagrams) {
    if (!current()) break;
    if (!diagram.isConnected) continue;

    const id = `purview-mermaid-${++nextId}`;
    try {
      const { svg } = await mermaid.render(id, diagram.dataset.diagram!);
      if (!diagram.isConnected || !current()) continue;
      diagram.innerHTML = svg;
      diagram.classList.remove('mermaid-error');
      diagram.dataset.processed = 'true';
      renderedThemes.set(diagram, selectedTheme);
    } catch (error) {
      console.error('[mermaid] Rendering failed:', error);
      if (!diagram.isConnected || !current()) continue;
      showError(diagram, error);
      renderedThemes.set(diagram, selectedTheme);
    } finally {
      document.getElementById(`d${id}`)?.remove();
      document.getElementById(`i${id}`)?.remove();
    }
  }
}

function schedule(): void {
  const selectedTheme = readTheme();
  if (selectedTheme !== theme) {
    theme = selectedTheme;
    generation++;
  }

  pending = true;
  if (running) return;
  running = true;

  queueMicrotask(() => {
    void (async () => {
      try {
        while (pending) {
          pending = false;
          await renderPage(theme, generation);
        }
      } finally {
        running = false;
      }
    })();
  });
}

const observer = new MutationObserver(() => {
  if (readTheme() !== theme) schedule();
});

function initialize(): void {
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  schedule();
}

document.addEventListener('astro:before-swap', () => {
  generation++;
  pending = false;
  observer.disconnect();
});
document.addEventListener('astro:page-load', initialize);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
  initialize();
}
