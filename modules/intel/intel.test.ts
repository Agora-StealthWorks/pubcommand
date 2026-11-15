import { describe, expect, it } from "vitest";
import { EXAMPLE_CALL_DATES } from "./calls";
import { manifest } from "./manifest";
import { scrapeCompetitorPage } from "./scrape";
import { loadIntelScreen, renderIntelScreen } from "./screen";
import { createIntelStore } from "./store";

const LONG_BODY = `${"Rate ".repeat(80)}UNIQUE_TAIL`;

describe("intel slice", () => {
  it("keeps the module contract", () => {
    expect(manifest.id).toBe("intel");
    expect(manifest.slug).toBe("intel");
    expect(manifest.planEntitlement).toBe("intel");
    expect(manifest.nav[0]).toMatchObject({ href: "/intel", permission: "intel.read" });
    expect(manifest.permissions.map((permission) => permission.key)).toEqual(["intel.read"]);
    expect(manifest.routes).toEqual([{ path: "/intel", title: "Intel" }]);
  });

  it("lists competitors and ingested email only for that organization", () => {
    const store = createIntelStore();
    store.addCompetitor({ organizationId: "org-a", name: "Northwind Mutual", domain: "Northwind.Example" });
    const email = store.ingestEmail({
      organizationId: "org-a",
      subject: "Q3 rate sheet",
      from: "desk@northwind.example",
      receivedAt: "2026-09-15T14:30:00.000Z",
      body: LONG_BODY,
    });

    expect(store.listCompetitors("org-a")).toEqual([
      expect.objectContaining({ organizationId: "org-a", name: "Northwind Mutual", domain: "northwind.example" }),
    ]);
    expect(store.listCompetitors("org-b")).toEqual([]);
    expect(store.listEmails("org-b")).toEqual([]);
    expect(email.subject).toBe("Q3 rate sheet");
    expect(email.from).toBe("desk@northwind.example");
    expect(email.receivedAt).toBe("2026-09-15T14:30:00.000Z");
    expect(email.organizationId).toBe("org-a");
    expect(email.bodyExcerpt.endsWith("…")).toBe(true);
    expect(email.bodyExcerpt).not.toContain("UNIQUE_TAIL");
    expect(email).not.toHaveProperty("body");
    expect(store.listEmails("org-a")).toEqual([email]);
  });

  it("rejects a blank organization and an unreadable receivedAt", () => {
    const store = createIntelStore();
    expect(() => store.addCompetitor({ organizationId: " ", name: "A", domain: "a.example" })).toThrow(/organizationId/);
    expect(() =>
      store.ingestEmail({
        organizationId: "org-a",
        subject: "Hi",
        from: "a@example.com",
        receivedAt: "not-a-date",
        body: "Hello",
      }),
    ).toThrow(/receivedAt/);
  });

  it("returns example historical calls for a date without leaving the org", () => {
    const store = createIntelStore();
    const left = store.lookupHistoricalCalls("org-a", "2026-03-12");
    const right = store.lookupHistoricalCalls("org-b", " 2026-03-12 ");

    expect(EXAMPLE_CALL_DATES).toEqual(["2026-03-12", "2026-06-04"]);
    expect(left).toEqual([
      expect.objectContaining({
        organizationId: "org-a",
        occurredOn: "2026-03-12",
        example: true,
        title: "Northwind Q1 earnings call",
      }),
    ]);
    expect(right[0]?.organizationId).toBe("org-b");
    expect(right[0]?.id).not.toBe(left[0]?.id);
    expect(store.lookupHistoricalCalls("org-a", "2026-01-01")).toEqual([]);
    expect(store.lookupHistoricalCalls("org-a", "2026-02-31")).toEqual([]);
    expect(store.lookupHistoricalCalls("org-a", "2026-03-12T00:00:00.000Z")).toEqual([]);
  });

  it("does not scrape", () => {
    const fetchImpl = globalThis.fetch;
    let called = false;
    globalThis.fetch = () => {
      called = true;
      return Promise.reject(new Error("network"));
    };
    try {
      const result = scrapeCompetitorPage({ organizationId: "org-a", url: "https://northwind.example" });
      expect(result.status).toBe("not-implemented");
      expect(result.reason).toContain("not part of this slice");
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = fetchImpl;
    }
  });

  it("seeds each organization once and escapes the light view", () => {
    const store = createIntelStore();
    store.addCompetitor({ organizationId: "org-a", name: `Northwind <Mutual>`, domain: "northwind.example" });
    const screen = loadIntelScreen({ organizationId: "org-a", callDate: "2026-06-04" }, store);
    const html = renderIntelScreen(screen);

    expect(screen.competitors).toHaveLength(1);
    expect(screen.calls).toHaveLength(1);
    expect(screen.calls[0]?.example).toBe(true);
    expect(html).toContain('data-organization="org-a"');
    expect(html).toContain("Northwind &lt;Mutual&gt;");
    expect(html).not.toContain("<Mutual>");
    expect(html).toContain("Harbor &amp; Pine");
    expect(html).toContain("Example rows only");
    expect(html).toContain('action="/intel"');

    const other = loadIntelScreen({ organizationId: "org-b" }, store);
    expect(other.competitors).toEqual([]);
    expect(renderIntelScreen(other)).not.toContain("Northwind");

    const seeded = loadIntelScreen({ organizationId: "org-seed" });
    const again = loadIntelScreen({ organizationId: "org-seed" });
    expect(seeded.competitors.map((row) => row.organizationId)).toEqual(["org-seed", "org-seed"]);
    expect(seeded.emails[0]).toMatchObject({
      organizationId: "org-seed",
      subject: "Q3 rate sheet",
      from: "desk@northwind.example",
    });
    expect(again.competitors.map((row) => row.id)).toEqual(seeded.competitors.map((row) => row.id));
  });
});
