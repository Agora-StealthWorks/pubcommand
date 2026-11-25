import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISCLOSURE,
  approvalBlockers,
  asFlags,
  cleanViewQuery,
  complianceFlags,
  csvCell,
  defaultConsentText,
  filtersToQuery,
  isPublishable,
  parseFilters,
  parseTestimonialInput,
  publicConsent,
  staffConsent,
  testimonialNote,
  testimonialsCsv,
  type CsvRow,
} from "./testimonials";

const form = (values: Record<string, string>) => ({ get: (key: string) => values[key] ?? null });

describe("testimonial input", () => {
  it("requires a name and a quote and normalizes the rest", () => {
    expect(parseTestimonialInput(form({ quote: "Great" }))).toEqual({ ok: false, error: "Add a name or initials." });
    expect(parseTestimonialInput(form({ displayName: "M.T." }))).toEqual({ ok: false, error: "Add the quote." });
    const ok = parseTestimonialInput(form({ displayName: " Mark T. ", quote: "Worth every penny", tags: "Renewal, renewal ,Big win", rating: "5", videoUrl: "youtu.be/abc", channel: "nope", publicationId: "not-a-uuid", contactEmail: "MARK@Example.com" }));
    expect(ok.ok && ok.values).toMatchObject({ displayName: "Mark T.", tags: ["renewal", "big win"], rating: 5, videoUrl: "https://youtu.be/abc", channel: "other", publicationId: null, contactEmail: "mark@example.com" });
  });
  it("rejects bad ratings, dates, links and emails", () => {
    const base = { displayName: "A", quote: "B" };
    expect(parseTestimonialInput(form({ ...base, rating: "6" })).ok).toBe(false);
    expect(parseTestimonialInput(form({ ...base, givenOn: "2026-13-45" })).ok).toBe(false);
    expect(parseTestimonialInput(form({ ...base, videoUrl: "javascript:alert(1)" })).ok).toBe(false);
    expect(parseTestimonialInput(form({ ...base, contactEmail: "nope" })).ok).toBe(false);
  });
});

describe("compliance rules per niche", () => {
  it("finance: flags specific gains and returns, and gains with no timeframe", () => {
    const flags = complianceFlags({ quote: "I made $12,400 on one trade and my account is up 85%!" }, "finance");
    expect(flags.map((f) => f.code)).toEqual(["specific-gain", "gain-no-timeframe"]);
    expect(flags[0]!.matches).toEqual(expect.arrayContaining(["85%", "$12,400"]));
    expect(complianceFlags({ quote: "Doubled my money in six months" }, "finance").map((f) => f.code)).toEqual(["specific-gain"]);
    expect(complianceFlags({ quote: "Clear, calm and honest research." }, "finance")).toEqual([]);
  });
  it("health: flags disease claims and body results, not gains", () => {
    const flags = complianceFlags({ quote: "It cured my arthritis and I lost 20 pounds" }, "health");
    expect(flags.map((f) => f.code)).toEqual(["disease-claim", "specific-result"]);
    expect(complianceFlags({ quote: "Up 85% this year" }, "health")).toEqual([]);
  });
  it("every niche flags guarantees", () => {
    for (const niche of ["finance", "health", "general"] as const) {
      expect(complianceFlags({ quote: "It's guaranteed to work, risk-free" }, niche).some((f) => f.code === "guarantee")).toBe(true);
    }
  });

  it("health brands need a results-not-typical note before approval", () => {
    const base = { consentGiven: true, flags: [], acknowledged: false };
    expect(approvalBlockers({ ...base, disclosure: null }, "health")).toHaveLength(1);
    expect(approvalBlockers({ ...base, disclosure: DEFAULT_DISCLOSURE.health }, "health")).toEqual([]);
    expect(approvalBlockers({ ...base, disclosure: null }, "finance")).toEqual([]);
  });
  it("finance brands must confirm flagged gains; nobody approves without consent", () => {
    const flags = complianceFlags({ quote: "Up 85% in a month" }, "finance");
    const blocked = approvalBlockers({ consentGiven: true, disclosure: null, flags, acknowledged: false }, "finance");
    expect(blocked[0]).toMatch(/specific gain/);
    expect(approvalBlockers({ consentGiven: true, disclosure: null, flags, acknowledged: true }, "finance")).toEqual([]);
    expect(approvalBlockers({ consentGiven: false, disclosure: "x", flags: [], acknowledged: true }, "general")[0]).toMatch(/consent/);
  });
  it("reads stored flags defensively", () => {
    expect(asFlags([{ code: "a", label: "A", matches: ["x", 3] }, null, "junk"])).toEqual([{ code: "a", label: "A", matches: ["x"] }]);
    expect(asFlags(null)).toEqual([]);
  });
});

describe("consent", () => {
  it("public form stores the exact wording only when ticked", () => {
    const text = defaultConsentText("Example Gazette");
    const at = new Date("2026-11-17T12:00:00Z");
    expect(publicConsent(false, text, at)).toBeNull();
    expect(publicConsent(true, text, at)).toEqual({ consentGiven: true, consentText: text, consentAt: at, consentMethod: "public-form" });
  });
  it("staff attestation records how permission was obtained", () => {
    const at = new Date();
    expect(staffConsent(false, "", at).consentGiven).toBe(false);
    expect(staffConsent(true, "Replied yes by email", at).consentText).toMatch(/How: Replied yes by email$/);
  });
});

describe("filters, views and export", () => {
  it("round-trips filters and drops junk", () => {
    const f = parseFilters({ status: "approved", pub: "11111111-1111-1111-1111-111111111111", channel: "bogus", q: "  edge ", flagged: "1", page: "3", evil: "x" });
    expect(f).toMatchObject({ status: "approved", channel: null, q: "edge", flagged: true, page: 3 });
    expect(filtersToQuery(f)).toBe("status=approved&pub=11111111-1111-1111-1111-111111111111&q=edge&flagged=1&page=3");
    expect(cleanViewQuery("?status=pending&page=4&evil=1&tag=Renewal")).toBe("status=pending&tag=renewal");
  });
  it("escapes CSV cells and neutralizes formulas; contact only when asked", () => {
    expect(csvCell('He said "wow", twice')).toBe('"He said ""wow"", twice"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    const row: CsvRow = { id: "1", status: "approved", displayName: "M.T.", location: null, quote: "Q", body: null, resultClaimed: null, givenOn: null, channel: "email", rating: 5, tags: ["a", "b"], publication: "TDE", editor: null, videoUrl: null, disclosure: null, reviewReason: null, reviewedAt: null, consent: "public-form", contactEmail: "m@x.com", createdAt: "2026-11-17" };
    expect(testimonialsCsv([row], { includeContact: false })).not.toContain("m@x.com");
    expect(testimonialsCsv([row], { includeContact: true })).toContain("m@x.com");
    expect(testimonialsCsv([row], { includeContact: false }).split("\r\n")[1]).toContain("a; b");
  });
  it("Brain note carries the words and disclosure but no contact details", () => {
    const note = testimonialNote({ id: "1", displayName: "Mark T.", location: "Ohio", quote: "Worth it", body: null, resultClaimed: "Paid for itself", givenOn: "2026-10-01", channel: "email", tags: [], disclosure: "Results not typical.", publication: "The Daily Edge", editor: "Ada Lee" });
    expect(note.title).toBe("Testimonial: Mark T. on The Daily Edge");
    expect(note.body).toContain("Results not typical.");
    expect(note.body).not.toMatch(/@/);
  });
  it("only approved, live testimonials are publishable", () => {
    expect(isPublishable({ status: "approved", deletedAt: null })).toBe(true);
    expect(isPublishable({ status: "pending", deletedAt: null })).toBe(false);
    expect(isPublishable({ status: "approved", deletedAt: new Date() })).toBe(false);
  });
});

describe("health testimonials never claim financial gains", () => {
  it("flags money talk for health brands and blocks approval until it is edited out", async () => {
    const { complianceFlags, approvalBlockers } = await import("./testimonials");
    const flags = complianceFlags({ quote: "I sleep better and my portfolio profits paid for itself, $5,000!" }, "health");
    expect(flags.map((f) => f.code)).toContain("financial-gain");
    const blockers = approvalBlockers({ consentGiven: true, disclosure: "Results not typical.", flags, acknowledged: true }, "health");
    expect(blockers.join(" ")).toMatch(/never claim financial gains/);
    expect(complianceFlags({ quote: "I sleep through the night now." }, "health").map((f) => f.code)).not.toContain("financial-gain");
    // Finance keeps its own gain check, not the health block.
    expect(complianceFlags({ quote: "Made $5,000 in a month" }, "finance").map((f) => f.code)).not.toContain("financial-gain");
  });
});
