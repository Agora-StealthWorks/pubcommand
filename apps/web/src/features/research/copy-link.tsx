"use client";

import { useState } from "react";

export function CopyLink({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium">{label}</p>
      <div className="mt-1 flex gap-2">
        <input readOnly value={url} className="pc-control min-w-0 flex-1 text-xs" aria-label={label} onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-canvas"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
