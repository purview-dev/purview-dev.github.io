import { useState } from 'preact/hooks';

interface Props {
  command: string;
}

export default function CopyCommand({ command }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(command);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Clipboard access can be blocked; the button is a convenience only.
    }
  };

  return (
    <div class="border-border bg-code-bg mt-4 flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
      <code class="min-w-0 truncate text-sm">{command}</code>
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
