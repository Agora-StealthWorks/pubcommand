import { zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { BACKUP_READ_SCHEMA, backupKind, cleanTranscript, mapProposal, mapTranscripts, pricesToCheck } from "./backup-read";
import { computeGain } from "./gain";
import { decodePng, imageToPdf, jpegInfo } from "./image-pdf";
import { fillLabel, LegError, positionPnl, reduceLeg, validateFill, type FillRecord, type LegSpec } from "./legs";
import { planImportTable } from "./positions";
import { weeklyReport } from "./report";
import { airtableListUrl, airtableTable, cellText, decryptSecret, encryptSecret, parseAirtableUrl, parseSheetUrl, sheetCsvUrl, sheetValuesTable, tokenHint } from "./sources";
import { computeStats, publicTrackRecord, type StatPosition } from "./stats";
import { embedSnippet, widgetLimit, widgetPayload, WIDGET_MAX_LIMIT } from "./widget";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const TODAY = d("2026-11-17");

let seq = 0;
const fill = (legId: string, intent: "OPEN" | "CLOSE", quantity: number, price: number, at: string, multiplier = 1): FillRecord => ({
  id: `f${(seq += 1)}`,
  legId,
  intent,
  quantity,
  price,
  multiplier,
  executedAt: d(at),
});
const stock: LegSpec = { id: "L0", legIndex: 0, side: "BUY", ratio: 1, multiplier: 1 };

// ----------------------------------------------------------------------------- legs math

describe("legs: scale in and out", () => {
  it("averages cost over every opening fill", () => {
    const state = reduceLeg(stock, [fill("L0", "OPEN", 100, 10, "2026-01-02"), fill("L0", "OPEN", 100, 20, "2026-02-02")]);
    expect(state.openQty).toBe(200);
    expect(state.wavgEntry).toBeCloseTo(15);
    expect(state.openBasis).toBeCloseTo(3000);
    expect(state.realized).toBe(0);
    expect(state.isClosed).toBe(false);
  });

  it("books realized P&L at average cost on a partial exit and keeps the rest open", () => {
    const fills = [fill("L0", "OPEN", 100, 10, "2026-01-02"), fill("L0", "OPEN", 100, 20, "2026-02-02"), fill("L0", "CLOSE", 50, 30, "2026-03-02")];
    const state = reduceLeg(stock, fills);
    expect(state.realized).toBeCloseTo(750); // (30 - 15) × 50
    expect(state.openQty).toBe(150);
    expect(state.openBasis).toBeCloseTo(2250);
    expect(state.wavgExit).toBeCloseTo(30);
    const pnl = positionPnl([stock], fills, new Map([["L0", { price: 18, stale: false, at: TODAY }]]));
    expect(pnl.unrealized).toBeCloseTo(450); // (18 - 15) × 150
    expect(pnl.basis).toBeCloseTo(3000);
    expect(pnl.pct).toBeCloseTo(40); // (750 + 450) / 3000
    expect(pnl.status).toBe("OPEN");
  });

  it("a fully closed leg returns realized ÷ capital, and equals the simple entry→exit gain for one buy and one sell", () => {
    const fills = [fill("L0", "OPEN", 10, 100, "2026-01-02"), fill("L0", "CLOSE", 10, 125, "2026-03-02")];
    const pnl = positionPnl([stock], fills);
    expect(pnl.status).toBe("CLOSED");
    expect(pnl.pct).toBeCloseTo(25);
    expect(pnl.entryPerUnit).toBeCloseTo(100);
    expect(pnl.exitPerUnit).toBeCloseTo(125);
    expect(computeGain({ basis: "EXIT", direction: "LONG", entryPrice: 100, exitPrice: 125 }).pct).toBeCloseTo(pnl.pct as number);
  });

  it("inverts a short leg", () => {
    const short: LegSpec = { ...stock, side: "SELL" };
    const fills = [fill("L0", "OPEN", 100, 50, "2026-01-02"), fill("L0", "CLOSE", 40, 40, "2026-02-02")];
    const pnl = positionPnl([short], fills, new Map([["L0", { price: 45, stale: false, at: TODAY }]]));
    expect(pnl.realized).toBeCloseTo(400);
    expect(pnl.unrealized).toBeCloseTo(300);
    expect(pnl.pct).toBeCloseTo(14);
  });

  it("refuses to over-close, close before opening, or reopen a flat leg", () => {
    expect(() => reduceLeg(stock, [fill("L0", "OPEN", 10, 1, "2026-01-02"), fill("L0", "CLOSE", 11, 1, "2026-01-03")])).toThrow(LegError);
    expect(() => reduceLeg(stock, [fill("L0", "CLOSE", 1, 1, "2026-01-02")])).toThrow(/nothing open/);
    expect(() => reduceLeg(stock, [fill("L0", "OPEN", 1, 1, "2026-01-02"), fill("L0", "CLOSE", 1, 2, "2026-01-03"), fill("L0", "OPEN", 1, 3, "2026-01-04")])).toThrow(/new position/);
  });

  it("orders a same-day round trip open first", () => {
    const fills = [fill("L0", "CLOSE", 5, 12, "2026-01-02"), fill("L0", "OPEN", 5, 10, "2026-01-02")];
    expect(reduceLeg(stock, fills).realized).toBeCloseTo(10);
  });

  it("leaves an open leg with no price unpriced instead of valuing it at zero", () => {
    const pnl = positionPnl([stock], [fill("L0", "OPEN", 10, 10, "2026-01-02")], new Map());
    expect(pnl.unpriced).toBe(true);
    expect(pnl.unrealized).toBeNull();
    expect(pnl.pct).toBeNull();
  });
});

describe("legs: options and spreads", () => {
  const long: LegSpec = { id: "A", legIndex: 0, side: "BUY", ratio: 1, multiplier: 100 };
  const short: LegSpec = { id: "B", legIndex: 1, side: "SELL", ratio: 1, multiplier: 100 };

  it("values a debit spread on its net debit", () => {
    const fills = [fill("A", "OPEN", 2, 3, "2026-01-02", 100), fill("B", "OPEN", 2, 1, "2026-01-02", 100)];
    const open = positionPnl([long, short], fills, new Map([["A", { price: 4, stale: false, at: TODAY }], ["B", { price: 1.5, stale: true, at: TODAY }]]));
    expect(open.basis).toBeCloseTo(400); // (3 - 1) × 2 × 100
    expect(open.entryPerUnit).toBeCloseTo(2);
    expect(open.unrealized).toBeCloseTo(100); // +200 long, −100 short
    expect(open.pct).toBeCloseTo(25);
    expect(open.stale).toBe(true);
    const closed = positionPnl([long, short], [...fills, fill("A", "CLOSE", 2, 5, "2026-02-02", 100), fill("B", "CLOSE", 2, 2, "2026-02-02", 100)]);
    expect(closed.status).toBe("CLOSED");
    expect(closed.realized).toBeCloseTo(200);
    expect(closed.pct).toBeCloseTo(50);
    expect(closed.exitPerUnit).toBeCloseTo(3);
  });

  it("values a credit spread on the credit received", () => {
    const shortPut: LegSpec = { id: "S", legIndex: 0, side: "SELL", ratio: 1, multiplier: 100 };
    const longPut: LegSpec = { id: "L", legIndex: 1, side: "BUY", ratio: 1, multiplier: 100 };
    const fills = [fill("S", "OPEN", 1, 2.5, "2026-01-02", 100), fill("L", "OPEN", 1, 1, "2026-01-02", 100), fill("S", "CLOSE", 1, 0.5, "2026-02-02", 100), fill("L", "CLOSE", 1, 0.1, "2026-02-02", 100)];
    const pnl = positionPnl([shortPut, longPut], fills);
    expect(pnl.basis).toBeCloseTo(150);
    expect(pnl.realized).toBeCloseTo(110); // +200 short, −90 long
    expect(pnl.pct).toBeCloseTo((110 / 150) * 100);
  });

  it("labels fills by side", () => {
    expect(fillLabel("BUY", "OPEN")).toBe("Buy to open");
    expect(fillLabel("BUY", "CLOSE")).toBe("Sell to close");
    expect(fillLabel("SELL", "OPEN")).toBe("Sell to open");
    expect(fillLabel("SELL", "CLOSE")).toBe("Buy to close");
  });
});

describe("computeGain with legs", () => {
  const specs = [{ ...stock, kind: "STOCK" as const }];
  it("feeds stats like any other position and converts stock marks with the split factor", () => {
    const fills = [fill("L0", "OPEN", 10, 100, "2026-01-02")];
    const gain = computeGain({ basis: "TODAY", direction: "LONG", entryPrice: 100, splitFactor: 2, legs: { specs, fills, marks: new Map([["L0", { price: 60, at: TODAY }]]) } });
    expect(gain.pct).toBeCloseTo(20); // 60 × 2 = 120 in entry basis
    expect(gain.current).toBeCloseTo(120);
    expect(gain.source).toBe("live");
    expect(gain.pnl?.unrealized).toBeCloseTo(200);
  });

  it("reports an impossible history instead of a number", () => {
    const gain = computeGain({ basis: "TODAY", direction: "LONG", entryPrice: 1, legs: { specs, fills: [fill("L0", "CLOSE", 1, 1, "2026-01-02")], marks: new Map() } });
    expect(gain.pct).toBeNull();
    expect(gain.legError).toMatch(/nothing open/);
  });

  it("freezes a closed legged position at its fills", () => {
    const fills = [fill("L0", "OPEN", 10, 100, "2026-01-02"), fill("L0", "CLOSE", 10, 90, "2026-02-02")];
    const gain = computeGain({ basis: "EXIT", direction: "LONG", entryPrice: 100, legs: { specs, fills, marks: new Map([["L0", { price: 500, at: TODAY }]]) } });
    expect(gain.pct).toBeCloseTo(-10);
    expect(gain.source).toBe("exit");
  });

  it("validates fill input", () => {
    expect(validateFill({ intent: "OPEN", quantity: "100", price: "$12.50", executedAt: "2026-11-02" }, TODAY)).toMatchObject({ ok: true, draft: { quantity: 100, price: 12.5 } });
    expect(validateFill({ intent: "OPEN", quantity: "0", price: "1", executedAt: "2026-11-02" }, TODAY).ok).toBe(false);
    expect(validateFill({ intent: "CLOSE", quantity: "1", price: "1", executedAt: "2027-01-01" }, TODAY).ok).toBe(false);
    expect(validateFill({ intent: "X", quantity: "1", price: "1", executedAt: "2026-01-01" }, TODAY).ok).toBe(false);
  });
});

// ----------------------------------------------------------------------------- AI proposal mapping

describe("AI read of backups", () => {
  it("has a strict schema with no gain, current price or peak fields", () => {
    const props = Object.keys(BACKUP_READ_SCHEMA.properties.proposal.properties);
    expect(props).not.toContain("gain");
    expect(props.some((key) => /gain|current|peak|return/i.test(key))).toBe(false);
    expect(BACKUP_READ_SCHEMA.properties.proposal.required).toEqual(props);
  });

  it("labels every price as read from the document and drops anything it does not know", () => {
    const raw = {
      proposal: {
        ticker: "$nvda",
        direction: "LONG",
        callDate: "2025-03-04",
        entryPrice: 112.5,
        targetPrice: "150",
        exitPrice: null,
        keyQuote: "  Buy NVDA under $115. ",
        title: "Buy NVDA",
        callType: "Recommendation",
        source: "Weekly letter",
        gain: 300,
        currentPrice: 999,
        peak: 1200,
      },
      evidence: [{ field: "entryPrice", file: 1, quote: "Buy NVDA under $115" }],
      notes: "",
    };
    const proposal = mapProposal(raw, TODAY);
    expect(proposal.ticker).toBe("NVDA");
    expect(proposal.entryPrice).toBe(112.5);
    expect(proposal.targetPrice).toBe(150);
    expect(proposal.priceFields).toEqual(["entryPrice", "targetPrice"]);
    expect(proposal.keyQuote).toBe("Buy NVDA under $115.");
    expect(Object.keys(proposal)).not.toContain("gain");
    expect(Object.keys(proposal)).not.toContain("currentPrice");
    expect(JSON.stringify(proposal)).not.toContain("999");
    expect(JSON.stringify(proposal)).not.toContain("1200");
  });

  it("refuses future dates, junk prices and unknown enums", () => {
    const proposal = mapProposal({ proposal: { callDate: "2030-01-01", entryPrice: -4, exitPrice: "n/a", direction: "UP", callType: "Hot tip" } }, TODAY);
    expect(proposal.callDate).toBeNull();
    expect(proposal.entryPrice).toBeNull();
    expect(proposal.exitPrice).toBeNull();
    expect(proposal.priceFields).toEqual([]);
    expect(proposal.direction).toBeNull();
    expect(proposal.callType).toBeNull();
    expect(proposal.warnings.length).toBeGreaterThanOrEqual(2);
    expect(mapProposal(null, TODAY).priceFields).toEqual([]);
  });

  it("keeps the check flag only on AI prices a person saved unchanged", () => {
    const proposal = mapProposal({ proposal: { entryPrice: 10, targetPrice: 20, exitPrice: 15 } }, TODAY);
    expect(pricesToCheck(["entryPrice", "targetPrice", "exitPrice"], proposal, { entryPrice: 10, targetPrice: 22, exitPrice: null })).toEqual(["entryPrice"]);
    expect(pricesToCheck([], proposal, { entryPrice: 10 })).toEqual([]);
    expect(pricesToCheck(["entryPrice"], null, { entryPrice: 10 })).toEqual([]);
  });

  it("maps transcripts by file number and ignores out-of-range ones", () => {
    const map = mapTranscripts({ files: [{ file: 1, transcript: "one" }, { file: 3, transcript: "nope" }, { file: 2, transcript: 5 }] }, 2);
    expect([...map.entries()]).toEqual([[1, "one"]]);
  });

  it("knows which files it can read and cleans subtitle timestamps", () => {
    expect(backupKind("image/png", "a.png")).toBe("image");
    expect(backupKind("application/octet-stream", "call.vtt")).toBe("text");
    expect(backupKind("video/mp4", "show.mp4")).toBe("video");
    expect(backupKind("image/gif", "a.gif")).toBe("other");
    expect(cleanTranscript("WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nBuy it now\n")).toBe("Buy it now");
  });
});

// ----------------------------------------------------------------------------- image → PDF

function png(width: number, height: number, colorType: 2 | 6, pixel: number[]): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (const b of bytes) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const rows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(y === 1 ? 2 : 0); // one "up" filtered row
    for (let x = 0; x < width; x += 1) rows.push(...(y === 1 ? pixel.map(() => 0) : pixel));
  }
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlibSync(new Uint8Array(rows))), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe("screenshots for the AI", () => {
  it("decodes an RGBA PNG onto white, including filtered rows", () => {
    const image = decodePng(png(2, 2, 6, [255, 0, 0, 128]));
    expect(image.width).toBe(2);
    expect([...image.rgb.slice(0, 3)]).toEqual([255, 127, 127]);
    expect([...image.rgb.slice(6, 9)]).toEqual([255, 127, 127]); // "up" filter copies the row above
  });

  it("wraps a PNG and a JPEG in a one-page PDF", () => {
    const pdf = new TextDecoder("latin1").decode(imageToPdf(png(3, 2, 2, [0, 128, 255])));
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("/Width 3 /Height 2");
    expect(pdf).toContain("/FlateDecode");
    expect(pdf.trim().endsWith("%%EOF")).toBe(true);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
    expect(jpegInfo(jpeg)).toMatchObject({ width: 64, height: 32, components: 3 });
    expect(new TextDecoder("latin1").decode(imageToPdf(jpeg))).toContain("/DCTDecode");
    expect(() => imageToPdf(new Uint8Array([1, 2, 3]))).toThrow();
  });
});

// ----------------------------------------------------------------------------- import sources

describe("Sheets and Airtable sources", () => {
  it("parses links", () => {
    expect(parseSheetUrl("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=42")).toEqual({ sheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", gid: "42" });
    expect(parseSheetUrl("not a sheet")).toBeNull();
    expect(parseAirtableUrl("https://airtable.com/appAbCdEfGhIjKlMn/tblAbCdEfGhIjKlMn/viwAbCdEfGhIjKlMn?blocks=hide")).toEqual({ baseId: "appAbCdEfGhIjKlMn", tableId: "tblAbCdEfGhIjKlMn", viewId: "viwAbCdEfGhIjKlMn" });
    expect(sheetCsvUrl("abc", "7")).toContain("/export?format=csv&gid=7");
    expect(airtableListUrl({ baseId: "appX", table: "Trades", view: "Closed", offset: "o1" })).toContain("cellFormat=string");
  });

  it("turns Airtable records and Sheets values into a table the planner reads", () => {
    const table = airtableTable([
      { fields: { Symbol: "AAPL", "Entry Date": "2025-01-02", "Entry Price": 150, Tags: ["a", "b"] } },
      { fields: { Symbol: "MSFT", "Entry Date": "2025-02-03", "Entry Price": "400", "Exit Price": 420, "Exit Date": "2025-03-01" } },
    ]);
    expect(table[0]).toEqual(["Symbol", "Entry Date", "Entry Price", "Tags", "Exit Price", "Exit Date"]);
    expect(table[1]?.[3]).toBe("a, b");
    const plan = planImportTable({ table, defaultPortfolio: "Model", portfolios: ["Model"], existing: [], today: TODAY });
    expect(plan.counts).toMatchObject({ create: 2, error: 0 });
    expect(plan.unknownColumns).toEqual(["Tags"]);
    expect(sheetValuesTable([["a", "b"], ["1"], []])).toEqual([["a", "b"], ["1", ""]]);
    expect(cellText({ name: "Long" })).toBe("Long");
  });

  it("re-syncing the same rows is a no-op", () => {
    const table = [["symbol", "entry date", "entry price"], ["AAPL", "2025-01-02", "150"]];
    const plan = planImportTable({
      table,
      defaultPortfolio: "Model",
      portfolios: ["Model"],
      existing: [{ id: "p1", portfolioName: "Model", symbol: "AAPL", direction: "LONG", entryDate: d("2025-01-02"), status: "OPEN" }],
      today: TODAY,
    });
    expect(plan.counts).toMatchObject({ create: 0, skip: 1 });
  });

  it("encrypts tokens with AUTH_SECRET and never shows them", () => {
    const secret = "local-dev-secret-at-least-16-chars";
    const sealed = encryptSecret("patXYZ.secret-token", secret);
    expect(sealed).not.toContain("secret-token");
    expect(decryptSecret(sealed, secret)).toBe("patXYZ.secret-token");
    expect(() => decryptSecret(sealed, "another-secret-of-16-chars")).toThrow();
    expect(() => encryptSecret("x", "short")).toThrow();
    expect(tokenHint("patXYZ.secret-token")).toBe("…oken");
  });
});

// ----------------------------------------------------------------------------- widget public-safety

const pos = (over: Partial<StatPosition>): StatPosition => ({
  id: over.symbol ?? "x",
  symbol: "X",
  name: "",
  direction: "LONG",
  status: "CLOSED",
  entryDate: d("2026-01-02"),
  exitDate: d("2026-02-02"),
  entryPrice: 10,
  exitPrice: 11,
  gainPct: 10,
  holdDays: 31,
  weight: 1,
  ...over,
});

const book = [
  pos({ id: "a", symbol: "WIN", gainPct: 50, exitDate: d("2026-03-01") }),
  pos({ id: "b", symbol: "LOSS", gainPct: -40, exitDate: d("2026-04-01") }),
  pos({ id: "c", symbol: "OPEN1", status: "OPEN", exitDate: null, exitPrice: null, gainPct: 5 }),
];

function deepKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => deepKeys(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      deepKeys(v, out);
    }
  }
  return out;
}

describe("widget", () => {
  const meta = { portfolio: "Model", publication: "Letter", brand: "Brand", asOf: TODAY };
  it("shows closed trades only by default, in date order, with honest stats", () => {
    const payload = widgetPayload(publicTrackRecord(book), meta);
    expect(payload.trades.map((t) => t.symbol)).toEqual(["LOSS", "WIN"]);
    expect(payload.stats.closed).toBe(2);
    expect(payload.stats.avgGain).toBeCloseTo(5);
    expect(payload.includesOpen).toBe(false);
  });

  it("never carries a loser count, the worst trade, a losers list or internal fields", () => {
    const payload = widgetPayload(publicTrackRecord(book, { includeOpen: true }), meta);
    const keys = deepKeys(payload);
    for (const banned of ["losers", "worst", "loserList", "weight", "notes", "id", "stale", "medianGain", "weightedAvgGain", "createdById"]) expect(keys.has(banned)).toBe(false);
    expect(payload.trades.map((t) => t.symbol)).toContain("OPEN1");
    expect(computeStats(book).worst?.symbol).toBe("LOSS"); // internal stats know it; the widget does not show it as such
  });

  it("limits rows but keeps counting them in the stats", () => {
    const many = Array.from({ length: 30 }, (_, i) => pos({ id: `p${i}`, symbol: `S${i}`, exitDate: new Date(Date.UTC(2026, 0, 1 + i)) }));
    const payload = widgetPayload(publicTrackRecord(many), { ...meta, limit: 10 });
    expect(payload.trades).toHaveLength(10);
    expect(payload.more).toBe(20);
    expect(payload.stats.closed).toBe(30);
    expect(widgetLimit("9999")).toBe(WIDGET_MAX_LIMIT);
    expect(widgetLimit("abc")).toBe(25);
    expect(embedSnippet("https://x.example/p/track-record/widget/tok", 'A "B"')).toContain('title="A B"');
  });
});

// ----------------------------------------------------------------------------- weekly report

describe("weekly report email", () => {
  const friday = d("2026-11-20");
  const positions = [
    pos({ id: "1", symbol: "AAA", entryDate: d("2026-10-01"), exitDate: d("2026-11-18"), gainPct: 12.5, exitPrice: 11.25 }),
    pos({ id: "2", symbol: "BBB", entryDate: d("2026-10-01"), exitDate: d("2026-11-16"), gainPct: -3, exitPrice: 9.7 }),
    pos({ id: "3", symbol: "CCC", status: "OPEN", entryDate: d("2026-11-17"), exitDate: null, exitPrice: null, gainPct: 1 }),
    pos({ id: "4", symbol: "OLD", entryDate: d("2025-01-01"), exitDate: d("2025-06-01"), gainPct: 80 }),
  ];
  const report = weeklyReport({ brandName: "Example <Gazette>", portfolios: [{ name: "Model Book", publication: "Letter", positions }], today: friday, appUrl: "https://example.test/performance" });

  it("covers this week's closes in date order, opens and since-inception figures", () => {
    expect(report.week).toBe("2026-W47");
    expect(report.subject).toContain("week ending 2026-11-20");
    expect(report.closedThisWeek).toBe(2);
    expect(report.openedThisWeek).toBe(1);
    expect(report.text.indexOf("BBB")).toBeLessThan(report.text.indexOf("AAA"));
    expect(report.text).not.toContain("OLD ");
    expect(report.text).toContain("Opened: CCC (Long)");
    expect(report.text).toContain("Since inception: 3 closed");
    expect(report.html).toContain("Example &lt;Gazette&gt;");
  });

  it("carries no people, no loser count and no worst trade", () => {
    for (const body of [report.text, report.html]) {
      expect(body).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(body.toLowerCase()).not.toContain("loser");
      expect(body.toLowerCase()).not.toContain("worst");
      expect(body.toLowerCase()).not.toContain("closed at a loss");
    }
  });
});
