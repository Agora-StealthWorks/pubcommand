import { Badge } from "@pubcommand/ui";
import { locateCub, readingEaseLabel } from "../../../../../modules/promo-studio/analysis";
import type { ParsedAnalysis, ParsedCubFlag, ParsedHeadline, ParsedOffer, ParsedOutlineItem, ParsedSixteenWord, ParsedTease } from "../../../../../modules/promo-studio/parse";
import { DIMENSION_WEIGHTS, scoreBand, type Scorecard } from "../../../../../modules/promo-studio/score";
import { cubQuotes } from "../../../../../modules/promo-studio/stored";

/**
 * The analysis results, one view per section. Plain components with no state,
 * so the finished page (server) and the live view (client) render the same.
 */

export function Panel({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-white p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const BAND_STYLE = {
  high: { badge: "border-[#abefc6] bg-[#ecfdf3] text-[#067647]", bar: "bg-[#12b76a]", text: "text-[#067647]" },
  mid: { badge: "border-[#fedf89] bg-[#fffaeb] text-[#b54708]", bar: "bg-[#fdb022]", text: "text-[#b54708]" },
  low: { badge: "border-[#fecdca] bg-[#fef3f2] text-[#b42318]", bar: "bg-[#f04438]", text: "text-[#b42318]" },
} as const;

/** Reading ease, grade level and the copy score, as in the old analyzer's badge row. */
export function ScoreBadges({ final, fk, inputLabel }: { final: number | null; fk: { ease: number; grade: number } | null; inputLabel?: string | null }) {
  if (final == null && !fk && !inputLabel) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {fk ? (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#c7d7fe] bg-[#eef4ff] px-3 py-1.5 text-sm text-[#1e3a8a]" title="Flesch reading ease: higher is easier">
            Reading ease <strong className="text-base">{fk.ease}</strong>
            <span className="text-xs opacity-75">({readingEaseLabel(fk.ease)})</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#c7d7fe] bg-[#eef4ff] px-3 py-1.5 text-sm text-[#1e3a8a]" title="Flesch-Kincaid grade level">
            Grade level <strong className="text-base">{fk.grade}</strong>
          </span>
        </>
      ) : null}
      {final != null ? (
        <span className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${BAND_STYLE[scoreBand(final)].badge}`}>
          Copy score <strong className="text-base tabular-nums">{final.toFixed(1)}/10</strong>
        </span>
      ) : null}
      {inputLabel ? <Badge tone="accent" title="What the AI read">{inputLabel}</Badge> : null}
    </div>
  );
}

const U_TONE = { present: "ok", weak: "warn", absent: "neutral" } as const;

export function HeadlineView({ headline }: { headline: ParsedHeadline }) {
  const block: [string, string][] = [
    ["Eyebrow", headline.eyebrow],
    ["Headline", headline.headline],
    ["Subhead", headline.subhead],
  ];
  return (
    <div className="space-y-4">
      <Panel title="Headline block">
        <div className="space-y-2">
          {block.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-line bg-canvas px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
              <p className={`pc-break mt-0.5 ${label === "Headline" ? "text-lg font-semibold leading-snug" : "text-sm"}`}>{value || <span className="text-muted">None</span>}</p>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="The 4 U's" aside={<span className="text-xs text-muted">Judged on the headline block only</span>}>
        {headline.fourUs.length ? (
          <ul className="space-y-3">
            {headline.fourUs.map((u) => (
              <li key={u.label} className="grid gap-1 sm:grid-cols-[120px_90px_1fr] sm:items-start sm:gap-3">
                <span className="text-sm font-semibold">{u.label}</span>
                <span>{u.rating ? <Badge tone={U_TONE[u.rating]} className="uppercase">{u.rating}</Badge> : <Badge>?</Badge>}</span>
                <p className="text-sm text-muted">{u.note}</p>
              </li>
            ))}
          </ul>
        ) : (
          <Missing />
        )}
        {headline.verdict ? <p className="mt-4 border-t border-line pt-3 text-sm leading-relaxed">{headline.verdict}</p> : null}
      </Panel>
    </div>
  );
}

export function OutlineView({ outline }: { outline: ParsedOutlineItem[] }) {
  return (
    <Panel title="Promo outline">
      {outline.length ? (
        <ol className="space-y-2">
          {outline.map((item, index) => (
            <li key={index} className="flex gap-3 rounded-lg border border-line bg-canvas p-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">{index + 1}</span>
              <div className="min-w-0">
                <p className="pc-break text-sm font-semibold">{item.title}</p>
                {item.purpose ? <p className="mt-0.5 text-sm text-muted">{item.purpose}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <Missing />
      )}
    </Panel>
  );
}

const STRENGTH = { strong: { tone: "ok", label: "Strong" }, weak: { tone: "warn", label: "Present but weak" }, missing: { tone: "danger", label: "Missing" } } as const;

export function SixteenWordView({ sixteen }: { sixteen: ParsedSixteenWord }) {
  const group = (kind: "question" | "close") => sixteen.items.filter((i) => i.kind === kind);
  const row = (item: ParsedSixteenWord["items"][number]) => (
    <li key={`${item.kind}${item.number}`} className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {item.kind === "question" ? `${item.number}. ` : ""}
          {item.label}
        </p>
        {item.rating ? <Badge tone={STRENGTH[item.rating].tone}>{STRENGTH[item.rating].label}</Badge> : <Badge>?</Badge>}
      </div>
      {item.note ? <p className="mt-1 text-sm text-muted">{item.note}</p> : null}
    </li>
  );
  if (!sixteen.items.length && !sixteen.verdict) return <Panel title="16-Word Sales Letter"><Missing /></Panel>;
  return (
    <div className="space-y-4">
      <Panel title="The 10 reader questions">
        <ul className="divide-y divide-line">{group("question").map(row)}</ul>
      </Panel>
      <Panel title="The close" aside={<span className="text-xs text-muted">Testimonials count least</span>}>
        <ul className="divide-y divide-line">{group("close").map(row)}</ul>
      </Panel>
      {sixteen.verdict ? (
        <Panel title="Verdict">
          <p className="text-sm leading-relaxed">{sixteen.verdict}</p>
        </Panel>
      ) : null}
    </div>
  );
}

const CUB_STYLE = {
  confusing: { mark: "bg-[#fef0c7]", row: "border-[#fedf89] bg-[#fffaeb]", swatch: "bg-[#fdb022]", label: "Confusing", tone: "warn" },
  unbelievable: { mark: "bg-[#fee4e2]", row: "border-[#fecdca] bg-[#fef3f2]", swatch: "bg-[#f04438]", label: "Unbelievable", tone: "danger" },
  boring: { mark: "bg-[#eaecf0]", row: "border-line bg-canvas", swatch: "bg-[#98a2b3]", label: "Boring", tone: "neutral" },
} as const;
const CUB_ORDER = ["confusing", "unbelievable", "boring"] as const;

/** Counts, the flagged lines grouped by type, and the copy with each flag highlighted. */
export function CubView({ flags, raw, sourceText }: { flags: ParsedCubFlag[] | null; raw: string; sourceText: string }) {
  if (flags === null) {
    return (
      <Panel title="CUB review">
        {raw.trim() ? (
          <>
            <p className="text-sm text-[#93370d]">The CUB review could not be read. The raw answer is below; re-analyze to try again.</p>
            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-canvas p-2 text-xs">{raw.slice(0, 2000)}</pre>
          </>
        ) : (
          <Missing />
        )}
      </Panel>
    );
  }
  const counts = Object.fromEntries(CUB_ORDER.map((t) => [t, flags.filter((f) => f.type === t).length])) as Record<(typeof CUB_ORDER)[number], number>;
  const spans = sourceText ? locateCub(sourceText, cubQuotes(flags)) : [];
  const pieces: React.ReactNode[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) pieces.push(sourceText.slice(cursor, span.start));
    const flag = flags[span.index]!;
    pieces.push(
      <mark key={span.start} className={`rounded px-0.5 ${CUB_STYLE[flag.type].mark}`} title={`${CUB_STYLE[flag.type].label}: ${flag.reason}`}>
        {sourceText.slice(span.start, span.end)}
      </mark>,
    );
    cursor = span.end;
  }
  if (cursor < sourceText.length) pieces.push(sourceText.slice(cursor));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {CUB_ORDER.map((type) => (
          <span key={type} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${CUB_STYLE[type].row}`}>
            <span className={`h-2.5 w-2.5 rounded-sm ${CUB_STYLE[type].swatch}`} aria-hidden />
            {CUB_STYLE[type].label}: {counts[type]}
          </span>
        ))}
        <span className="text-xs text-muted">{flags.length} flag{flags.length === 1 ? "" : "s"}</span>
      </div>
      {flags.length === 0 ? (
        <Panel title="CUB review">
          <p className="text-sm text-muted">No flags. The copy reads clean for this reader.</p>
        </Panel>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Panel title="Copy with flags highlighted" aside={sourceText ? <span className="text-xs text-muted">{spans.length} of {flags.length} found in the text</span> : null}>
            {sourceText ? (
              <div className="pc-break max-h-[70vh] overflow-y-auto whitespace-pre-wrap text-sm leading-7">{pieces}</div>
            ) : (
              <p className="text-sm text-muted">This promo was a scanned PDF, so there is no text to highlight. The flags are listed here.</p>
            )}
          </Panel>
          <div className="space-y-4">
            {CUB_ORDER.map((type) => {
              const items = flags.filter((f) => f.type === type);
              if (!items.length) return null;
              return (
                <section key={type}>
                  <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted">
                    <span className={`h-3 w-3 rounded-sm ${CUB_STYLE[type].swatch}`} aria-hidden />
                    {CUB_STYLE[type].label} — {items.length}
                  </h3>
                  <ul className="space-y-2">
                    {items.map((item, index) => (
                      <li key={index} className={`rounded-lg border px-3 py-2 ${CUB_STYLE[type].row}`}>
                        <p className="pc-break text-sm">“{item.text}”</p>
                        {item.reason ? <p className="mt-1 text-xs italic text-muted">{item.reason}</p> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Code found these Publication Setup names in the copy; its publisher beats the AI's guess. */
export type Attribution = { publisher: string; names: string };

function OfferDetails({ offer, attribution }: { offer: ParsedOffer; attribution: Attribution | null }) {
  const aiDiffers = attribution && offer.publisher && offer.publisher.toLowerCase() !== attribution.publisher.toLowerCase();
  const rows: [string, React.ReactNode][] = [
    [
      "Publisher",
      <span key="p" className="flex flex-wrap items-center gap-2">
        {attribution ? attribution.publisher : offer.publisher || "—"}
        {attribution ? <Badge tone="ok" title={`Named in the copy: ${attribution.names}`}>Matched in Publication Setup</Badge> : offer.publisherInferred ? <Badge tone="warn">Inferred, low confidence</Badge> : null}
        {aiDiffers ? <span className="text-xs text-muted">(the AI guessed {offer.publisher})</span> : null}
      </span>,
    ],
    ["Product", offer.product || "—"],
    ["What it is", offer.whatItIs || "—"],
    ["Prices", offer.prices || "—"],
    ["Payment options", offer.paymentOptions || "—"],
    ["Guarantee", offer.guarantee || "—"],
    ["Urgency", offer.urgency || "—"],
  ];
  return (
    <Panel title="Offer details">
      <dl className="space-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-0.5 sm:grid-cols-[140px_1fr] sm:gap-2">
            <dt className="font-semibold text-muted">{label}</dt>
            <dd className="pc-break">{value}</dd>
          </div>
        ))}
        <div className="grid gap-0.5 sm:grid-cols-[140px_1fr] sm:gap-2">
          <dt className="font-semibold text-muted">Premiums</dt>
          <dd>
            {offer.premiums.length ? (
              <ul className="list-disc space-y-0.5 pl-5">
                {offer.premiums.map((p, i) => (
                  <li key={i} className="pc-break">{p}</li>
                ))}
              </ul>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

export function TeaseView({ tease }: { tease: ParsedTease }) {
  if (!tease.present) return null;
  return (
    <section className="rounded-xl border border-[#fedf89] bg-[#fffaeb] p-4 sm:p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-[#93370d]">Tease{tease.subject ? `: ${tease.subject}` : ""}</h2>
        {tease.confidence ? <Badge tone={tease.confidence === "high" ? "ok" : tease.confidence === "medium" ? "accent" : "neutral"}>{tease.confidence} confidence</Badge> : null}
      </div>
      <p className="mb-2 text-xs text-[#93370d]">Guesses come from the clues in the copy. They are not facts; check before using.</p>
      {tease.clues.length ? (
        <>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#93370d]">Clues</p>
          <ul className="mb-2 list-disc space-y-0.5 pl-5 text-sm">{tease.clues.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </>
      ) : null}
      {tease.guesses.length ? (
        <>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#93370d]">Best guesses</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">{tease.guesses.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </>
      ) : null}
    </section>
  );
}

/** The eight dimension bars, the adjustment, the final score and the rationale. */
export function ScorecardView({ card, calibrated }: { card: Scorecard; calibrated?: boolean }) {
  return (
    <Panel
      title="Copy score"
      aside={card.final != null ? <span className={`text-2xl font-semibold tabular-nums ${BAND_STYLE[scoreBand(card.final)].text}`}>{card.final.toFixed(1)}<span className="text-sm text-muted">/10</span></span> : null}
    >
      {card.dimensions.length ? (
        <ul className="space-y-3">
          {card.dimensions.map((d) => (
            <li key={d.name}>
              <div className="mb-1 flex justify-between gap-2 text-sm">
                <span className="font-semibold">
                  {d.name}
                  <span className="ml-1 text-[11px] font-normal text-muted">×{DIMENSION_WEIGHTS[d.name]}</span>
                </span>
                <span className={`font-semibold tabular-nums ${BAND_STYLE[scoreBand(d.score)].text}`}>{d.score}/10</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-canvas">
                <div className={`h-full rounded-full ${BAND_STYLE[scoreBand(d.score)].bar}`} style={{ width: `${(d.score / 10) * 100}%` }} />
              </div>
              {d.rationale ? <p className="mt-1 text-xs text-muted">{d.rationale}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <Missing />
      )}
      {card.blended != null ? (
        <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
          Weighted blend {card.blended.toFixed(1)}
          {card.adjustment ? (
            <>
              {" "}
              · AI adjustment <strong className="text-ink">{card.adjustment.value > 0 ? "+" : ""}{card.adjustment.value}</strong>
              {card.adjustment.reason ? ` (${card.adjustment.reason})` : ""}
            </>
          ) : null}{" "}
          · final {card.final?.toFixed(1)}. The final score is calculated, not chosen by the AI.
        </p>
      ) : null}
      {card.rationale ? <p className="mt-3 text-sm leading-relaxed">{card.rationale}</p> : null}
      {calibrated ? <p className="mt-2 text-xs text-muted">Score updated with publisher training feedback.</p> : null}
    </Panel>
  );
}

/** The Summary tab: big idea, offer, tease, score (the old analyzer's first tab). */
export function SummaryView({ parsed, card, calibrated, attribution, missing }: { parsed: ParsedAnalysis; card: Scorecard; calibrated?: boolean; attribution: Attribution | null; missing: string[] }) {
  return (
    <div className="space-y-4">
      {missing.length ? (
        <p className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">Not finished: {missing.join(", ")}. Re-analyze for a full review.</p>
      ) : null}
      {parsed.offer.bigIdea ? (
        <div className="rounded-xl border border-[#c7d7fe] bg-[#eef4ff] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#1e3a8a]">Big idea</p>
          <p className="mt-1 text-sm leading-relaxed">{parsed.offer.bigIdea}</p>
        </div>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <OfferDetails offer={parsed.offer} attribution={attribution} />
          <TeaseView tease={parsed.tease} />
        </div>
        <ScorecardView card={card} calibrated={calibrated} />
      </div>
    </div>
  );
}

export function Missing() {
  return <p className="text-sm text-muted">This section is missing from the answer.</p>;
}
