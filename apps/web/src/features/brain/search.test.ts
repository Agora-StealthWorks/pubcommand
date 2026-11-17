import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawPrisma } from "@pubcommand/db";
import { BEST_PRACTICE_SOURCE, brandScope, canSeeNote, type BrainScope } from "../../../../../modules/knowledge/visibility";
import { renderNote } from "./markdown";
import { folderCounts, searchNotes } from "./search";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";

/**
 * Isolation: brand B must never see brand A's private notes through search,
 * and no organization sees another's notes at all.
 */
describe("Brain search isolation", () => {
  const db = rawPrisma();
  const suffix = randomBytes(4).toString("hex");
  const ids = { org: "", other: "", a: "", b: "", otherBrand: "" };
  const word = `zebracorn${suffix}`;

  type Seed = { org: string; brandId: string | null; title: string; visibility: "PRIVATE" | "SHARED"; deleted?: boolean; source?: string };
  const seeds: Seed[] = [];

  beforeAll(async () => {
    // Same pattern as packages/db tests: make sure the test database has this branch's tables.
    execSync("pnpm exec prisma migrate deploy --schema prisma/schema", {
      cwd: new URL("../../../../../packages/db", import.meta.url).pathname,
      env: process.env,
      stdio: "ignore",
    });
    // Own plan: borrowing another test's plan races with its clean-up when test files run in parallel.
    const plan = await db.plan.create({ data: { key: `brain-${suffix}`, name: "Brain test", seatLimit: 5, monthlyPriceCents: 0 } });
    const org = await db.organization.create({ data: { name: `Brain ${suffix}`, slug: `brain-${suffix}`, planId: plan.id, seatLimit: 5 } });
    const other = await db.organization.create({ data: { name: `Other ${suffix}`, slug: `brain-other-${suffix}`, planId: plan.id, seatLimit: 5 } });
    const a = await db.brand.create({ data: { organizationId: org.id, name: "Brand A", slug: `a-${suffix}` } });
    const b = await db.brand.create({ data: { organizationId: org.id, name: "Brand B", slug: `b-${suffix}` } });
    const otherBrand = await db.brand.create({ data: { organizationId: other.id, name: "Other brand", slug: `o-${suffix}` } });
    Object.assign(ids, { org: org.id, other: other.id, a: a.id, b: b.id, otherBrand: otherBrand.id });
    seeds.push(
      { org: org.id, brandId: a.id, title: "A private plan", visibility: "PRIVATE" },
      { org: org.id, brandId: a.id, title: "A shared practice", visibility: "SHARED" },
      { org: org.id, brandId: a.id, title: "A deleted note", visibility: "SHARED", deleted: true },
      { org: org.id, brandId: b.id, title: "B private plan", visibility: "PRIVATE" },
      { org: org.id, brandId: null, title: "Main private memo", visibility: "PRIVATE" },
      { org: org.id, brandId: null, title: "Main shared guide", visibility: "SHARED" },
      { org: org.id, brandId: a.id, title: "A best practice copy", visibility: "SHARED", source: BEST_PRACTICE_SOURCE },
      { org: other.id, brandId: otherBrand.id, title: "Other org shared", visibility: "SHARED" },
    );
    for (const [index, seed] of seeds.entries()) {
      await db.knowledgePage.create({
        data: {
          organizationId: seed.org,
          brandId: seed.brandId,
          title: seed.title,
          slug: `n${index}-${suffix}`,
          body: `Folder notes about the ${word} launch. ${seed.title}.`,
          folder: seed.brandId ? "Brand notes/Plans" : "Main",
          visibility: seed.visibility,
          source: seed.source ?? "member",
          deletedAt: seed.deleted ? new Date() : null,
        },
      });
    }
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [ids.org, ids.other].filter(Boolean) } } });
    await db.plan.deleteMany({ where: { key: `brain-${suffix}` } });
  });

  const titles = async (scope: BrainScope, query = word, mode: "all" | "any" = "all") =>
    (await searchNotes({ organizationId: ids.org, scope, query, mode })).map((hit) => hit.title).sort();

  it("brand B never sees brand A's private notes, best-practice copies, or notes without a brand", async () => {
    const seen = await titles(brandScope(ids.b));
    expect(seen).toEqual(["A shared practice", "B private plan"]);
    expect(seen).not.toContain("A private plan");
    expect(await titles(brandScope(ids.b), "A private plan")).toEqual(["B private plan"]);
    expect(await titles(brandScope(ids.b), `${word} private plan`, "any")).not.toContain("A private plan");
    expect(await titles(brandScope(ids.b), "main guide memo", "any")).toEqual([]);
  });

  it("brand A sees its own notes (incl. its best practices) and other brands' Shared notes only", async () => {
    expect(await titles(brandScope(ids.a))).toEqual(["A best practice copy", "A private plan", "A shared practice"]);
  });

  it("never returns another organization's notes", async () => {
    const otherOrg = await searchNotes({ organizationId: ids.other, scope: brandScope(ids.a), query: word });
    expect(otherOrg.map((hit) => hit.title)).toEqual(["Other org shared"]);
    const own = await searchNotes({ organizationId: ids.other, scope: brandScope(ids.otherBrand), query: word });
    expect(own.map((hit) => hit.title)).toEqual(["Other org shared"]);
  });

  it("matches the pure visibility rule exactly", async () => {
    for (const scope of [brandScope(ids.a), brandScope(ids.b)]) {
      const expected = seeds
        .filter((seed) => seed.org === ids.org && canSeeNote(scope, { brandId: seed.brandId, visibility: seed.visibility, source: seed.source, deletedAt: seed.deleted ? new Date() : null }))
        .map((seed) => seed.title)
        .sort();
      expect(await titles(scope)).toEqual(expected);
    }
  });

  it("ranks title hits first, marks snippets, and filters by folder", async () => {
    const hits = await searchNotes({ organizationId: ids.org, scope: brandScope(ids.a), query: "shared practice" });
    expect(hits[0]?.title).toBe("A shared practice");
    expect(hits[0]?.snippet).toMatch(/«/);
    const inFolder = await searchNotes({ organizationId: ids.org, scope: brandScope(ids.a), query: word, folder: "Brand notes" });
    expect(inFolder.every((hit) => hit.folder?.startsWith("Brand notes"))).toBe(true);
    expect(inFolder).toHaveLength(3);
    expect(await searchNotes({ organizationId: ids.org, scope: brandScope(ids.a), query: "   " })).toEqual([]);
  });

  it("folder counts follow the same rule", async () => {
    const counts = await folderCounts(ids.org, brandScope(ids.b));
    expect(counts.reduce((sum, row) => sum + row.count, 0)).toBe(2);
    const a = await folderCounts(ids.org, brandScope(ids.a));
    expect(a.reduce((sum, row) => sum + row.count, 0)).toBe(3);
  });
});

describe("note rendering", () => {
  it("resolves wiki links, keeps code literal and strips unsafe HTML", () => {
    const { html, properties } = renderNote(
      "---\ntags: [copy]\n---\n# Title\n\nSee [[Headlines|the headline rules]] and [[Missing note]].\n\n`[[Not a link]]`\n\n<script>alert(1)</script><img src=x onerror=alert(1)><a href=\"javascript:alert(1)\">x</a>\n\n| a | b |\n|---|---|\n| 1 | 2 |",
      (target) => (target === "Headlines" ? { href: "/knowledge/abc", title: "Headlines" } : null),
    );
    expect(properties).toEqual([["tags", "copy"]]);
    expect(html).toContain('<a class="brain-link" href="/knowledge/abc">the headline rules</a>');
    expect(html).toContain('class="brain-link-missing"');
    expect(html).toContain("<code>[[Not a link]]</code>");
    expect(html).not.toMatch(/<script|onerror|javascript:/i);
    expect(html).toContain("<table>");
  });

  it("renders attached images and files, and leaves unknown embeds as plain text", () => {
    const { html } = renderNote(
      "![[chart.png]] ![[deck.pdf]] ![[missing.png]]",
      () => null,
      (target) =>
        target === "chart.png"
          ? { kind: "image", src: "/knowledge/files/1", alt: "chart.png" }
          : target === "deck.pdf"
            ? { kind: "file", href: "/knowledge/files/2", name: "deck.pdf" }
            : null,
    );
    expect(html).toContain('<img src="/knowledge/files/1" alt="chart.png" />');
    expect(html).toContain('<a class="brain-link" href="/knowledge/files/2">deck.pdf</a>');
    expect(html).toContain('class="brain-embed"');
  });
});
