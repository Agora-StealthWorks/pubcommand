import { generateKeyPairSync, createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { formStats } from "./analytics";
import { buildExportTable } from "./export";
import { FIELD_TYPES, checkAnswer, createField, fieldSpec, sanitizeField, sniffImage } from "./fields";
import { orphanFiles, scheduleActions, type ScheduleRow } from "./jobs";
import { checkSubmission, cleanEndRules, endRuleProblems, resolveEnding } from "./logic";
import {
  a1Column,
  airtablePayload,
  airtableTokenProblem,
  alignToHeader,
  decryptSecret,
  encryptSecret,
  googleJwt,
  mirrorDue,
  mirrorRecord,
  missingColumns,
  parseAirtableTarget,
  parseGoogleCredentials,
  parseSheetsTarget,
  safeError,
} from "./mirror";
import { answerLines, confirmationAddress, confirmationEmail, digestDue, pendingNotifications, teamEmail } from "./notify";
import { PdfDocument, resultsPdf, responsePdf, textWidth, winAnsi, wrapText } from "./pdf";
import { pollResults } from "./poll";
import { aggregateReport } from "./summary";
import { publishProblems } from "./theme";
import type { EndRule, FieldDef, ResponseRecord } from "./types";


let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const make = (type: string, patch: Partial<FieldDef> = {}): FieldDef => ({ ...createField(type, uuid()), label: type, ...patch });

function response(answers: Record<string, unknown>, patch: Partial<ResponseRecord> = {}): ResponseRecord {
  return {
    id: uuid(),
    status: "COMPLETE",
    answers,
    startedAt: new Date("2026-11-01T10:00:00Z"),
    completedAt: new Date("2026-11-01T10:02:00Z"),
    durationMs: 120000,
    lastPageIndex: 0,
    utm: null,
    spamReason: null,
    ...patch,
  };
}

describe("new field types in the registry", () => {
  it("has every old-app type that was missing, each in the palette with a known analytics kind", () => {
    const types = FIELD_TYPES.map((spec) => spec.type);
    for (const type of ["matrix", "matrix_multi", "ranking", "slider", "currency", "image_upload", "divider"]) expect(types).toContain(type);
    expect(fieldSpec("divider")!.captures).toBe(false);
    expect(fieldSpec("image_upload")!.pii).toBe(true);
  });

  it("validates a single-pick grid: known rows and columns, every row when required", () => {
    const grid = make("matrix", { required: true });
    const [r1, r2, r3] = grid.config.rows!;
    const [c1, c2] = grid.config.columns!;
    expect(checkAnswer(grid, { [r1!.id]: c1!.id, [r2!.id]: c2!.id, [r3!.id]: c1!.id }).error).toBeNull();
    expect(checkAnswer(grid, { [r1!.id]: c1!.id }).error).toMatch(/every row/);
    expect(checkAnswer(grid, { [r1!.id]: "nope", [r2!.id]: c1!.id, [r3!.id]: c1!.id }).error).toMatch(/options shown/);
    expect(checkAnswer(grid, { bogusRow: c1!.id }).error).toMatch(/rows shown/);
    expect(checkAnswer(grid, "a string").error).toMatch(/right format/);
    const optional = { ...grid, required: false };
    expect(checkAnswer(optional, { [r1!.id]: c1!.id }).error).toBeNull();
    expect(checkAnswer(optional, {}).error).toBeNull();
  });

  it("validates a multi-pick grid and exports it readably", () => {
    const grid = make("matrix_multi");
    const [r1] = grid.config.rows!;
    const [c1, c2] = grid.config.columns!;
    const ok = checkAnswer(grid, { [r1!.id]: [c1!.id, c2!.id, c1!.id] });
    expect(ok.error).toBeNull();
    expect(ok.value).toEqual({ [r1!.id]: [c1!.id, c2!.id] });
    expect(checkAnswer(grid, { [r1!.id]: [c1!.id, "x"] }).error).toMatch(/options shown/);
    expect(fieldSpec("matrix_multi")!.toText(ok.value, grid.config)).toBe(`${r1!.label}: ${c1!.label}, ${c2!.label}`);
  });

  it("validates a ranking: a full ordering of the options, no repeats", () => {
    const rank = make("ranking", { required: true });
    const ids = rank.config.choices!.map((choice) => choice.id);
    expect(checkAnswer(rank, [ids[2], ids[0], ids[1]]).error).toBeNull();
    expect(checkAnswer(rank, [ids[0], ids[1]]).error).toMatch(/every option/);
    expect(checkAnswer(rank, [ids[0], ids[0], ids[1]]).error).toMatch(/right format/);
    expect(checkAnswer(rank, [ids[0], ids[1], "other:x"]).error).toMatch(/options shown/);
    expect(checkAnswer(rank, undefined).error).toMatch(/in order/);
    expect(fieldSpec("ranking")!.toText([ids[1], ids[0]], rank.config)).toBe("1. Option 2; 2. Option 1");
  });

  it("validates a slider's range and step", () => {
    const slider = make("slider", { config: { min: 0, max: 10, step: 0.5 } });
    expect(checkAnswer(slider, 7.5).error).toBeNull();
    expect(checkAnswer(slider, "2.5").value).toBe(2.5);
    expect(checkAnswer(slider, 7.3).error).toMatch(/steps of 0.5/);
    expect(checkAnswer(slider, 11).error).toMatch(/from 0 to 10/);
    expect(checkAnswer(make("slider", { config: { min: 0, max: 1, step: 0.1 } }), 0.3).error).toBeNull();
  });

  it("validates currency: two decimals, bounds, symbols stripped", () => {
    const money = make("currency", { config: { prefix: "$", min: 0, max: 1000 } });
    expect(checkAnswer(money, "$1,250.5").error).toMatch(/1000 or less/);
    expect(checkAnswer(money, "$12.50").value).toBe(12.5);
    expect(checkAnswer(money, 12.345).error).toMatch(/two decimal/);
    expect(checkAnswer(money, -1).error).toMatch(/0 or more/);
    expect(fieldSpec("currency")!.toText(12.5, money.config)).toBe("12.50");
  });

  it("validates image uploads by size, extension and sniffed type", () => {
    const image = make("image_upload", { required: true, config: { maxSizeMb: 2 } });
    expect(checkAnswer(image, { filename: "a.png", size: 1000, mimeType: "image/png" }).error).toBeNull();
    expect(checkAnswer(image, { filename: "a.png", size: 3 * 1024 * 1024, mimeType: "image/png" }).error).toMatch(/under 2 MB/);
    expect(checkAnswer(image, { filename: "a.pdf", size: 10, mimeType: "image/png" }).error).toMatch(/PNG, JPG/);
    expect(checkAnswer(image, { filename: "a.png", size: 10, mimeType: "text/html" }).error).toMatch(/not a PNG/);
    expect(checkAnswer(image, undefined).error).toMatch(/upload an image/);
    expect(sanitizeField({ ...image, config: { maxSizeMb: 500 } })!.config.maxSizeMb).toBe(10);
  });

  it("sniffs real image types from bytes and refuses anything else", () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(new TextEncoder().encode("GIF89a..."))).toBe("image/gif");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImage(new Uint8Array([]))).toBeNull();
  });

  it("sanitizes grid rows/columns and slider steps from a crafted builder save", () => {
    const grid = sanitizeField({ ...make("matrix"), config: { rows: [{ id: "a", label: " Row " }, { id: "a", label: "dupe" }, { id: "", label: "x" }], columns: "junk" as never, choices: [{ id: "z", label: "z" }] } })!;
    expect(grid.config.rows).toEqual([{ id: "a", label: "Row" }]);
    expect(grid.config.columns).toEqual([]);
    expect(grid.config.choices).toBeUndefined();
    expect(sanitizeField({ ...make("slider"), config: { min: 0, max: 5, step: -3 } })!.config.step).toBe(1);
    expect(publishProblems({ title: "T", slug: "t", layout: "paginated", theme: { privacyPolicyUrl: "https://x.co/p" }, fields: [grid] })).toContain("“matrix” needs at least one row and one column.");
  });

  it("summarises grids and rankings in results and in the AI's aggregate report", () => {
    const grid = make("matrix", { label: "Rate" });
    const rank = make("ranking", { label: "Order" });
    const [r1, r2] = grid.config.rows!;
    const [c1, c2] = grid.config.columns!;
    const [a, b, c] = rank.config.choices!.map((choice) => choice.id);
    const stats = formStats(
      [grid, rank],
      [
        response({ [grid.id]: { [r1!.id]: c1!.id, [r2!.id]: c2!.id }, [rank.id]: [a, b, c] }),
        response({ [grid.id]: { [r1!.id]: c1!.id }, [rank.id]: [b, a, c] }),
        response({ [rank.id]: [a, c, b] }),
      ],
    );
    const gridStats = stats.fields[0]!;
    expect(gridStats.kind).toBe("matrix");
    if (gridStats.kind === "matrix") {
      expect(gridStats.rows[0]).toMatchObject({ label: r1!.label, answered: 2 });
      expect(gridStats.rows[0]!.buckets.find((bucket) => bucket.label === c1!.label)).toMatchObject({ count: 2, pct: 100 });
      expect(gridStats.rows[1]!.answered).toBe(1);
    }
    const rankStats = stats.fields[1]!;
    expect(rankStats.kind).toBe("ranking");
    if (rankStats.kind === "ranking") {
      expect(rankStats.items[0]).toMatchObject({ label: "Option 1", meanRank: 1.33, firstCount: 2 });
      expect(rankStats.items.at(-1)!.label).toBe("Option 3");
    }
    const report = aggregateReport({ formTitle: "F", stats });
    expect(report).toMatch(/\[grid\]/);
    expect(report).toMatch(/average position 1.33/);
  });

  it("does not bucket every value of a slider", () => {
    const slider = make("slider");
    const stats = formStats([slider], [response({ [slider.id]: 40 }), response({ [slider.id]: 60 })]).fields[0]!;
    expect(stats.kind === "numeric" && stats.buckets.length).toBe(0);
    expect(stats.kind === "numeric" && stats.mean).toBe(50);
  });
});

describe("end-of-form rules (redirect by answer)", () => {
  const plan = make("single_choice", { label: "Plan" });
  const extra = make("yes_no", { label: "Extra", visibility: { action: "show", match: "all", rules: [{ fieldId: plan.id, op: "equals", value: plan.config.choices![1]!.id }] } });
  const fields = [plan, extra];
  const pro = plan.config.choices![1]!.id;
  const rules: EndRule[] = [
    { id: "r1", match: "all", rules: [{ fieldId: extra.id, op: "equals", value: true }], action: "redirect", url: "https://example.com/pro-extra", title: "", message: "" },
    { id: "r2", match: "all", rules: [{ fieldId: plan.id, op: "equals", value: pro }], action: "message", url: "", title: "Welcome to Pro", message: "We will be in touch." },
  ];
  const fallback = { title: "Thanks", message: "Recorded.", redirectUrl: null };

  it("picks the first matching rule, or the form's own ending", () => {
    const first = checkSubmission(fields, "paginated", { [plan.id]: pro, [extra.id]: true });
    expect(resolveEnding(fields, first.answers, rules, fallback)).toMatchObject({ redirectUrl: "https://example.com/pro-extra", ruleId: "r1", title: "Thanks" });
    const second = checkSubmission(fields, "paginated", { [plan.id]: pro, [extra.id]: false });
    expect(resolveEnding(fields, second.answers, rules, fallback)).toMatchObject({ redirectUrl: null, title: "Welcome to Pro", message: "We will be in touch.", ruleId: "r2" });
    const none = checkSubmission(fields, "paginated", { [plan.id]: plan.config.choices![0]!.id });
    expect(resolveEnding(fields, none.answers, rules, { ...fallback, redirectUrl: "https://example.com/thanks" })).toEqual({ title: "Thanks", message: "Recorded.", redirectUrl: "https://example.com/thanks", ruleId: null });
  });

  it("ignores a crafted POST that answers a question it never reached", () => {
    // "Extra" is hidden unless Plan is Pro. A crafted POST claims Extra = yes with the basic plan.
    const crafted = checkSubmission(fields, "paginated", { [plan.id]: plan.config.choices![0]!.id, [extra.id]: true, redirect: "https://evil.example" });
    expect(crafted.answers[extra.id]).toBeUndefined();
    const ending = resolveEnding(fields, crafted.answers, rules, fallback);
    expect(ending.ruleId).toBeNull();
    expect(ending.redirectUrl).toBeNull();
  });

  it("never redirects to a non-web URL, even from stored rules", () => {
    const bad: EndRule[] = [{ ...rules[0]!, url: "javascript:alert(1)" }];
    expect(resolveEnding(fields, { [extra.id]: true }, bad, fallback).redirectUrl).toBeNull();
    expect(resolveEnding(fields, {}, [], { ...fallback, redirectUrl: "data:text/html,x" }).redirectUrl).toBeNull();
  });

  it("cleans rules from the builder and reports problems", () => {
    const name = make("name");
    const cleaned = cleanEndRules([...fields, name], [
      { id: "a", match: "any", rules: [{ fieldId: plan.id, op: "equals", value: pro }], action: "redirect", url: "ftp://x" },
      { id: "b", rules: [{ fieldId: name.id, op: "answered" }], action: "message", title: "x" },
      { id: "c", rules: [{ fieldId: "missing", op: "equals", value: 1 }], action: "message", title: "x" },
      "junk",
    ]);
    expect(cleaned).toHaveLength(2);
    expect(cleaned[0]).toMatchObject({ id: "a", match: "any", url: "" });
    expect(endRuleProblems([...fields, name], cleaned)).toContain("Ending rule 1 needs a full web address starting with https://");
    expect(publishProblems({ title: "T", slug: "t", layout: "paginated", theme: { privacyPolicyUrl: "https://x.co/p" }, fields, endRules: cleaned })).toContain("Ending rule 1 needs a full web address starting with https://");
  });
});

describe("notifications", () => {
  const email = make("email", { label: "Email" });
  const upload = make("file_upload", { label: "CV" });
  const fields = [email, upload, make("hidden")];

  it("builds the team email with or without answers, escaping HTML", () => {
    const lines = answerLines(fields, { [email.id]: "a@b.co", [upload.id]: { filename: "cv.pdf", size: 1, mimeType: "application/pdf", fileId: "x" }, [fields[2]!.id]: "src" });
    expect(lines).toEqual([
      { question: "Email", answer: "a@b.co" },
      { question: "CV", answer: "cv.pdf (open it in PubCommand)" },
    ]);
    const withAnswers = teamEmail({ formTitle: "<b>Poll</b>", brandName: "Gazette", resultsUrl: "https://x/forms/1/results", mode: "each", items: [{ completedAt: new Date("2026-11-01T10:00:00Z"), lines }] });
    expect(withAnswers.subject).toBe("New response: <b>Poll</b>");
    expect(withAnswers.html).toContain("&lt;b&gt;Poll&lt;/b&gt;");
    expect(withAnswers.text).toContain("Email: a@b.co");
    const without = teamEmail({ formTitle: "Poll", brandName: "G", resultsUrl: "https://x", mode: "digest", items: [{ completedAt: new Date(), lines: null }, { completedAt: new Date(), lines: null }] });
    expect(without.subject).toBe("2 new responses: Poll");
    expect(without.text).not.toContain("a@b.co");
    expect(without.text).toMatch(/not included/);
  });

  it("sends the confirmation only to a valid address from the chosen email field", () => {
    expect(confirmationAddress(fields, email.id, { [email.id]: "a@b.co" })).toBe("a@b.co");
    expect(confirmationAddress(fields, email.id, { [email.id]: "nope" })).toBeNull();
    expect(confirmationAddress(fields, upload.id, { [upload.id]: "a@b.co" })).toBeNull();
    expect(confirmationAddress(fields, null, { [email.id]: "a@b.co" })).toBeNull();
    const mail = confirmationEmail({ formTitle: "Poll", brandName: "G", subject: "", body: "Hi <there>\n\nBye" });
    expect(mail.subject).toBe("Thanks for your response: Poll");
    expect(mail.html).toContain("Hi &lt;there&gt;");
  });

  it("decides when a daily digest is due (8am New York, once a day)", () => {
    const at = (iso: string) => new Date(iso);
    // 2026-11-17 is EST (UTC-5): 8am NY = 13:00 UTC.
    expect(digestDue(null, at("2026-11-17T12:30:00Z"))).toBe(false);
    expect(digestDue(null, at("2026-11-17T13:05:00Z"))).toBe(true);
    expect(digestDue(at("2026-11-17T13:05:00Z"), at("2026-11-17T20:00:00Z"))).toBe(false);
    expect(digestDue(at("2026-11-17T13:05:00Z"), at("2026-11-18T13:01:00Z"))).toBe(true);
    expect(digestDue(at("2026-11-17T06:00:00Z"), at("2026-11-17T14:00:00Z"))).toBe(true);
  });

  it("selects responses to notify: never spam, partials or ones already sent", () => {
    const now = new Date("2026-11-17T14:00:00Z");
    const rows = [
      { id: "old", status: "COMPLETE", completedAt: new Date("2026-11-17T13:00:00Z"), spamReason: null, notifiedAt: null },
      { id: "fresh", status: "COMPLETE", completedAt: new Date("2026-11-17T13:55:00Z"), spamReason: null, notifiedAt: null },
      { id: "spam", status: "COMPLETE", completedAt: new Date("2026-11-17T13:00:00Z"), spamReason: "honeypot", notifiedAt: null },
      { id: "partial", status: "PARTIAL", completedAt: null, spamReason: null, notifiedAt: null },
      { id: "sent", status: "COMPLETE", completedAt: new Date("2026-11-17T12:00:00Z"), spamReason: null, notifiedAt: new Date() },
    ];
    expect(pendingNotifications({ mode: "each", recipients: 1, lastDigestAt: null, now, rows })).toEqual(["old"]);
    expect(pendingNotifications({ mode: "digest", recipients: 1, lastDigestAt: null, now, rows })).toEqual(["old", "fresh"]);
    expect(pendingNotifications({ mode: "digest", recipients: 1, lastDigestAt: new Date("2026-11-17T13:10:00Z"), now, rows })).toEqual([]);
    expect(pendingNotifications({ mode: "off", recipients: 3, lastDigestAt: null, now, rows })).toEqual([]);
    expect(pendingNotifications({ mode: "each", recipients: 0, lastDigestAt: null, now, rows })).toEqual([]);
  });
});

describe("public live results", () => {
  const choice = make("single_choice", { label: "Pick", config: { choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }], allowOther: true } });
  const name = make("name");
  const text = make("long_text");
  const hidden = make("hidden");
  const fields = [choice, name, text, hidden];
  const answers = (value: string) => ({ [choice.id]: value, [name.id]: "Jane Q", [text.id]: "call me on 555", [hidden.id]: "secret-campaign" });

  it("withholds results until enough people answered and when turned off", () => {
    const few = [response(answers("a")), response(answers("b"))];
    expect(pollResults({ enabled: true, minResponses: 1, fields, responses: few })).toEqual({ available: false, reason: "too_few", total: 2, minResponses: 3 });
    expect(pollResults({ enabled: false, minResponses: 1, fields, responses: few }).available).toBe(false);
  });

  it("shows only closed questions, never names, free text, hidden values or write-in text", () => {
    const rows = [response(answers("a")), response(answers("a")), response(answers("other:my email is x@y.z")), response(answers("b"), { spamReason: "too-fast" }), response(answers("b"), { status: "PARTIAL" })];
    const results = pollResults({ enabled: true, minResponses: 3, fields, responses: rows });
    expect(results.available).toBe(true);
    const json = JSON.stringify(results);
    for (const secret of ["Jane", "555", "secret-campaign", "x@y.z", rows[0]!.id, "2026"]) expect(json).not.toContain(secret);
    if (results.available) {
      expect(results.total).toBe(3);
      expect(results.questions).toHaveLength(1);
      const q = results.questions[0]!;
      expect(q.kind === "bars" && q.buckets.map((bucket) => [bucket.label, bucket.count])).toEqual([
        ["A", 2],
        ["B", 0],
        ["Other (written in)", 1],
      ]);
    }
  });
});

describe("PDF reports", () => {
  const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

  it("writes WinAnsi text, wraps lines and escapes PDF strings", () => {
    expect(winAnsi("é’€😀")).toEqual([0xe9, 0x92, 0x80, 63]);
    expect(textWidth("Hello", 10)).toBeCloseTo(22.78, 1);
    const lines = wrapText("one two three four five six seven", 10, 60);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, 10)).toBeLessThanOrEqual(60);
    expect(wrapText("x".repeat(200), 10, 50).length).toBeGreaterThan(3);
    const doc = new PdfDocument();
    doc.text("a (tricky) \\ string");
    expect(latin1(doc.toBytes({ title: "t" }))).toContain("(a \\(tricky\\) \\\\ string)");
  });

  it("produces a valid results PDF with a chart per question and the summary, but no verbatims", () => {
    const choice = make("single_choice", { label: "Favourite" });
    const essay = make("long_text", { label: "Why?" });
    const grid = make("matrix", { label: "Grid" });
    const rank = make("ranking", { label: "Rank" });
    const fields = [choice, essay, grid, rank];
    const rows = Array.from({ length: 40 }, (_, index) =>
      response({ [choice.id]: choice.config.choices![index % 3]!.id, [essay.id]: `private verbatim ${index}`, [grid.id]: { [grid.config.rows![0]!.id]: grid.config.columns![0]!.id }, [rank.id]: rank.config.choices!.map((item) => item.id) }),
    );
    const stats = formStats(fields, rows);
    const bytes = resultsPdf({
      formTitle: "Reader survey",
      brandName: "Gazette",
      generatedAt: new Date("2026-11-17T12:00:00Z"),
      stats,
      summary: { headline: "Option 1 leads", keyFindings: ["Finding one"], questionNotes: [], dataQuality: [], suggestedActions: ["Do X"] },
      accentColor: "#1d4ed8",
    });
    const pdf = latin1(bytes);
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf).toContain("(Results: Reader survey)");
    expect(pdf).toContain("(Option 1 leads)");
    expect(pdf).toContain("(Favourite)");
    expect(pdf).toContain("re f");
    expect(pdf).not.toContain("private verbatim");
    // xref offsets point at the objects they name.
    const xrefAt = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const entries = pdf.slice(xrefAt).split("\n").slice(3).filter((line) => / n $/.test(line));
    entries.forEach((line, index) => expect(pdf.slice(Number(line.slice(0, 10)), Number(line.slice(0, 10)) + 10)).toMatch(new RegExp(`^${index + 1} 0 obj`)));
    const count = Number(pdf.match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/)![1]);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("paginates long content and renders a single response", () => {
    const doc = new PdfDocument();
    for (let index = 0; index < 120; index += 1) doc.text(`Line ${index}`);
    expect(doc.pageCount).toBeGreaterThan(1);
    const essay = make("long_text", { label: "Story" });
    const rank = make("ranking", { label: "Order" });
    const bytes = responsePdf({ formTitle: "Survey", brandName: "G", fields: [essay, rank], response: response({ [essay.id]: "Hello there", [rank.id]: rank.config.choices!.map((item) => item.id).reverse() }), accentColor: "#000000" });
    const pdf = latin1(bytes);
    expect(pdf).toContain("(Hello there)");
    expect(pdf).toContain("(1. Option 3)");
  });
});

describe("mirror", () => {
  const secret = "local-dev-secret-at-least-16-chars";

  it("encrypts credentials and refuses tampered ciphertext or a changed AUTH_SECRET", () => {
    const token = encryptSecret("patABCDEFGHIJ.0123456789abcdefghij", secret);
    expect(token).not.toContain("patABC");
    expect(decryptSecret(token, secret)).toBe("patABCDEFGHIJ.0123456789abcdefghij");
    expect(decryptSecret(token, `${secret}-rotated`)).toBeNull();
    const parts = token.split(".");
    parts[3] = `${parts[3]!.slice(0, -2)}AA`;
    expect(decryptSecret(parts.join("."), secret)).toBeNull();
    expect(() => encryptSecret("x", "short")).toThrow(/AUTH_SECRET/);
  });

  it("validates targets and credentials", () => {
    expect(parseAirtableTarget({ baseId: "appABCDEFGHIJKLMN", table: "Responses" }).ok).toBe(true);
    expect(parseAirtableTarget({ baseId: "base1", table: "Responses" }).ok).toBe(false);
    expect(airtableTokenProblem("patABCDEFGHIJ.0123456789abcdefghij0123")).toBeNull();
    expect(airtableTokenProblem("keyOld")).toMatch(/personal access token/);
    const sheet = parseSheetsTarget({ spreadsheet: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0", sheet: "" });
    expect(sheet).toEqual({ ok: true, target: { spreadsheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", sheet: "Responses" } });
    expect(parseSheetsTarget({ spreadsheet: "nope", sheet: "x" }).ok).toBe(false);
    expect(parseGoogleCredentials("{").ok).toBe(false);
    expect(parseGoogleCredentials(JSON.stringify({ client_email: "bot@proj.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----x" })).ok).toBe(true);
    expect(safeError("bad token patABCDEFGHIJ.0123456789abcdef and Bearer xyz")).toBe("bad token pat… and Bearer …");
  });

  it("turns a response into the same columns as the export, and aligns it to a sheet header", () => {
    const q = make("short_text", { label: "Q" });
    const q2 = make("short_text", { label: "New Q" });
    const record = mirrorRecord([q, q2], response({ [q.id]: "=HYPERLINK(1)", [q2.id]: "b" }));
    expect(record.header.slice(0, 2)).toEqual(["Response ID", "Status"]);
    expect(airtablePayload(record).records[0]!.fields.Q).toBe("=HYPERLINK(1)");
    expect(airtablePayload(record).typecast).toBe(true);
    expect(missingColumns(["Response ID", "Q"], record.header)).toContain("New Q");
    const aligned = alignToHeader(["Q", "Response ID"], record);
    expect(aligned.header.slice(0, 2)).toEqual(["Q", "Response ID"]);
    expect(aligned.headerChanged).toBe(true);
    expect(aligned.row[0]).toBe("'=HYPERLINK(1)");
    expect(aligned.row[aligned.header.indexOf("New Q")]).toBe("b");
    expect(alignToHeader([], record).headerChanged).toBe(true);
    expect(alignToHeader(record.header, record).headerChanged).toBe(false);
    expect(a1Column(1)).toBe("A");
    expect(a1Column(28)).toBe("AB");
    expect(buildExportTable([q], []).header).toEqual(record.header.filter((column) => column !== "New Q"));
  });

  it("signs a Google service-account JWT that verifies with the public key", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwt = googleJwt({ client_email: "bot@proj.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() }, new Date("2026-11-17T12:00:00Z"));
    const [head, body, signature] = jwt.split(".");
    const claims = JSON.parse(Buffer.from(body!, "base64url").toString());
    expect(claims).toMatchObject({ iss: "bot@proj.iam.gserviceaccount.com", aud: "https://oauth2.googleapis.com/token", exp: claims.iat + 3600 });
    expect(createVerify("RSA-SHA256").update(`${head}.${body}`).verify(publicKey, Buffer.from(signature!, "base64url"))).toBe(true);
  });

  it("selects responses to retry with backoff, never spam or partials", () => {
    const now = new Date("2026-11-17T12:00:00Z");
    const ago = (minutes: number) => new Date(now.getTime() - minutes * 60000);
    const base = { status: "COMPLETE", spamReason: null };
    const due = mirrorDue(
      [
        { ...base, id: "pending-old", mirrorStatus: "pending", mirrorAttempts: 0, mirrorTriedAt: ago(6) },
        { ...base, id: "pending-new", mirrorStatus: "pending", mirrorAttempts: 0, mirrorTriedAt: ago(1) },
        { ...base, id: "failed-1-due", mirrorStatus: "failed", mirrorAttempts: 1, mirrorTriedAt: ago(6) },
        { ...base, id: "failed-3-wait", mirrorStatus: "failed", mirrorAttempts: 3, mirrorTriedAt: ago(20) },
        { ...base, id: "gave-up", mirrorStatus: "failed", mirrorAttempts: 8, mirrorTriedAt: ago(9999) },
        { ...base, id: "ok", mirrorStatus: "ok", mirrorAttempts: 1, mirrorTriedAt: ago(9999) },
        { ...base, id: "spam", mirrorStatus: "pending", mirrorAttempts: 0, mirrorTriedAt: ago(60), spamReason: "honeypot" },
        { ...base, id: "partial", mirrorStatus: "pending", mirrorAttempts: 0, mirrorTriedAt: ago(60), status: "PARTIAL" },
      ],
      now,
    );
    expect(due).toEqual(["pending-old", "failed-1-due"]);
  });
});

describe("job selection", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  const ago = (hours: number) => new Date(now.getTime() - hours * 3600000);

  it("reaps only old files nothing points at", () => {
    const orphans = orphanFiles(
      [
        { id: "u-orphan", kind: "upload", responseId: null, createdAt: ago(30) },
        { id: "u-young", kind: "upload", responseId: null, createdAt: ago(2) },
        { id: "u-kept", kind: "upload", responseId: "r1", createdAt: ago(300) },
        { id: "sig-orphan", kind: "signature", responseId: null, createdAt: ago(48) },
        { id: "logo-used", kind: "logo", responseId: null, createdAt: ago(300) },
        { id: "logo-unused", kind: "logo", responseId: null, createdAt: ago(300) },
      ],
      new Set(["logo-used"]),
      now,
    );
    expect(orphans).toEqual(["u-orphan", "sig-orphan", "logo-unused"]);
  });

  it("publishes scheduled drafts and closes forms past their window or cap", () => {
    const row = (patch: Partial<ScheduleRow>): ScheduleRow => ({ id: "x", status: "DRAFT", opensAt: null, closesAt: null, autoPublish: false, responseLimit: null, publishedAt: null, ...patch });
    const actions = scheduleActions(
      [
        row({ id: "auto", autoPublish: true, opensAt: ago(1) }),
        row({ id: "auto-future", autoPublish: true, opensAt: new Date(now.getTime() + 3600000) }),
        row({ id: "auto-off", autoPublish: false, opensAt: ago(1) }),
        row({ id: "auto-already-closed", autoPublish: true, opensAt: ago(5), closesAt: ago(1) }),
        row({ id: "open-past", status: "OPEN", closesAt: ago(1) }),
        row({ id: "open-full", status: "OPEN", responseLimit: 10 }),
        row({ id: "open-room", status: "OPEN", responseLimit: 10 }),
        row({ id: "closed", status: "CLOSED", closesAt: ago(1) }),
      ],
      new Map([
        ["open-full", 10],
        ["open-room", 9],
      ]),
      now,
    );
    expect(actions).toEqual([
      { id: "auto", action: "publish", reason: "opens" },
      { id: "open-past", action: "close", reason: "closes" },
      { id: "open-full", action: "close", reason: "limit" },
    ]);
  });
});
