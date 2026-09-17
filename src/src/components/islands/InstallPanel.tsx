import type { InstallOption } from '~/lib/install';

import { useState } from 'preact/hooks';

function CopyBlock({ label, detail, code }: InstallOption) {
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
    <div>
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h3 class="text-foreground text-sm font-semibold">{label}</h3>
        {detail && <p class="text-muted text-xs">{detail}</p>}
      </div>
      <div class="border-border bg-code-bg mt-2 flex items-start justify-between gap-3 rounded-lg border px-4 py-3">
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
    </div>
  );
}

interface Props {
  options: InstallOption[];
}

export default function InstallPanel({ options }: Props) {
  return (
    <div class="mt-4 space-y-4">
      {options.map((option) => (
        <CopyBlock key={`${option.label}-${option.code}`} {...option} />
      ))}
    </div>
  );
}
