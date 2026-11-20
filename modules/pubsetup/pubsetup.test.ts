import type { AccessSubject } from "@pubcommand/core";
import { describe, expect, it } from "vitest";
import { moduleRegistry } from "../src/index";
import { canManagePublications } from "./access";
import { editorFacts, editorNote, matchPublication, publicationFacts, publicationNote, publicationPromptContext } from "./brain";
import { contrastText, resolveBranding } from "./branding";
import { BRANDING_FIELDS, EDITOR_FIELDS, PUBLICATION_FIELDS, firstError, normalizeUrl, parseFields, slugify, uniqueSlug } from "./fields";

function form(values: Record<string, string>) {
  return { getAll: (name: string) => (name in values ? [values[name]] : []) };
}

const minimal = { name: "The Daily Edge", code: "tde", status: "active", color: "#7F77DD" };

describe("publication fields", () => {
  it("accepts a minimal publication and normalizes values", () => {
    const result = parseFields(PUBLICATION_FIELDS, form(minimal));
    expect(result.ok).toBe(true);
    expect(result.values.code).toBe("TDE");
    expect(result.values.color).toBe("#7f77dd");
    expect(result.values.slug).toBe("the-daily-edge");
    expect(result.values.offers).toEqual([]);
    expect(result.values.sortOrder).toBe(0);
  });

  it("requires name, code, status and color", () => {
    const result = parseFields(PUBLICATION_FIELDS, form({}));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["code", "color", "name", "status"]);
    expect(firstError(PUBLICATION_FIELDS, result.errors)).toBe("Name: Name is required.");
  });

  it("rejects bad codes, slugs, links, dates, colors and options", () => {
    const result = parseFields(
      PUBLICATION_FIELDS,
      form({
        ...minimal,
        code: "no spaces!",
        slug: "Bad Slug",
        websiteUrl: "javascript:alert(1)",
        launchDate: "2026-02-31",
        color: "blue",
        pubType: "Hedge fund",
        "sampleIssues.0.title": "Issue 1",
        "sampleIssues.0.url": "not a link",
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["code", "color", "launchDate", "pubType", "sampleIssues", "slug", "websiteUrl"]);
  });

  it("reads list and pair rows, skipping empty rows", () => {
    const result = parseFields(
      PUBLICATION_FIELDS,
      form({
        ...minimal,
        deliverables: "- Weekly issue\nWeekly issue\n\n• Model portfolio",
        "offers.0.label": "Annual",
        "offers.0.price": "$49",
        "offers.2.label": "Lifetime",
        "sampleIssues.1.title": "Sample",
        "sampleIssues.1.url": "example.com/issue",
        websiteUrl: "example.com",
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.values.deliverables).toEqual(["Weekly issue", "Model portfolio"]);
    expect(result.values.offers).toEqual([
      { label: "Annual", price: "$49", term: "" },
      { label: "Lifetime", price: "", term: "" },
    ]);
    expect(result.values.sampleIssues).toEqual([{ title: "Sample", url: "https://example.com/issue" }]);
    expect(result.values.websiteUrl).toBe("https://example.com/");
  });

  it("validates editors and branding with the same rules", () => {
    expect(parseFields(EDITOR_FIELDS, form({ name: "Ada Lee", status: "active", email: "ADA@Example.com" })).values.email).toBe("ada@example.com");
    expect(parseFields(EDITOR_FIELDS, form({ name: "Ada", status: "retired" })).ok).toBe(false);
    expect(parseFields(BRANDING_FIELDS, form({})).ok).toBe(true);
    expect(parseFields(BRANDING_FIELDS, form({ headingFont: "Comic Sans" })).ok).toBe(false);
    expect(normalizeUrl("localhost")).toBeNull();
  });
});

describe("slugs", () => {
  it("are derived from names and made unique per brand", () => {
    expect(slugify("  Tom's Trade-Desk!  ")).toBe("tom-s-trade-desk");
    expect(uniqueSlug("war", [])).toBe("war");
    expect(uniqueSlug("war", ["war", "war-2"])).toBe("war-3");
    expect(uniqueSlug("", ["item"])).toBe("item-2");
  });
});

describe("branding inheritance", () => {
  it("uses the publication's own value, then the brand default, then the platform default", () => {
    const brand = { primaryColor: "#112233", headingFont: "Lato", tagline: "Brand line", logos: { light: false, dark: true } };
    const pub = { primaryColor: "#abcdef", tagline: " " };
    const resolved = resolveBranding(pub, brand, "Acme Media");
    expect(resolved.values.primaryColor).toBe("#abcdef");
    expect(resolved.sources.primaryColor).toBe("publication");
    expect(resolved.values.headingFont).toBe("Lato");
    expect(resolved.sources.headingFont).toBe("brand");
    expect(resolved.values.tagline).toBe("Brand line");
    expect(resolved.values.bodyFont).toBe("Arial");
    expect(resolved.sources.bodyFont).toBe("default");
    expect(resolved.logo).toBe("brand");
    expect(resolved.logos.brand).toEqual({ light: false, dark: true });
  });

  it("has no logo when neither level has one", () => {
    const resolved = resolveBranding(null, null, "Acme Media");
    expect(resolved.values.tagline).toBe("");
    expect(resolved.logo).toBeNull();
  });

  it("picks readable header text", () => {
    expect(contrastText("#ffffff")).toBe("#111827");
    expect(contrastText("#1f2a44")).toBe("#ffffff");
  });
});

describe("facts and Brain notes", () => {
  const record = {
    name: "The Daily Edge",
    code: "TDE",
    status: "active",
    pubType: "Paid newsletter",
    positioning: "Plain-English daily briefing.",
    offers: [{ label: "Annual", price: "$49", term: "per year" }],
    sortOrder: 3,
    launchDate: new Date("2024-05-01T00:00:00Z"),
    tagline: "",
  };

  it("stores only non-empty, non-internal fields", () => {
    const facts = publicationFacts({ id: "p1", brandName: "Acme", record, editors: [{ name: "Ada Lee", role: "lead" }], now: new Date("2026-01-01T00:00:00Z") });
    expect(facts).toEqual({
      version: 1,
      kind: "publication",
      ref: "pub:p1",
      brand: "Acme",
      updatedAt: "2026-01-01T00:00:00.000Z",
      fields: {
        name: "The Daily Edge",
        code: "TDE",
        status: "active",
        pubType: "Paid newsletter",
        launchDate: "2024-05-01",
        positioning: "Plain-English daily briefing.",
        offers: ["Annual · $49 · per year"],
        editors: ["Ada Lee (Lead editor)"],
      },
    });
    const note = publicationNote(facts);
    expect(note.title).toBe("The Daily Edge (TDE)");
    expect(note.body).toContain("## Positioning");
    expect(note.body).toContain("- Ada Lee (Lead editor)");
    expect(note.body).not.toContain("\n\n\n");
  });

  it("includes retail pricing as typed", () => {
    const facts = publicationFacts({ id: "p2", brandName: "Acme", record: { ...record, retailPrice: "$7,500/yr", lifetimePrice: "$25,000 one-time", salePrice: "$4,995", pricingNotes: "Renews at list." }, editors: [] });
    expect(facts.fields).toMatchObject({ retailPrice: "$7,500/yr", lifetimePrice: "$25,000 one-time", salePrice: "$4,995", pricingNotes: "Renews at list." });
    const body = publicationNote(facts).body;
    expect(body).toContain("## Pricing\n- Retail price: $7,500/yr\n- Unlimited / lifetime price: $25,000 one-time\n- Typical sale price: $4,995");
    expect(body).toContain("## Pricing notes\nRenews at list.");
  });

  it("keeps an editor's email out of the Brain", () => {
    const facts = editorFacts({ id: "e1", brandName: "Acme", record: { name: "Ada Lee", email: "ada@example.com", specialties: ["Options"] }, publications: [{ name: "The Daily Edge", code: "TDE", role: "lead" }] });
    expect(facts.fields.email).toBeUndefined();
    expect(editorNote(facts).body).toContain("The Daily Edge (TDE, Lead editor)");
  });

  it("builds a prompt block and matches promos to publications", () => {
    const text = publicationPromptContext({ name: "The Daily Edge", code: "TDE", audience: "Busy professionals", complianceNotes: "- No guarantees\nNo hype", editors: [{ name: "Ada", role: "lead", voiceNotes: "Warm" }] });
    expect(text).toContain("Its reader: Busy professionals");
    expect(text).toContain("- No guarantees\n- No hype");
    expect(text).toContain("Editor: Ada (Lead editor). Voice: Warm");
    const pubs = [
      { code: "TDE", name: "The Daily Edge", slug: "the-daily-edge" },
      { code: "EDGE", name: "Edge Pro", slug: "edge-pro" },
    ];
    expect(matchPublication("tde", pubs)?.code).toBe("TDE");
    expect(matchPublication("Edge Pro annual offer", pubs)?.code).toBe("EDGE");
    expect(matchPublication("", pubs)).toBeNull();
    expect(matchPublication("Something else", pubs)).toBeNull();
  });
});

describe("permission gating", () => {
  const permissionModules = moduleRegistry.permissionModules();
  function subject(permissions: string[], entitled = ["pubsetup", "editorial"]): AccessSubject {
    return {
      userId: "u",
      organizationId: "o",
      roleId: "r",
      membershipBrandId: null,
      membershipWorkspaceId: null,
      grants: permissions.map((permission) => ({ permission, effect: "allow" as const, brandId: null, workspaceId: null, roleId: "r" })),
      exclusions: [],
      entitledModuleIds: entitled,
      permissionModules,
    };
  }
  const scope = { organizationId: "o", brandId: "b" };

  it("lets admins in and keeps everyone else out", () => {
    expect(permissionModules["pubsetup.manage"]).toBe("pubsetup");
    expect(canManagePublications(subject(["pubsetup.manage"]), scope)).toBe(true);
    expect(canManagePublications(subject(["editorial.read", "editorial.write"]), scope)).toBe(false);
    expect(canManagePublications(subject(["pubsetup.manage"], ["editorial"]), scope)).toBe(false);
    const excluded = { ...subject(["pubsetup.manage"]), exclusions: [{ permission: "pubsetup.manage", userId: "u", roleId: null, brandId: null, workspaceId: null }] };
    expect(canManagePublications(excluded, scope)).toBe(false);
  });

  it("shows the app only to people who can manage it", () => {
    const manifest = moduleRegistry.getById("pubsetup");
    expect(manifest?.nav[0]).toEqual({ label: "Publication Setup", href: "/settings/publication-setup", permission: "pubsetup.manage" });
    expect(manifest?.permissions.map((p) => p.key)).toEqual(["pubsetup.manage"]);
  });
});
