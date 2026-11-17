import { generateKeyPairSync, createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  effectiveTier,
  mappingFromHeaders,
  mappingToHeaders,
  overridePercentile,
  overrideProblem,
  parseSnapshots,
  parseTierOverride,
  planUndo,
  restoreData,
  snapshotRow,
  toCsv,
} from "./imports";
import { PACKAGE_COMPONENTS, componentFileNames, componentPrompt, componentSpec, modelFor, parseDirection } from "./packager";
import { guessMapping, parseCsv } from "./performance";
import {
  cleanRange,
  decryptSecret,
  encryptSecret,
  explainSheetsError,
  parseServiceAccount,
  parseSpreadsheetId,
  signedAssertion,
  syncDue,
  tableHash,
  valuesToTable,
} from "./sheets";
import { RESEARCH_SCHEMA, findingsBlock, normalizeFindings, parseFindings, researchSystem, sourcesMarkdown, withSources, type Finding } from "./timely";
import { coverage, examplesBlock, exampleFromBestPerformer, exampleFromComponent, excludeRefsFor, rankExamples, type TrainingExample } from "./training";

function strict(node: unknown): boolean {
  if (!node || typeof node !== "object") return true;
  const obj = node as Record<string, unknown>;
  if (obj.type === "object") {
    const props = Object.keys((obj.properties as object) ?? {});
    if (obj.additionalProperties !== false || props.some((p) => !((obj.required as string[]) ?? []).includes(p))) return false;
  }
  return Object.values(obj).every((value) => (Array.isArray(value) ? value.every(strict) : strict(value)));
}

describe("undo import", () => {
  it("deletes rows the import created and restores rows it replaced", () => {
    const before = snapshotRow({ codeKey: "AB1", importId: "old", promoCode: "AB-1", orders: 10, revenue: 500, startDate: new Date("2026-01-02T00:00:00Z") });
    const plan = planUndo({
      importId: "imp",
      createdCodes: ["NEW1"],
      previous: [before],
      current: [
        { codeKey: "NEW1", importId: "imp" },
        { codeKey: "AB1", importId: "imp" },
      ],
    });
    expect(plan.remove).toEqual(["NEW1"]);
    expect(plan.restore).toHaveLength(1);
    const data = restoreData(plan.restore[0]!);
    expect(data).toMatchObject({ importId: "old", orders: 10, revenue: 500 });
    expect(data.startDate).toEqual(new Date("2026-01-02T00:00:00Z"));
    expect(plan.kept).toEqual([]);
  });

  it("leaves rows a later import changed, and skips rows that are gone", () => {
    const plan = planUndo({
      importId: "imp",
      createdCodes: ["NEW1", "GONE"],
      previous: [snapshotRow({ codeKey: "AB1", importId: "old", orders: 1 })],
      current: [
        { codeKey: "NEW1", importId: "later" },
        { codeKey: "AB1", importId: "later" },
      ],
    });
    expect(plan).toEqual({ remove: [], restore: [], kept: ["NEW1", "AB1"] });
  });

  it("round-trips snapshots through JSON", () => {
    const snap = snapshotRow({ codeKey: "X", importId: null, extra: { a: "1" }, endDate: new Date("2026-03-01T00:00:00Z") });
    const parsed = parseSnapshots(JSON.parse(JSON.stringify([snap, { junk: true }])));
    expect(parsed).toHaveLength(1);
    expect(restoreData(parsed[0]!).endDate).toEqual(new Date("2026-03-01T00:00:00Z"));
  });
});

describe("tier overrides", () => {
  it("lets a person's tier win, including 'no tier'", () => {
    expect(effectiveTier("middle", null)).toBe("middle");
    expect(effectiveTier("middle", "top10")).toBe("top10");
    expect(effectiveTier("top10", "none")).toBeNull();
  });

  it("moves the real-world percentile with the override", () => {
    expect(overridePercentile(null, 0.42)).toBe(0.42);
    expect(overridePercentile("top10", 0.42)).toBeGreaterThanOrEqual(0.9);
    expect(overridePercentile("none", 0.42)).toBeNull();
  });

  it("requires a known tier and a reason", () => {
    expect(parseTierOverride("bogus")).toBeNull();
    expect(overrideProblem({ tier: "top10", reason: "" })).toMatch(/why/);
    expect(overrideProblem({ tier: "nope", reason: "a good reason" })).toMatch(/Pick/);
    expect(overrideProblem({ tier: "top10", reason: "Launch list was bought; real list is tiny" })).toBeNull();
  });
});

describe("sheet sync helpers", () => {
  it("reads a sheet link or id", () => {
    expect(parseSpreadsheetId("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit#gid=0")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
    expect(parseSpreadsheetId("1AbCdEfGhIjKlMnOpQrStUvWxYz012345")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
    expect(parseSpreadsheetId("not a sheet")).toBeNull();
    expect(cleanRange("")).toBe("Sheet1");
  });

  it("validates a service-account key and signs a token request with it", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(parseServiceAccount("{")).toHaveProperty("error");
    expect(parseServiceAccount(JSON.stringify({ type: "user" }))).toHaveProperty("error");
    const account = parseServiceAccount(JSON.stringify({ type: "service_account", client_email: "sync@proj.iam.gserviceaccount.com", private_key: pem, token_uri: "https://evil.example/token" }));
    if ("error" in account) throw new Error(account.error);
    expect(account.tokenUri).toBe("https://oauth2.googleapis.com/token");
    const jwt = signedAssertion(account, Date.UTC(2026, 10, 17));
    const [h, c, sig] = jwt.split(".");
    const claims = JSON.parse(Buffer.from(c!, "base64url").toString());
    expect(claims).toMatchObject({ iss: "sync@proj.iam.gserviceaccount.com", aud: "https://oauth2.googleapis.com/token" });
    expect(claims.exp - claims.iat).toBe(3600);
    const verify = createVerify("RSA-SHA256");
    verify.update(`${h}.${c}`);
    expect(verify.verify(publicKey, Buffer.from(sig!, "base64url"))).toBe(true);
  });

  it("encrypts credentials with AUTH_SECRET and refuses another secret", () => {
    const secret = "local-dev-secret-at-least-16-chars";
    const plain = '{"private_key":"PRIVATE-MARKER"}';
    const sealed = encryptSecret(plain, secret);
    expect(sealed).not.toContain("PRIVATE-MARKER");
    expect(sealed).not.toContain(Buffer.from(plain).toString("base64url").slice(0, 12));
    expect(encryptSecret(plain, secret)).not.toBe(sealed);
    expect(decryptSecret(sealed, secret)).toBe(plain);
    expect(decryptSecret(sealed, "another-secret-of-enough-length")).toBeNull();
    expect(() => encryptSecret("x", "short")).toThrow(/AUTH_SECRET/);
  });

  it("pads API rows, drops blank rows, and turns the table into CSV the importer reads back", () => {
    const table = valuesToTable([["Code", "Orders", "Revenue"], ["AB-1", "10"], [], ["C,2", "3", '$1,0"0']]);
    expect(table).toEqual([
      ["Code", "Orders", "Revenue"],
      ["AB-1", "10", ""],
      ["C,2", "3", '$1,0"0'],
    ]);
    expect(parseCsv(toCsv(table))).toEqual(table);
    expect(tableHash(table)).toBe(tableHash(valuesToTable([["Code", "Orders", "Revenue"], ["AB-1", "10"], ["C,2", "3", '$1,0"0']])));
  });

  it("remembers the mapping by header name so moved columns still map", () => {
    const headers = ["Promo Code", "Orders", "Revenue"];
    const byName = mappingToHeaders(guessMapping(headers), headers);
    const moved = mappingFromHeaders(byName, ["Revenue", "promo code", "Orders"]);
    expect(moved.code).toBe(1);
    expect(moved.orders).toBe(2);
    expect(moved.revenue).toBe(0);
    expect(mappingFromHeaders(byName, ["Something else"]).code).toBe(-1);
  });

  it("knows when a sync is due", () => {
    const now = new Date("2026-11-17T12:00:00Z");
    const base = { enabled: true, everyHours: 6, status: "OK", updatedAt: now };
    expect(syncDue({ ...base, lastSyncAt: null }, now)).toBe(true);
    expect(syncDue({ ...base, lastSyncAt: new Date("2026-11-17T09:00:00Z") }, now)).toBe(false);
    expect(syncDue({ ...base, lastSyncAt: new Date("2026-11-17T05:00:00Z") }, now)).toBe(true);
    expect(syncDue({ ...base, enabled: false, lastSyncAt: null }, now)).toBe(false);
    expect(syncDue({ ...base, status: "RUNNING", lastSyncAt: null, updatedAt: new Date("2026-11-17T11:50:00Z") }, now)).toBe(false);
    expect(explainSheetsError(403, "")).toMatch(/Share the sheet/);
  });
});

describe("package web research", () => {
  const answer = {
    findings: [
      { headline: "Agency sets new rule", summary: "The agency said it will vote in December.", when: "Dec 2026", whyItMatters: "Ties to the promo's theme.", sourceTitle: "Daily News", sourceUrl: "https://news.example.com/a" },
      { headline: "No link", summary: "x", when: "", whyItMatters: "", sourceTitle: "", sourceUrl: "" },
      { headline: "Bad scheme", summary: "x", when: "", whyItMatters: "", sourceTitle: "", sourceUrl: "javascript:alert(1)" },
      { headline: "Duplicate", summary: "x", when: "", whyItMatters: "", sourceTitle: "", sourceUrl: "https://news.example.com/a" },
    ],
  };

  it("keeps only findings with a real source link and remembers editor checks", () => {
    const findings = normalizeFindings(answer, [{ id: "f9", headline: "old", summary: "", when: "", whyItMatters: "", sourceTitle: "", sourceUrl: "https://news.example.com/a", checked: true }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ id: "f1", sourceUrl: "https://news.example.com/a", checked: true });
    expect(parseFindings(JSON.parse(JSON.stringify(findings)))).toEqual(findings);
    expect(strict(RESEARCH_SCHEMA)).toBe(true);
  });

  it("shows reader-facing copy only editor-checked findings, the guide all of them with sources", () => {
    const f: Finding[] = [
      { id: "f1", headline: "Checked", summary: "s", when: "", whyItMatters: "w", sourceTitle: "A", sourceUrl: "https://a.example.com/", checked: true },
      { id: "f2", headline: "Unchecked", summary: "s", when: "", whyItMatters: "w", sourceTitle: "B", sourceUrl: "https://b.example.com/", checked: false },
    ];
    expect(findingsBlock(f, "reader")).toContain("Checked");
    expect(findingsBlock(f, "reader")).not.toContain("Unchecked");
    expect(findingsBlock(f, "internal")).toContain("[not yet checked]");
    expect(findingsBlock(f.filter((x) => !x.checked), "reader")).toBe("");
    const once = withSources("### Guide\n\nBody", f);
    expect(once).toContain("https://b.example.com/");
    expect(withSources(once, f.slice(0, 1))).not.toContain("https://b.example.com/");
    expect(sourcesMarkdown(f)).toContain("not yet checked");
  });

  it("is written for the brand's niche", () => {
    expect(researchSystem("health")).toContain("studies");
    expect(researchSystem("general")).not.toMatch(/market|stock/i);
  });
});

describe("model tiers and effort", () => {
  it("gives the launch copy the premium model and more effort than short ads", () => {
    expect(componentSpec("vsl-lift-notes")).toMatchObject({ tier: "premium", effort: "high" });
    expect(componentSpec("order-form")?.effort).toBe("xhigh");
    expect(componentSpec("short-text-ads")).toMatchObject({ tier: "standard", effort: "low" });
    expect(componentSpec("editorial-guide")?.research).toBe("internal");
    expect(PACKAGE_COMPONENTS.every((spec) => spec.tier && spec.effort)).toBe(true);
    expect(modelFor("premium", {})).toBeUndefined();
    expect(modelFor("standard", {})).toBe("claude-sonnet-5-5");
    expect(modelFor("standard", { PACKAGER_STANDARD_MODEL: "claude-opus-5-5" })).toBe("claude-opus-5-5");
  });
});

describe("one Word file per component", () => {
  it("numbers files in order and never collides", () => {
    expect(componentFileNames([{ label: "Space ads" }, { label: "Order form" }, { label: "Space ads" }])).toEqual(["01 Space ads.docx", "02 Order form.docx", "03 Space ads.docx"]);
    expect(componentFileNames([{ label: "A/B: test?" }])[0]).toBe("01 AB test.docx");
  });
});

describe("training library retrieval", () => {
  const ex = (id: string, over: Partial<TrainingExample> = {}): TrainingExample => ({
    id,
    kind: "space-ads",
    publication: null,
    niche: "finance",
    title: id,
    content: `content ${id}`,
    source: "component",
    sourceRef: `component:${id}`,
    enabled: true,
    tags: [],
    updatedAt: new Date("2026-11-01T00:00:00Z"),
    ...over,
  });

  it("only returns enabled examples of the same type and niche, never the package's own", () => {
    const list = [ex("a"), ex("off", { enabled: false }), ex("other-kind", { kind: "order-form" }), ex("health", { niche: "health" }), ex("self"), ex("generic", { niche: "general" })];
    const picked = rankExamples(list, { kind: "space-ads", publication: null, niche: "finance", excludeRefs: ["component:self"] }, 10).map((e) => e.id);
    expect(picked.sort()).toEqual(["a", "generic"]);
  });

  it("ranks same publication, then best performers, then newest", () => {
    const list = [
      ex("old", { updatedAt: new Date("2026-01-01T00:00:00Z") }),
      ex("new", { updatedAt: new Date("2026-11-10T00:00:00Z") }),
      ex("best", { source: "best-performer" }),
      ex("pub", { publication: "Daily Profits" }),
    ];
    expect(rankExamples(list, { kind: "space-ads", publication: "daily profits", niche: "finance" }, 3).map((e) => e.id)).toEqual(["pub", "best", "new"]);
  });

  it("builds the prompt block, the coverage counts and the examples from components and best performers", () => {
    const block = examplesBlock([ex("a")]);
    expect(block).toContain("<examples>");
    expect(block).toContain("Never reuse their claims");
    expect(examplesBlock([])).toBe("");
    expect(coverage([ex("a"), ex("b", { enabled: false }), ex("c", { kind: "order-form" })]).get("space-ads")).toBe(1);
    expect(exampleFromComponent({ componentId: "c1", kind: "space-ads", content: "copy", promoTitle: "Gold", promoId: "p1", publication: null, niche: "finance" })).toMatchObject({ sourceRef: "component:c1", title: "Space ads: Gold" });
    expect(exampleFromBestPerformer({ promoId: "p1", title: "Gold", publication: null, niche: "finance", headline: { eyebrow: "", headline: "The one move", subhead: "Sub" }, performance: null })?.content).toContain("**Headline:** The one move");
    expect(exampleFromBestPerformer({ promoId: "p1", title: "Gold", publication: null, niche: "finance", headline: { headline: " " }, performance: null })).toBeNull();
    expect(excludeRefsFor(["c1"], "p1")).toEqual(["component:c1", "best-performer:p1"]);
  });

  it("puts examples and research into the component prompt", () => {
    const text = componentPrompt({
      brandContext: "Brand: Test",
      promo: { title: "P", product: null, publisher: null, gurus: [], sourceText: "copy", analysis: null },
      direction: parseDirection({}),
      spec: componentSpec("space-ads")!,
      quantity: 2,
      bestPerformers: [],
      brainNotes: [],
      examples: examplesBlock([ex("a")]),
      research: "<timely_research>x</timely_research>",
    });
    expect(text).toContain("<examples>");
    expect(text).toContain("<timely_research>");
  });
});
