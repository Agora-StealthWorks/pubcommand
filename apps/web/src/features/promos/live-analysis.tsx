"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseAnalysis } from "../../../../../modules/promo-studio/parse";
import { activeSection, progressPercent, SECTION_KEYS, SECTION_LABELS, splitSections, type SectionKey } from "../../../../../modules/promo-studio/sections";
import { CubView, HeadlineView, OutlineView, SixteenWordView, SummaryView } from "./sections-view";

type Live = { status: string; error: string | null; text: string; startedAt: string | null };

const TABS: { key: "live" | "summary" | "headline" | "outline" | "sixteen" | "cub"; label: string; needs: SectionKey[] }[] = [
  { key: "live", label: "Live", needs: [] },
  { key: "summary", label: "Summary", needs: ["OFFER", "TEASE", "SCORECARD"] },
  { key: "headline", label: "Headline", needs: ["HEADLINE"] },
  { key: "outline", label: "Outline", needs: ["OUTLINE"] },
  { key: "sixteen", label: "16-Word Sales Letter", needs: ["SIXTEEN_WORD"] },
  { key: "cub", label: "CUB Review", needs: ["CUB"] },
];

/**
 * The analysis as the AI writes it. Polls the promo row (the server writes the
 * answer so far about once a second), so it works the same after a reload or
 * from another device, and the run carries on if this tab is closed. When the
 * run ends the page reloads into the formatted result.
 */
export function LiveAnalysis({ promoId, sourceText, initial, everyMs = 1000 }: { promoId: string; sourceText: string; initial: Live; everyMs?: number }) {
  const router = useRouter();
  const [live, setLive] = useState<Live>(initial);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("live");
  const [elapsed, setElapsed] = useState(0);
  const tail = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = initial.startedAt ? Date.parse(initial.startedAt) : Date.now();
    const tick = setInterval(() => setElapsed(Math.max(0, Math.round((Date.now() - started) / 1000))), 1000);
    const poll = async () => {
      try {
        const res = await fetch(`/promo-studio/${promoId}/live`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as Live;
          if (stopped) return;
          setLive(next);
          if (next.status !== "RUNNING" && next.status !== "QUEUED") {
            stopped = true;
            router.refresh();
            return;
          }
        }
      } catch {
        // Offline for a moment; the next poll catches up.
      }
      if (!stopped) timer = setTimeout(poll, everyMs);
    };
    timer = setTimeout(poll, everyMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [promoId, everyMs, router, initial.startedAt]);

  const split = useMemo(() => splitSections(live.text), [live.text]);
  const parsed = useMemo(() => parseAnalysis(Object.fromEntries(SECTION_KEYS.filter((k) => split[k]?.complete).map((k) => [k, split[k]!.text]))), [split]);
  const active = activeSection(split);
  const pct = progressPercent(split);
  const activeText = active ? plainMarkdown(split[active]!.text) : "";

  useEffect(() => {
    if (tail.current) tail.current.scrollTop = tail.current.scrollHeight;
  }, [activeText]);

  const done = (keys: SectionKey[]) => keys.length > 0 && keys.every((k) => split[k]?.complete);
  const queued = live.status === "QUEUED" || (!live.text && live.status === "RUNNING");

  return (
    <div className="space-y-4" data-live-analysis>
      <div className="rounded-xl border border-[#c7d7fe] bg-[#eef4ff] p-3 text-[#1e3a8a]">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
          <span className="flex min-w-0 items-center gap-2 font-medium">
            <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-[#1e3a8a] border-t-transparent" aria-hidden />
            <span className="truncate">{queued ? "Starting the analysis…" : active ? `Writing ${SECTION_LABELS[active]}…` : "Wrapping up…"}</span>
          </span>
          <span className="shrink-0 tabular-nums text-xs font-semibold">
            {pct}% · {elapsed}s
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[#c7d7fe]">
          <div className="h-full rounded-full bg-[#1e3a8a] transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          {SECTION_KEYS.map((key) => {
            const state = split[key]?.complete ? "done" : key === active ? "active" : "waiting";
            return (
              <li key={key} className={`flex items-center gap-1 ${state === "waiting" ? "opacity-50" : ""}`}>
                <span className={`h-2 w-2 rounded-full ${state === "done" ? "bg-[#12b76a]" : state === "active" ? "animate-pulse bg-[#1e3a8a]" : "bg-[#98a2b3]"}`} aria-hidden />
                {SECTION_LABELS[key]}
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-xs">It keeps going on the server if you close this tab, and saves when it is done.</p>
      </div>

      <nav className="-mx-1 flex gap-1 overflow-x-auto border-b border-line" aria-label="Analysis sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-medium ${tab === t.key ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}
          >
            {t.label}
            {t.needs.length ? <span className={`h-1.5 w-1.5 rounded-full ${done(t.needs) ? "bg-[#12b76a]" : "animate-pulse bg-line"}`} aria-hidden /> : null}
          </button>
        ))}
      </nav>

      {tab === "live" ? (
        <div className="space-y-3">
          {SECTION_KEYS.filter((k) => split[k]?.complete).map((key) => (
            <details key={key} className="rounded-xl border border-line bg-white px-4 py-3">
              <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                <span className="text-[#12b76a]" aria-hidden>✓</span>
                {SECTION_LABELS[key]}
              </summary>
              <pre className="pc-break mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-6 text-muted">{plainMarkdown(split[key]!.text)}</pre>
            </details>
          ))}
          {active ? (
            <section className="rounded-xl border border-accent bg-white px-4 py-3" aria-live="polite">
              <p className="mb-2 text-sm font-semibold text-accent">{SECTION_LABELS[active]}</p>
              <pre ref={tail} className="pc-break max-h-[50vh] overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-6">
                {activeText}
                <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent align-middle" aria-hidden />
              </pre>
            </section>
          ) : (
            <p className="rounded-xl border border-dashed border-line bg-white px-4 py-6 text-center text-sm text-muted">{queued ? "Waiting for the AI to start…" : "Saving the review…"}</p>
          )}
        </div>
      ) : null}
      {tab === "summary" ? (done(["OFFER"]) || done(["SCORECARD"]) ? <SummaryView parsed={parsed} card={parsed.scorecard} attribution={null} missing={[]} /> : <Waiting />) : null}
      {tab === "headline" ? (done(["HEADLINE"]) ? <HeadlineView headline={parsed.headline} /> : <Waiting />) : null}
      {tab === "outline" ? (done(["OUTLINE"]) ? <OutlineView outline={parsed.outline} /> : <Waiting />) : null}
      {tab === "sixteen" ? (done(["SIXTEEN_WORD"]) ? <SixteenWordView sixteen={parsed.sixteenWord} /> : <Waiting />) : null}
      {tab === "cub" ? (done(["CUB"]) ? <CubView flags={parsed.cub} raw={split.CUB?.text ?? ""} sourceText={sourceText} /> : <Waiting text="Reviewing the full copy line by line. This is the longest step." />) : null}
    </div>
  );
}

function Waiting({ text = "This section is not written yet." }: { text?: string }) {
  return <p className="rounded-xl border border-dashed border-line bg-white px-4 py-10 text-center text-sm text-muted">{text}</p>;
}

/** The raw answer without markdown emphasis, for reading while it streams. */
function plainMarkdown(text: string): string {
  return text.replace(/\*\*|__/g, "");
}
