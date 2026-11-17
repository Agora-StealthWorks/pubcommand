import { describe, expect, it } from "vitest";
import {
  attributeEditor,
  attributePositions,
  editorForExpertName,
  editorTrackSummaries,
  expertForEditor,
  portfolioPublication,
  statsByEditor,
  type PubRef,
  type SummaryPortfolio,
  type SummaryPosition,
} from "./attribution";
import { planImport } from "./positions";
import { weeklySummary } from "./stats";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

const ANN = "00000000-0000-4000-8000-00000000000a";
const BOB = "00000000-0000-4000-8000-00000000000b";
const CY = "00000000-0000-4000-8000-00000000000c";

describe("attributeEditor", () => {
  it("prefers the position, then the portfolio default, then a single-editor publication", () => {
    expect(attributeEditor({ positionEditorId: ANN, portfolioDefaultEditorId: BOB, publicationEditorIds: [CY] })).toEqual({ editorId: ANN, via: "position" });
    expect(attributeEditor({ positionEditorId: null, portfolioDefaultEditorId: BOB, publicationEditorIds: [CY] })).toEqual({ editorId: BOB, via: "portfolio" });
    expect(attributeEditor({ positionEditorId: null, portfolioDefaultEditorId: null, publicationEditorIds: [CY] })).toEqual({ editorId: CY, via: "publication" });
  });

  it("leaves a position unattributed when the publication has several editors or none", () => {
    expect(attributeEditor({ positionEditorId: null, portfolioDefaultEditorId: null, publicationEditorIds: [ANN, BOB] })).toEqual({ editorId: null, via: "none" });
    expect(attributeEditor({ positionEditorId: null, portfolioDefaultEditorId: null, publicationEditorIds: [] })).toEqual({ editorId: null, via: "none" });
    // The same editor linked twice is still one editor.
    expect(attributeEditor({ positionEditorId: undefined, portfolioDefaultEditorId: undefined, publicationEditorIds: [ANN, ANN] }).editorId).toBe(ANN);
  });
});

describe("portfolioPublication", () => {
  const pubs = [
    { id: "p1", code: "TPW", name: "The Pro Weekly", slug: "tpw" },
    { id: "p2", code: "WEEKLY", name: "Weekly", slug: "weekly" },
  ];
  it("matches code first, then name or slug, case-insensitively and exactly", () => {
    expect(portfolioPublication("tpw", pubs)?.id).toBe("p1");
    expect(portfolioPublication(" the pro weekly ", pubs)?.id).toBe("p1");
    expect(portfolioPublication("Weekly", pubs)?.id).toBe("p2");
    expect(portfolioPublication("Pro", pubs)).toBeNull();
    expect(portfolioPublication("", pubs)).toBeNull();
  });
});

function pos(id: string, portfolioId: string, editorId: string | null, status: "OPEN" | "CLOSED", gainPct: number | null, stale = false): SummaryPosition {
  return {
    id,
    portfolioId,
    editorId,
    symbol: id.toUpperCase(),
    name: "",
    direction: "LONG",
    status,
    entryDate: d("2026-01-02"),
    exitDate: status === "CLOSED" ? d("2026-03-02") : null,
    entryPrice: 10,
    exitPrice: status === "CLOSED" ? 10 * (1 + (gainPct ?? 0) / 100) : null,
    gainPct,
    holdDays: 59,
    weight: 1,
    stale,
  };
}

describe("editorTrackSummaries", () => {
  // Shared publication "Duo" (Ann + Bob), solo publication "Solo" (Cy), and a portfolio with an unknown publication.
  const publications: PubRef[] = [
    { id: "duo", code: "DUO", name: "Duo Letter", slug: "duo", editorIds: [ANN, BOB] },
    { id: "solo", code: "SOLO", name: "Solo Letter", slug: "solo", editorIds: [CY] },
    { id: "empty", code: "EMPTY", name: "No Portfolio", slug: "empty", editorIds: [ANN] },
  ];
  const portfolios: SummaryPortfolio[] = [
    { id: "pf-duo", name: "Duo model book", publication: "DUO", defaultEditorId: null },
    { id: "pf-solo", name: "Solo portfolio", publication: "Solo Letter", defaultEditorId: null },
    { id: "pf-other", name: "Side trades", publication: "Not in setup", defaultEditorId: BOB },
  ];
  const positions: SummaryPosition[] = [
    pos("a1", "pf-duo", ANN, "CLOSED", 20),
    pos("a2", "pf-duo", ANN, "CLOSED", -10),
    pos("a3", "pf-duo", ANN, "OPEN", 5, true),
    pos("b1", "pf-duo", BOB, "CLOSED", 50),
    pos("u1", "pf-duo", null, "CLOSED", 99),
    pos("u2", "pf-duo", null, "OPEN", 1),
    pos("c1", "pf-solo", null, "CLOSED", 30),
    pos("c2", "pf-solo", null, "OPEN", -4),
    pos("g1", "pf-solo", ANN, "CLOSED", 7),
    pos("o1", "pf-other", null, "CLOSED", 12),
  ];
  const run = (editorId: string, editorPublicationIds: string[]) => editorTrackSummaries({ editorId, editorPublicationIds, portfolios, publications, positions });

  it("counts only the editor's own positions in a shared publication", () => {
    const ann = run(ANN, ["duo", "empty"]);
    const duo = ann.find((s) => s.key === "duo");
    expect(duo?.shared).toBe(true);
    expect(duo?.stats.closed).toBe(2);
    expect(duo?.stats.winRate).toBe(0.5);
    expect(duo?.stats.avgGain).toBe(5);
    expect(duo?.stats.best?.symbol).toBe("A1");
    expect(duo?.stats.open).toBe(1);
    expect(duo?.stats.avgOpenGain).toBe(5);
    expect(duo?.staleCount).toBe(1);
    // Unattributed positions are counted for nobody and reported per portfolio.
    expect(duo?.unassigned).toEqual([{ portfolioId: "pf-duo", portfolioName: "Duo model book", count: 2 }]);
    const bob = run(BOB, ["duo"]).find((s) => s.key === "duo");
    expect(bob?.stats.closed).toBe(1);
    expect(bob?.stats.avgGain).toBe(50);
  });

  it("credits a single-editor publication to its editor, minus positions set to someone else", () => {
    const cy = run(CY, ["solo"]);
    expect(cy).toHaveLength(1);
    expect(cy[0]?.stats.closed).toBe(1);
    expect(cy[0]?.stats.avgGain).toBe(30);
    expect(cy[0]?.stats.open).toBe(1);
    expect(cy[0]?.shared).toBe(false);
    expect(cy[0]?.unassigned).toEqual([]);
  });

  it("adds a card for a publication the editor does not write for only when they have positions there", () => {
    const ann = run(ANN, ["duo", "empty"]);
    expect(ann.map((s) => s.key)).toEqual(["duo", "solo"]);
    expect(ann.find((s) => s.key === "solo")?.stats.closed).toBe(1);
    // A publication with no portfolio gets no card.
    expect(ann.some((s) => s.key === "empty")).toBe(false);
    const bob = run(BOB, ["duo"]);
    const other = bob.find((s) => s.key === "portfolio:pf-other");
    expect(other?.label).toBe("Not in setup");
    expect(other?.stats.closed).toBe(1);
  });

  it("shows an empty card for a publication the editor writes for with no positions credited", () => {
    const cards = editorTrackSummaries({ editorId: BOB, editorPublicationIds: ["duo"], portfolios, publications, positions: positions.filter((p) => p.editorId !== BOB) });
    const duo = cards.find((s) => s.key === "duo");
    expect(duo?.stats.closed).toBe(0);
    expect(duo?.stats.winRate).toBeNull();
  });

  it("feeds per-editor aggregates into the weekly Brain note", () => {
    const attributed = attributePositions(positions.filter((p) => p.portfolioId === "pf-duo"), portfolios, publications);
    const editors = statsByEditor(attributed, new Map([[ANN, "Ann Analyst"], [BOB, "Bob Broker"]]));
    expect(editors.map((e) => [e.name, e.positions.length])).toEqual([["Ann Analyst", 3], ["Bob Broker", 1]]);
    const note = weeklySummary({ portfolioName: "Duo model book", publication: "DUO", positions: attributed, today: d("2026-11-17"), editors });
    expect(note.body).toContain("By editor (since inception):");
    expect(note.body).toContain("- Ann Analyst: 2 closed, win rate 50%, average gain +5.0%; 1 open");
    expect(note.body).not.toContain("A1");
  });
});

describe("archive experts and editors", () => {
  const editors = [
    { id: ANN, name: "Ann Analyst" },
    { id: BOB, name: "Bob Broker" },
    { id: CY, name: "bob broker" },
  ];
  it("uses the linked expert first, then an unambiguous name match", () => {
    const experts = [
      { id: "x1", name: "Someone Else", editorId: ANN },
      { id: "x2", name: "ann analyst", editorId: null },
    ];
    expect(expertForEditor(experts, editors[0]!, editors)?.id).toBe("x1");
    expect(expertForEditor([experts[1]!], editors[0]!, editors)?.id).toBe("x2");
  });
  it("refuses an ambiguous name on either side", () => {
    expect(expertForEditor([{ id: "x3", name: "Bob Broker", editorId: null }], editors[1]!, editors)).toBeNull();
    const twins = [
      { id: "x4", name: "Ann Analyst", editorId: null },
      { id: "x5", name: "ANN ANALYST", editorId: null },
    ];
    expect(expertForEditor(twins, editors[0]!, editors)).toBeNull();
    expect(expertForEditor([{ id: "x6", name: "Ann Analyst", editorId: BOB }], editors[0]!, editors)).toBeNull();
  });
  it("links a new expert by name only when the editor is free", () => {
    expect(editorForExpertName(" ann analyst ", editors, [])?.id).toBe(ANN);
    expect(editorForExpertName("Ann Analyst", editors, [{ id: "x1", name: "Other", editorId: ANN }])).toBeNull();
    expect(editorForExpertName("Bob Broker", editors, [])).toBeNull();
    expect(editorForExpertName("Nobody", editors, [])).toBeNull();
  });
});

describe("CSV editor column", () => {
  it("matches the editor by name or slug and flags unknown names", () => {
    const csv = ["portfolio,symbol,entry date,entry price,editor", "Duo,AAPL,2026-01-05,100,ann analyst", "Duo,MSFT,2026-01-05,200,bob-b", "Duo,NVDA,2026-01-05,50,Zed", "Duo,AMD,2026-01-05,60,"].join("\n");
    const plan = planImport({
      csv,
      defaultPortfolio: "",
      portfolios: ["Duo"],
      existing: [],
      today: d("2026-11-17"),
      editors: [
        { id: ANN, name: "Ann Analyst", slug: "ann" },
        { id: BOB, name: "Bob Broker", slug: "bob-b" },
      ],
    });
    expect(plan.unknownColumns).toEqual([]);
    expect(plan.rows.map((r) => r.editorId)).toEqual([ANN, BOB, null, null]);
    expect(plan.rows[2]?.message).toContain('Editor "Zed" is not in Publication Setup');
    expect(plan.rows[3]?.message).toBe("New open recommendation.");
  });
});
