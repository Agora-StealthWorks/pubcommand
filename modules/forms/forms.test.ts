import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { formStats, npsScore } from "./analytics";
import { buildExportTable, columnName, neutralizeFormula, toCsv, toXlsx } from "./export";
import { FIELD_TYPES, OTHER_PREFIX, checkAnswer, createField, fieldSpec, paletteGroups, sanitizeField } from "./fields";
import { buildPages, checkSubmission, cleanLogic, logicProblems, nextOnPath, pageErrors, resolveForm } from "./logic";
import { manifest } from "./manifest";
import { STARTERS, starterFields } from "./starters";
import { aggregateReport, brainNote, deletionPlan } from "./summary";
import { acceptingResponses, captureUtm, disclaimerText, hiddenValues, logoHeightPx, publishProblems, resolveTheme, spamVerdict } from "./theme";
import type { FieldDef, ResponseRecord } from "./types";

let n = 0;
const id = () => `f${++n}`;
const make = (type: string, patch: Partial<FieldDef> = {}): FieldDef => ({ ...createField(type, id()), ...patch });

describe("manifest", () => {
  it("keeps the forms id, route and three permissions", () => {
    expect(manifest.id).toBe("forms");
    expect(manifest.routes.map((route) => route.path)).toEqual(["/forms"]);
    expect(manifest.permissions.map((permission) => permission.key)).toEqual(["forms.read", "forms.write", "forms.export"]);
  });
});

describe("field registry", () => {
  it("covers the old app's field types and groups every type in the palette", () => {
    const types = FIELD_TYPES.map((spec) => spec.type);
    for (const type of ["name", "email", "phone", "address", "short_text", "long_text", "number", "single_choice", "multi_choice", "dropdown", "rating", "scale", "nps", "date", "yes_no", "consent", "file_upload", "signature", "hidden", "statement", "page_break"]) {
      expect(types).toContain(type);
    }
    expect(paletteGroups().flatMap((group) => group.types).length).toBe(FIELD_TYPES.length);
    expect(new Set(types).size).toBe(types.length);
  });

  it("validates contact fields", () => {
    const email = make("email", { required: true });
    expect(checkAnswer(email, "a@b.co").error).toBeNull();
    expect(checkAnswer(email, "not-an-email").error).toMatch(/valid email/);
    expect(checkAnswer(email, "  ").error).toMatch(/required/);
    expect(checkAnswer(make("phone"), "+1 (555) 010-0000").error).toBeNull();
    expect(checkAnswer(make("phone"), "call me").error).toMatch(/phone/);
    expect(checkAnswer(make("website"), "https://example.com").error).toBeNull();
    expect(checkAnswer(make("website"), "example").error).not.toBeNull();
    const address = make("address", { required: true });
    expect(checkAnswer(address, { line1: "1 Main St", city: "Town", postal: "12345" }).error).toBeNull();
    expect(checkAnswer(address, { line1: "1 Main St" }).error).toMatch(/city/);
    expect(checkAnswer(address, {}).error).toMatch(/required/);
  });

  it("validates choices, including other and selection limits", () => {
    const pick = make("single_choice");
    const [a] = pick.config.choices!;
    expect(checkAnswer(pick, a!.id).error).toBeNull();
    expect(checkAnswer(pick, "made-up").error).toMatch(/Pick one/);
    expect(checkAnswer(pick, `${OTHER_PREFIX}mine`).error).not.toBeNull();
    expect(checkAnswer({ ...pick, config: { ...pick.config, allowOther: true } }, `${OTHER_PREFIX}mine`).error).toBeNull();
    const many = make("multi_choice", { config: { ...createField("multi_choice", "x").config, maxSelections: 1 } });
    const ids = many.config.choices!.map((choice) => choice.id);
    expect(checkAnswer(many, [ids[0]]).error).toBeNull();
    expect(checkAnswer(many, [ids[0], ids[1]]).error).toMatch(/no more than 1/);
    expect(checkAnswer(many, [ids[0], ids[0]]).value).toEqual([ids[0]]);
  });

  it("validates scales, numbers and dates", () => {
    expect(checkAnswer(make("nps"), 10).error).toBeNull();
    expect(checkAnswer(make("nps"), 11).error).toMatch(/0 to 10/);
    expect(checkAnswer(make("rating"), "4").value).toBe(4);
    expect(checkAnswer(make("rating"), 0).error).not.toBeNull();
    expect(checkAnswer(make("number", { config: { min: 1, max: 9 } }), 12).error).toMatch(/9 or less/);
    expect(checkAnswer(make("number"), "abc").error).toMatch(/format/);
    expect(checkAnswer(make("date"), "2026-02-30").error).toMatch(/real date/);
    expect(checkAnswer(make("date"), "2026-02-28").error).toBeNull();
  });

  it("requires consent to be ticked and a signature to be real", () => {
    const consent = make("consent", { required: true });
    expect(checkAnswer(consent, true).error).toBeNull();
    expect(checkAnswer(consent, false).error).toMatch(/tick/);
    const signature = make("signature", { required: true });
    expect(checkAnswer(signature, { dataUrl: "data:image/png;base64,AAAA" }).error).toBeNull();
    expect(checkAnswer(signature, { dataUrl: "javascript:alert(1)" }).error).not.toBeNull();
    expect(checkAnswer(signature, { typedName: "A Person" }).error).toBeNull();
    expect(checkAnswer({ ...signature, config: { allowTyped: false } }, { typedName: "A Person" }).error).not.toBeNull();
  });

  it("checks uploads by size and extension", () => {
    const upload = make("file_upload");
    expect(checkAnswer(upload, { filename: "cv.pdf", size: 1000, mimeType: "application/pdf" }).error).toBeNull();
    expect(checkAnswer(upload, { filename: "run.exe", size: 1000 }).error).toMatch(/Upload one of/);
    expect(checkAnswer(upload, { filename: "big.pdf", size: 50 * 1024 * 1024 }).error).toMatch(/under/);
  });

  it("sanitizes builder input: unknown types, junk config, required on layout", () => {
    expect(sanitizeField({ ...make("short_text"), type: "script" })).toBeNull();
    const clean = sanitizeField({ ...make("statement"), required: true, config: { body: "Hi", choices: [{ id: "x", label: "y" }] } })!;
    expect(clean.required).toBe(false);
    expect(clean.config).toEqual({ body: "Hi" });
    const upload = sanitizeField({ ...make("file_upload"), config: { accept: [".pdf", "exe", ".PNG"], maxSizeMb: 999 } })!;
    expect(upload.config).toEqual({ accept: [".pdf", ".png"], maxSizeMb: 25 });
  });
});

describe("branching logic", () => {
  function branchingForm() {
    const subscribed = make("yes_no", { label: "Subscribed?", required: true });
    const which = make("single_choice", {
      label: "Which plan?",
      required: true,
      visibility: { action: "show", match: "all", rules: [{ fieldId: subscribed.id, op: "equals", value: true }] },
    });
    const why = make("long_text", {
      label: "Why not?",
      required: true,
      visibility: { action: "show", match: "all", rules: [{ fieldId: subscribed.id, op: "equals", value: false }] },
    });
    const email = make("email", { required: true });
    return { subscribed, which, why, email, fields: [subscribed, which, why, email] };
  }

  it("builds one question per page and keeps statements and groups together", () => {
    const intro = make("statement");
    const name = make("name", { groupWithNext: true });
    const email = make("email");
    const phone = make("phone");
    const utm = make("hidden");
    const pages = buildPages([intro, name, email, utm, phone], "paginated");
    expect(pages.map((page) => page.fieldIds)).toEqual([[intro.id, name.id, email.id], [phone.id]]);
    const brk = make("page_break");
    expect(buildPages([name, email, brk, phone], "single").map((page) => page.fieldIds)).toEqual([[name.id, email.id], [phone.id]]);
  });

  it("shows a follow-up only when the earlier answer matches", () => {
    const { subscribed, which, why, fields } = branchingForm();
    const yes = resolveForm(fields, "paginated", { [subscribed.id]: true });
    expect(yes.visibleIds.has(which.id)).toBe(true);
    expect(yes.visibleIds.has(why.id)).toBe(false);
    const no = resolveForm(fields, "paginated", { [subscribed.id]: false });
    expect(no.visibleIds.has(which.id)).toBe(false);
    expect(no.visibleIds.has(why.id)).toBe(true);
  });

  it("rejects a crafted POST that skips a required field by omitting it", () => {
    const { subscribed, which, email, fields } = branchingForm();
    const crafted = checkSubmission(fields, "paginated", {
      [subscribed.id]: true,
      [email.id]: "a@b.co",
      // The browser claims "which" was hidden. The server never reads such claims.
      __hidden: [which.id],
    });
    expect(crafted.ok).toBe(false);
    expect(Object.keys(crafted.errors)).toEqual([which.id]);
  });

  it("drops answers to hidden fields and unknown keys instead of storing them", () => {
    const { subscribed, which, why, email, fields } = branchingForm();
    const result = checkSubmission(fields, "paginated", {
      [subscribed.id]: false,
      [which.id]: which.config.choices![0]!.id,
      [why.id]: "Too busy",
      [email.id]: "a@b.co",
      injected: "x",
    });
    expect(result.ok).toBe(true);
    expect(result.answers).toEqual({ [subscribed.id]: false, [why.id]: "Too busy", [email.id]: "a@b.co" });
  });

  it("follows skip logic forward and never requires skipped questions", () => {
    const attending = make("yes_no", { required: true });
    const session = make("short_text", { required: true });
    const after = make("short_text", { required: true });
    attending.skipLogic = { rules: [{ fieldId: attending.id, op: "equals", value: false, goTo: "submit" }] };
    const fields = [attending, session, after];
    const state = resolveForm(fields, "paginated", { [attending.id]: false });
    expect(state.path).toEqual([0]);
    expect(nextOnPath(state, 0)).toBeNull();
    expect(checkSubmission(fields, "paginated", { [attending.id]: false }).ok).toBe(true);
    expect(checkSubmission(fields, "paginated", { [attending.id]: true }).ok).toBe(false);
    // Jump over one page to a later one.
    attending.skipLogic = { rules: [{ fieldId: attending.id, op: "equals", value: true, goTo: after.id }] };
    const jumped = resolveForm(fields, "paginated", { [attending.id]: true });
    expect(jumped.path).toEqual([0, 2]);
    expect(checkSubmission(fields, "paginated", { [attending.id]: true, [after.id]: "x" }).ok).toBe(true);
  });

  it("ignores backward jumps and rules on later fields, and reports them", () => {
    const first = make("short_text", { label: "First" });
    const second = make("yes_no", { label: "Second" });
    second.skipLogic = { rules: [{ fieldId: second.id, op: "answered", goTo: first.id }] };
    first.visibility = { action: "show", match: "all", rules: [{ fieldId: second.id, op: "equals", value: true }] };
    const fields = [first, second];
    const state = resolveForm(fields, "paginated", { [second.id]: true });
    // "first" depends on a later answer, which is never available when it is evaluated.
    expect(state.visibleIds.has(first.id)).toBe(false);
    expect(state.path).toEqual([1]);
    const problems = logicProblems(fields, "paginated");
    expect(problems.some((problem) => problem.includes("comes later"))).toBe(true);
    expect(problems.some((problem) => problem.includes("backwards"))).toBe(true);
  });

  it("checks a page's visible fields only", () => {
    const { subscribed, which, fields } = branchingForm();
    const state = resolveForm(fields, "paginated", { [subscribed.id]: true });
    expect(pageErrors(fields, state, 1, {})).toEqual({ [which.id]: "This question is required." });
    expect(pageErrors(fields, state, 2, {})).toEqual({});
  });

  it("cleans rules pointing at deleted fields", () => {
    const a = make("yes_no");
    const b = make("short_text", { visibility: { action: "show", match: "all", rules: [{ fieldId: "gone", op: "equals", value: true }] } });
    expect(cleanLogic([a, b])[1]!.visibility).toBeNull();
  });

  it("starter forms have valid logic", () => {
    for (const starter of STARTERS) expect(logicProblems(starterFields(starter.key, id), "paginated")).toEqual([]);
  });
});

describe("theme and publishing", () => {
  it("resolves logo size, colours and privacy link", () => {
    expect(logoHeightPx({ logoHeight: null, headerSize: "tall" })).toBe(72);
    expect(logoHeightPx({ logoHeight: 500, headerSize: "standard" })).toBe(160);
    const theme = resolveTheme(
      { logoSrc: null, logoHeight: null, headerSize: "standard", barColor: "red", accentColor: "#123456", privacyPolicyUrl: "javascript:x", companyName: "", footerText: null },
      "Example Brand",
    );
    expect(theme.barColor).toBe("#0b1220");
    expect(theme.accentColor).toBe("#123456");
    expect(theme.privacyPolicyUrl).toBeNull();
    expect(theme.companyName).toBe("Example Brand");
  });

  it("blocks publishing without a theme privacy URL or questions", () => {
    const q = make("short_text");
    expect(publishProblems({ title: "T", slug: "t", fields: [q], layout: "paginated", theme: { privacyPolicyUrl: "https://example.com/privacy" } })).toEqual([]);
    const problems = publishProblems({ title: "", slug: "Bad Slug", fields: [], layout: "paginated", theme: null });
    expect(problems).toEqual(expect.arrayContaining(["Give the form a title.", "Add at least one question."]));
    expect(problems.some((problem) => problem.includes("privacy"))).toBe(true);
  });

  it("names the company in the disclaimer when personal data is collected", () => {
    expect(disclaimerText(null, "Acme", [make("email")])).toMatch(/Acme may store/);
    expect(disclaimerText("Custom words", "Acme", [make("email")])).toBe("Custom words");
  });

  it("opens and closes on schedule and caps responses", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    const base = { status: "OPEN", opensAt: null, closesAt: null, responseLimit: null };
    expect(acceptingResponses(base, 0, now).open).toBe(true);
    expect(acceptingResponses({ ...base, status: "DRAFT" }, 0, now).open).toBe(false);
    expect(acceptingResponses({ ...base, closesAt: new Date("2026-05-01") }, 0, now).reason).toMatch(/closed/);
    expect(acceptingResponses({ ...base, responseLimit: 2 }, 2, now).open).toBe(false);
  });

  it("flags spam without discarding it and captures UTM and hidden values", () => {
    expect(spamVerdict({ honeypot: "x", startedAt: null, now: 0 })).toBe("honeypot");
    expect(spamVerdict({ honeypot: "", startedAt: 1000, now: 2000 })).toBe("too-fast");
    expect(spamVerdict({ honeypot: "", startedAt: 1000, now: 20000 })).toBeNull();
    expect(captureUtm("?utm_source=news&utm_medium=email&x=1")).toEqual({ utm_source: "news", utm_medium: "email" });
    const hidden = make("hidden", { config: { queryParam: "ref", defaultValue: "direct" } });
    expect(hiddenValues([hidden], "?ref=partner")).toEqual({ [hidden.id]: "partner" });
    expect(hiddenValues([hidden], "")).toEqual({ [hidden.id]: "direct" });
  });
});

function response(answers: Record<string, unknown>, patch: Partial<ResponseRecord> = {}): ResponseRecord {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    status: "COMPLETE",
    answers,
    startedAt: new Date("2026-01-01T10:00:00Z"),
    completedAt: new Date("2026-01-01T10:01:30Z"),
    durationMs: 90000,
    lastPageIndex: 2,
    utm: null,
    spamReason: null,
    ...patch,
  };
}

describe("exports", () => {
  const name = make("name", { label: "Name" });
  const pick = make("multi_choice", { label: "Topics" });
  const intro = make("statement");
  const [a, b] = pick.config.choices!;

  it("builds one column per answer field with readable values", () => {
    const table = buildExportTable([intro, name, pick], [response({ [name.id]: "Pat", [pick.id]: [a!.id, b!.id] }, { utm: { utm_source: "news" } })]);
    expect(table.header.slice(5, 7)).toEqual(["Name", "Topics"]);
    expect(table.header).toContain("utm_source");
    expect(table.rows[0]!.slice(5, 7)).toEqual(["Pat", `${a!.label}; ${b!.label}`]);
    expect(table.rows[0]![2]).toBe("2026-01-01 10:00:00");
    expect(table.rows[0]![4]).toBe("90");
  });

  it("escapes CSV and neutralizes spreadsheet formulas", () => {
    expect(neutralizeFormula("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(neutralizeFormula("plain")).toBe("plain");
    const csv = toCsv({ header: ["A", "B"], rows: [['say "hi", ok', "=1+1"]] });
    expect(csv.startsWith("﻿A,B\r\n")).toBe(true);
    expect(csv).toContain('"say ""hi"", ok",\'=1+1\r\n');
  });

  it("writes a valid xlsx zip with escaped inline strings", () => {
    expect(columnName(0)).toBe("A");
    expect(columnName(26)).toBe("AA");
    const bytes = toXlsx({ header: ["Q"], rows: [["<b>&\u0001"]] });
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]));
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain("&lt;b&gt;&amp;</t>");
    expect(sheet).toContain('r="A2"');
  });
});

describe("analytics, AI input and Brain note", () => {
  it("counts choices, NPS and completion, holding out spam and partials", () => {
    const nps = make("nps", { label: "Recommend" });
    const email = make("email", { label: "Email" });
    const source = make("hidden", { label: "Source" });
    const fields = [nps, email, source];
    const responses = [
      response({ [nps.id]: 10, [email.id]: "secret@person.example", [source.id]: "partner" }),
      response({ [nps.id]: 9, [email.id]: "other@person.example", [source.id]: "partner" }),
      response({ [nps.id]: 3, [email.id]: "third@person.example", [source.id]: "one-off-value" }),
      response({ [nps.id]: 0 }, { spamReason: "honeypot" }),
      response({}, { status: "PARTIAL", completedAt: null, lastPageIndex: 0 }),
    ];
    const stats = formStats(fields, responses);
    expect(stats.complete).toBe(3);
    expect(stats.partial).toBe(1);
    expect(stats.flagged).toBe(1);
    expect(stats.completionRate).toBe(75);
    expect(stats.dropOff).toEqual([{ page: 1, count: 1 }]);
    const npsStats = stats.fields.find((item) => item.fieldId === nps.id);
    expect(npsStats && npsStats.kind === "numeric" ? npsStats.nps : null).toEqual({ score: 33, promoters: 2, passives: 0, detractors: 1 });
    expect(npsScore([])).toBeNull();

    // The AI and Brain see aggregates only: no emails, no rare free values.
    const report = aggregateReport({ formTitle: "Survey", stats });
    expect(report).not.toContain("@person.example");
    expect(report).not.toContain("one-off-value");
    expect(report).toContain("NPS 33");
    const note = brainNote({ formTitle: "Survey", brandName: "Brand", stats, summary: null, generatedAt: new Date("2026-01-02") });
    expect(note.body).not.toContain("secret@person.example");
    expect(note.title).toBe("Form results: Survey");
  });
});

describe("deleting responses", () => {
  it("never defaults to everything and needs the title echoed for all", () => {
    expect(deletionPlan({ scope: "", ids: [], confirm: "", formTitle: "T" }).ok).toBe(false);
    expect(deletionPlan({ scope: "selected", ids: ["not-a-uuid"], confirm: "", formTitle: "T" }).ok).toBe(false);
    expect(deletionPlan({ scope: "all", ids: [], confirm: "t", formTitle: "T" }).ok).toBe(false);
    expect(deletionPlan({ scope: "all", ids: [], confirm: " T ", formTitle: "T" }).ok).toBe(true);
    expect(deletionPlan({ scope: "partial", ids: [], confirm: "", formTitle: "T" })).toEqual({ ok: true, scope: "partial", ids: [] });
  });

  it("every registry type has an analytics kind and spec", () => {
    for (const spec of FIELD_TYPES) expect(fieldSpec(spec.type)).toBe(spec);
  });
});

describe("malformed stored logic", () => {
  it("treats empty or broken rule objects as no rules", () => {
    const a = make("short_text", { required: true });
    const broken = { ...make("short_text"), visibility: {} as never, skipLogic: { rules: "x" } as never };
    const state = resolveForm([a, broken], "paginated", {});
    expect(state.visibleIds.has(broken.id)).toBe(true);
    expect(logicProblems([a, broken], "paginated")).toEqual([]);
  });
});
