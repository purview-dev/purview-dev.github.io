import type { InstallOption, InstallTab } from '~/lib/install';

import { useState } from 'preact/hooks';

/** macOS-style traffic light dots that frame the code window, matching Expressive Code. */
function FrameDots() {
  return (
    <span class="flex shrink-0 gap-1.5" aria-hidden="true">
      <span class="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
      <span class="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
      <span class="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
    </span>
  );
}

function CodeBlock({ code, title }: { code: string; title?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Clipboard access can be blocked; the button is a convenience only.
    }
  };

  return (
    <div class="pv-code-frame">
      <div class="pv-code-frame-header">
        <FrameDots />
        <span class="min-w-0 flex-1 truncate text-center text-xs font-medium text-white/50">
          {title}
        </span>
        <button
          type="button"
          onClick={copy}
          class={[
            'shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
            copied
              ? 'border-[#27c93f]/40 bg-[#27c93f]/15 text-[#7ee89a]'
              : 'border-white/10 bg-white/5 text-white/70 hover:border-white/25 hover:bg-white/10 hover:text-white',
          ].join(' ')}
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <pre class="pv-code-frame-body">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function CopyBlock({ label, detail, code }: InstallOption) {
  return (
    <div>
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h3 class="text-foreground text-sm font-semibold">{label}</h3>
        {detail && <p class="text-muted text-xs">{detail}</p>}
      </div>
      <div class="mt-2">
        <CodeBlock code={code} title={label} />
      </div>
    </div>
  );
}

interface Props {
  tabs: InstallTab[];
}

export default function InstallPanel({ tabs }: Props) {
  const [active, setActive] = useState(0);
  if (tabs.length === 0) {
    return null;
  }
  const tab = tabs[Math.min(active, tabs.length - 1)];
  if (!tab) {
    return null;
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const next = (active + direction + tabs.length) % tabs.length;
    setActive(next);
    document.getElementById(`install-tab-${next}`)?.focus();
  };

  return (
    <div class="mt-4">
      <div
        role="tablist"
        aria-label="Install options"
        onKeyDown={onKeyDown}
        tabIndex={-1}
        class="flex flex-wrap gap-1 px-1"
      >
        {tabs.map((tabOption, index) => (
          <button
            type="button"
            role="tab"
            id={`install-tab-${index}`}
            key={tabOption.label}
            aria-selected={active === index}
            aria-controls={`install-panel-${index}`}
            tabIndex={active === index ? 0 : -1}
            onClick={() => setActive(index)}
            class={[
              'pv-install-tab',
              active === index ? 'pv-install-tab-active' : 'pv-install-tab-inactive',
            ].join(' ')}
          >
            {tabOption.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`install-panel-${active}`}
        aria-labelledby={`install-tab-${active}`}
        class="pv-install-panel-body space-y-4"
      >
        {tab.snippets.length > 1 ? (
          tab.snippets.map((snippet) => (
            <CopyBlock key={`${snippet.label}-${snippet.code}`} {...snippet} />
          ))
        ) : (
          <div>
            {tab.detail && <p class="text-muted mb-2 text-xs">{tab.detail}</p>}
            <CodeBlock code={tab.snippets[0]?.code ?? ''} title={tab.label} />
          </div>
        )}
      </div>
    </div>
  );
}
