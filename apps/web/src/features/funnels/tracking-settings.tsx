"use client";

import { Button, Input } from "@pubcommand/ui";
import { useState } from "react";
import { MAX_TRACKED_PARAMS, normalizeParamKey } from "../../../../../modules/funnels/tracking";

/** Chips with remove buttons plus an add box. Each chip posts as a hidden `param` field. */
export function TrackedParamsEditor({ initial }: { initial: string[] }) {
  const [params, setParams] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add() {
    const pieces = draft.split(/[\s,]+/).filter(Boolean);
    if (!pieces.length) return;
    const next = [...params];
    for (const piece of pieces) {
      const key = normalizeParamKey(piece);
      if (!key) {
        setError(`“${piece.slice(0, 50)}” is not a valid name: use a–z, 0–9 and _ (up to 40 characters).`);
        return;
      }
      if (!next.includes(key)) next.push(key);
    }
    if (next.length > MAX_TRACKED_PARAMS) {
      setError(`Up to ${MAX_TRACKED_PARAMS} parameters.`);
      return;
    }
    setParams(next);
    setDraft("");
    setError(null);
  }

  return (
    <div className="space-y-3">
      {params.length ? (
        <ul className="flex flex-wrap gap-2" aria-label="Tracked parameters">
          {params.map((param) => (
            <li key={param} className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-canvas py-1 pl-3 pr-1 text-sm">
              <input type="hidden" name="param" value={param} />
              <span className="min-w-0 truncate font-mono text-xs">{param}</span>
              <button
                type="button"
                onClick={() => setParams(params.filter((item) => item !== param))}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-white hover:text-ink"
                aria-label={`Remove ${param}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No parameters: funnels record no URL parameters.</p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="new-param"
          aria-label="Add a parameter"
          value={draft}
          maxLength={200}
          placeholder="e.g. gclid or fbclid"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          className="min-w-0 flex-1 font-mono text-sm"
        />
        <Button type="button" variant="secondary" onClick={add} className="w-full sm:w-auto">
          Add
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-[#b91c1c]" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-xs text-muted">
        {params.length}/{MAX_TRACKED_PARAMS}. Names are lowercase letters, numbers and _. Changes apply after you save.
      </p>
    </div>
  );
}
