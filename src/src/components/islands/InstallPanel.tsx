import type { InstallOption, InstallTab } from '~/lib/install';

import { useState } from 'preact/hooks';

function CodeBlock({ code }: { code: string }) {
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
    <div class="border-border bg-code-bg flex items-start justify-between gap-3 rounded-lg border px-4 py-3">
      <pre class="min-w-0 flex-1 overflow-x-auto text-sm leading-relaxed">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={copy}
        class="border-border bg-surface hover:border-brand/40 shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
      >
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
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
        <CodeBlock code={code} />
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
        class="border-border flex flex-wrap gap-x-1 border-b"
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
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              active === index
                ? 'border-brand text-brand-emphasis'
                : 'border-transparent text-muted hover:border-border hover:text-foreground',
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
        class="mt-4 space-y-4"
      >
        {tab.snippets.length > 1 ? (
          tab.snippets.map((snippet) => (
            <CopyBlock key={`${snippet.label}-${snippet.code}`} {...snippet} />
          ))
        ) : (
          <div>
            {tab.detail && <p class="text-muted mb-2 text-xs">{tab.detail}</p>}
            <CodeBlock code={tab.snippets[0]?.code ?? ''} />
          </div>
        )}
      </div>
    </div>
  );
}
