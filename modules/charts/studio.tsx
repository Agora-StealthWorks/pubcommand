"use client";

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import { parseCsv } from "./csv";
import type { ChartDraft, ShareResult } from "./draft";
import { EXAMPLE_CSV, FRED_TODO, PNG_TODO } from "./example";
import { BRAND_ACCENT, normalizeAccent, renderLineChartSvg } from "./svg";

const ink = "#0b1220";
const muted = "#3e4a5c";
const line = "#e1e4ea";
const canvas = "#f5f6f8";

export function ChartsStudio({
  initialCsv,
  initialAnnotation,
  initialAccent,
  canEdit,
  shareNotice,
  publishShare,
}: {
  initialCsv: string;
  initialAnnotation: string;
  initialAccent: string;
  canEdit: boolean;
  shareNotice: string | null;
  publishShare: (draft: ChartDraft) => Promise<ShareResult>;
}) {
  const [csv, setCsv] = useState(initialCsv);
  const [annotation, setAnnotation] = useState(initialAnnotation);
  const [accent, setAccent] = useState(normalizeAccent(initialAccent));
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const parsed = useMemo(() => parseCsv(csv), [csv]);
  const svg = parsed.ok ? renderLineChartSvg({ chart: parsed.chart, accent, annotation }) : null;

  function onShare() {
    setActionError(null);
    startTransition(async () => {
      const result = await publishShare({ csv, annotation, accent });
      if ("error" in result) {
        setShareUrl(null);
        setActionError(result.error);
        return;
      }
      setShareUrl(result.url);
    });
  }

  function onDownload() {
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "chart.svg";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <style>{`
        .pc-charts-grid { display: grid; gap: 16px; }
        @media (min-width: 880px) {
          .pc-charts-grid { grid-template-columns: 320px minmax(0, 1fr); align-items: start; }
        }
      `}</style>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em", color: ink }}>Charts</h1>
        <p style={{ margin: "6px 0 0", maxWidth: 640, fontSize: 14, color: muted }}>
          Paste a two-column CSV. The line uses the brand accent. Share links stay inside this organization.
        </p>
      </header>
      {shareNotice ? (
        <p style={{ margin: "0 0 12px", padding: "8px 12px", border: "1px solid #fecdca", background: "#fef3f2", borderRadius: 6, color: "#912018", fontSize: 14 }}>
          {shareNotice}
        </p>
      ) : null}
      <div className="pc-charts-grid">
        <section style={card}>
          <label style={labelStyle} htmlFor="chart-csv">
            CSV
            <textarea
              id="chart-csv"
              value={csv}
              disabled={!canEdit}
              onChange={(event) => setCsv(event.target.value)}
              rows={12}
              spellCheck={false}
              style={{ ...field, marginTop: 6, resize: "vertical", fontFamily: "ui-monospace, monospace", lineHeight: 1.45 }}
            />
          </label>
          <label style={{ ...labelStyle, marginTop: 12 }} htmlFor="chart-note">
            Annotation
            <input
              id="chart-note"
              value={annotation}
              disabled={!canEdit}
              onChange={(event) => setAnnotation(event.target.value)}
              placeholder="Readers are up this spring"
              style={{ ...field, marginTop: 6 }}
            />
          </label>
          <label style={{ ...labelStyle, marginTop: 12 }} htmlFor="chart-accent">
            Brand accent
            <input
              id="chart-accent"
              type="color"
              value={accent}
              disabled={!canEdit}
              onChange={(event) => setAccent(normalizeAccent(event.target.value))}
              style={{ display: "block", marginTop: 6, width: 48, height: 32, padding: 0, border: `1px solid ${line}`, background: "#fff" }}
            />
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
            <button type="button" disabled={!canEdit} onClick={() => setCsv(EXAMPLE_CSV)} style={canEdit ? secondary : disabledButton}>
              Example CSV
            </button>
            <button type="button" disabled={!svg} onClick={onDownload} style={svg ? secondary : disabledButton}>
              Export SVG
            </button>
            <button type="button" disabled title={PNG_TODO} style={disabledButton}>
              Export PNG
            </button>
            <button type="button" disabled={!canEdit || pending || !parsed.ok} onClick={onShare} style={canEdit && parsed.ok && !pending ? primary : disabledButton}>
              {pending ? "Signing…" : "Share link"}
            </button>
          </div>
          {parsed.ok ? null : <p style={errorText}>{parsed.error}</p>}
          {actionError ? <p style={errorText}>{actionError}</p> : null}
          {shareUrl ? (
            <p style={{ marginTop: 12, fontSize: 13, color: ink, wordBreak: "break-all" }}>
              <a href={shareUrl} style={{ color: BRAND_ACCENT }}>{shareUrl}</a>
            </p>
          ) : null}
          <p style={{ margin: "16px 0 0", fontSize: 12, color: muted }}>{FRED_TODO}</p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: muted }}>{PNG_TODO}</p>
        </section>
        <section style={{ ...card, overflow: "auto" }}>
          {svg ? (
            <div dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <p style={{ margin: 0, fontSize: 14, color: muted }}>The chart appears when the CSV has a header and numeric rows.</p>
          )}
        </section>
      </div>
    </div>
  );
}

const card: CSSProperties = {
  background: "#fff",
  border: `1px solid ${line}`,
  borderRadius: 8,
  padding: 16,
};

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: muted,
};

const field: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: `1px solid ${line}`,
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 14,
  color: ink,
  background: "#fff",
};

const primary: CSSProperties = {
  height: 36,
  padding: "0 12px",
  borderRadius: 6,
  border: `1px solid ${BRAND_ACCENT}`,
  background: BRAND_ACCENT,
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const secondary: CSSProperties = {
  ...primary,
  background: "#fff",
  color: ink,
  borderColor: line,
};

const disabledButton: CSSProperties = {
  ...secondary,
  color: muted,
  background: canvas,
  cursor: "not-allowed",
};

const errorText: CSSProperties = {
  margin: "12px 0 0",
  fontSize: 13,
  color: "#912018",
};
