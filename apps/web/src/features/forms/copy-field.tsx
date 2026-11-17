"use client";

import { useState } from "react";

export function CopyField({ value, label, multiline = false }: { value: string; label: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex min-w-0 items-start gap-2">
      {multiline ? (
        <textarea readOnly aria-label={label} value={value} rows={2} className="pc-control min-w-0 flex-1 font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
      ) : (
        <input readOnly aria-label={label} value={value} className="pc-control min-w-0 flex-1 font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
      )}
      <button type="button" onClick={copy} className="min-h-11 shrink-0 rounded-md border border-line bg-white px-3 text-sm font-semibold">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
