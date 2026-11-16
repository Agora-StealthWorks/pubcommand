import { Badge } from "@pubcommand/ui";
import { locateCub, type PromoAnalysisResult, type Rated } from "../../../../../modules/promo-studio/analysis";

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Bar({ score, max = 10 }: { score: number; max?: number }) {
  const pct = Math.round((score / max) * 100);
  const color = score >= 7 ? "bg-[#12b76a]" : score >= 5 ? "bg-accent" : "bg-[#f79009]";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-canvas">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function List({ items, tone }: { items: string[]; tone?: "ok" | "warn" }) {
  if (items.length === 0) return <p className="text-sm text-muted">None noted.</p>;
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2 text-sm leading-relaxed">
          <span className={tone === "ok" ? "text-[#12b76a]" : tone === "warn" ? "text-[#f79009]" : "text-muted"} aria-hidden>
            {tone === "ok" ? "✓" : tone === "warn" ? "→" : "•"}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function OverviewTab({ result, score }: { result: PromoAnalysisResult; score: number | null }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        <Section title="Summary">
          <p className="text-sm leading-relaxed">{result.summary}</p>
          {result.sixteenWord.bigIdea ? (
            <p className="mt-3 rounded-lg bg-[#eef2ff] px-3 py-2 text-sm">
              <span className="font-semibold">Big idea: </span>
              {result.sixteenWord.bigIdea}
            </p>
          ) : null}
        </Section>
        <Section title="What works">
          <List items={result.strengths} tone="ok" />
        </Section>
        <Section title="Top fixes">
          <List items={result.fixes} tone="warn" />
        </Section>
        <Section title="Lessons for the Brain">
          <List items={result.lessons} />
        </Section>
      </div>
      <Section title="Scorecard" aside={score != null ? <span className="text-2xl font-semibold">{score.toFixed(1)}<span className="text-sm text-muted">/10</span></span> : null}>
        <ul className="space-y-3">
          {result.scores.map((item) => (
            <li key={item.name}>
              <div className="mb-1 flex justify-between text-sm">
                <span>{item.name}</span>
                <span className="font-semibold">{item.score}</span>
              </div>
              <Bar score={item.score} />
              <p className="mt-1 text-xs text-muted">{item.note}</p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function FourU({ label, value }: { label: string; value: Rated }) {
  return (
    <li>
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-semibold">{value.score}</span>
      </div>
      <Bar score={value.score} />
      <p className="mt-1 text-xs text-muted">{value.note}</p>
    </li>
  );
}

export function HeadlineTab({ result }: { result: PromoAnalysisResult }) {
  const h = result.headline;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Headline">
        {h.eyebrow ? <p className="text-xs font-semibold uppercase tracking-wide text-muted">{h.eyebrow}</p> : null}
        <p className="mt-1 text-xl font-semibold leading-snug">“{h.headline || "No headline found"}”</p>
        {h.subhead ? <p className="mt-2 text-sm text-muted">{h.subhead}</p> : null}
        <p className="mt-4 text-sm leading-relaxed">{h.verdict}</p>
      </Section>
      <Section title="The 4 U's">
        <ul className="space-y-3">
          <FourU label="Urgent" value={h.fourUs.urgent} />
          <FourU label="Unique" value={h.fourUs.unique} />
          <FourU label="Ultra-specific" value={h.fourUs.ultraSpecific} />
          <FourU label="Useful" value={h.fourUs.useful} />
        </ul>
      </Section>
      <div className="lg:col-span-2">
        <Section title="Stronger alternatives">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {h.alternatives.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ol>
        </Section>
      </div>
    </div>
  );
}

export function OutlineTab({ result }: { result: PromoAnalysisResult }) {
  return (
    <Section title="Promo outline">
      <ol className="space-y-3">
        {result.outline.map((item, index) => (
          <li key={index} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#eef2ff] text-xs font-semibold text-[#1e3a8a]">{index + 1}</span>
            <div>
              <p className="text-sm font-semibold">{item.section}</p>
              <p className="text-sm text-muted">{item.summary}</p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

const ANSWERED = { strong: { tone: "ok", label: "Strong" }, weak: { tone: "warn", label: "Weak" }, missing: { tone: "danger", label: "Missing" } } as const;

export function SixteenWordTab({ result }: { result: PromoAnalysisResult }) {
  const s = result.sixteenWord;
  return (
    <div className="space-y-4">
      <Section title="The 10 reader questions">
        <ul className="divide-y divide-line">
          {s.questions.map((q, index) => (
            <li key={index} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  {index + 1}. {q.question}
                </p>
                <Badge tone={ANSWERED[q.answered].tone}>{ANSWERED[q.answered].label}</Badge>
              </div>
              {q.evidence ? <p className="mt-1 border-l-2 border-line pl-3 text-sm italic text-muted">{q.evidence}</p> : null}
              {q.improve ? <p className="mt-1 text-sm"><span className="font-semibold">Improve: </span>{q.improve}</p> : null}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="The close">
        <ul className="grid gap-2 sm:grid-cols-2">
          {s.close.map((step, index) => (
            <li key={index} className="rounded-lg border border-line p-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className={step.present ? "text-[#12b76a]" : "text-[#f04438]"}>{step.present ? "✓" : "✗"}</span>
                {step.step}
              </div>
              <p className="mt-1 text-xs text-muted">{step.note}</p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

const CUB_STYLE = {
  confusing: { mark: "bg-[#fef0c7]", badge: "warn", label: "Confusing" },
  unbelievable: { mark: "bg-[#fee4e2]", badge: "danger", label: "Unbelievable" },
  boring: { mark: "bg-[#e0eaff]", badge: "accent", label: "Boring" },
} as const;

export function CubTab({ result, sourceText }: { result: PromoAnalysisResult; sourceText: string }) {
  const spans = sourceText ? locateCub(sourceText, result.cub) : [];
  const pieces: React.ReactNode[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) pieces.push(sourceText.slice(cursor, span.start));
    const flag = result.cub[span.index]!;
    pieces.push(
      <mark key={span.start} id={`cub-${span.index}`} className={`rounded px-0.5 ${CUB_STYLE[flag.type].mark}`} title={`${CUB_STYLE[flag.type].label}: ${flag.why}`}>
        {sourceText.slice(span.start, span.end)}
        <sup className="ml-0.5 font-semibold">{span.index + 1}</sup>
      </mark>,
    );
    cursor = span.end;
  }
  if (cursor < sourceText.length) pieces.push(sourceText.slice(cursor));
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Section title="Copy with CUB highlights" aside={<span className="text-xs text-muted">{spans.length} of {result.cub.length} found in the text</span>}>
        {sourceText ? (
          <div className="max-h-[70vh] overflow-y-auto whitespace-pre-wrap text-sm leading-7">{pieces}</div>
        ) : (
          <p className="text-sm text-muted">This promo was a scanned PDF, so highlights are listed on the right.</p>
        )}
      </Section>
      <Section title="Flags">
        <ol className="space-y-3">
          {result.cub.map((flag, index) => (
            <li key={index} className="text-sm">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{index + 1}.</span>
                <Badge tone={CUB_STYLE[flag.type].badge}>{CUB_STYLE[flag.type].label}</Badge>
              </div>
              <p className="mt-1 italic text-muted">“{flag.quote}”</p>
              <p className="mt-1">{flag.why}</p>
              <p className="mt-1"><span className="font-semibold">Fix: </span>{flag.fix}</p>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

export function OfferTab({ result }: { result: PromoAnalysisResult }) {
  const o = result.offer;
  const rows: [string, string][] = [
    ["Product", o.product],
    ["Price", o.price],
    ["Term", o.term],
    ["Guarantee", o.guarantee],
    ["Urgency", o.urgency],
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Offer">
        <dl className="space-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[110px_1fr] gap-2">
              <dt className="text-muted">{label}</dt>
              <dd>{value || "—"}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm leading-relaxed">{o.summary}</p>
      </Section>
      <Section title="Bonuses">
        <List items={o.bonuses} />
      </Section>
    </div>
  );
}

export function StockTab({ result }: { result: PromoAnalysisResult }) {
  const t = result.stockTease;
  return (
    <div className="space-y-4">
      <Section title={t.teased ? "Teased stock" : "No stock tease detected"}>
        <p className="mb-3 text-xs text-muted">These are AI guesses from the clues in the copy, not facts. Check before using.</p>
        <List items={t.clues} />
      </Section>
      {t.guesses.length ? (
        <Section title="Best guesses">
          <ul className="space-y-3">
            {t.guesses.map((guess, index) => (
              <li key={index} className="text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold">{guess.ticker}</span>
                  <span>{guess.company}</span>
                  <Badge tone={guess.confidence === "high" ? "ok" : guess.confidence === "medium" ? "accent" : "neutral"}>{guess.confidence}</Badge>
                </div>
                <p className="mt-1 text-muted">{guess.why}</p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
