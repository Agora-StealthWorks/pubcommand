import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawPrisma, tenantDb } from "@pubcommand/db";
import { hashKey, mintAgentKey } from "../../../../../modules/support/keys";
import { effectiveScope, normalizeScope, type Scope } from "../../../../../modules/support/scope";
import { recordGaps } from "./gaps";
import { syncFromPubsetup } from "./pubsetup-sync";
import { saveRecord } from "./records";
import { categoryCounts, findArticles, getScopedRecord, searchKnowledge } from "./search";
import { importPages } from "./website";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";

/**
 * Support Knowledge against a real database: scope is enforced in SQL (a key never widens
 * it, a public key never reads member records, brands and organizations never mix), the
 * write path gates and keeps revisions, imports respect locks, gaps collapse.
 */
describe("Support Knowledge (database)", () => {
  const db = rawPrisma();
  const suffix = randomBytes(4).toString("hex");
  const word = `quokkaplan${suffix}`;
  const ids = { org: "", other: "", a: "", b: "", otherBrand: "" };
  const rec: Record<string, string> = {};

  const write = (brandId: string, organizationId = ids.org) => ({ organizationId, brandId, actorId: null, canPublish: true });
  const read = (scope: Scope, brandId = ids.a, organizationId = ids.org) => ({ organizationId, brandId, scope });
  const titles = async (scope: Scope, q = word, brandId = ids.a) => (await searchKnowledge(read(scope, brandId), q, { k: 20 })).map((h) => h.title).sort();

  beforeAll(async () => {
    execSync("pnpm exec prisma migrate deploy --schema prisma/schema", { cwd: new URL("../../../../../packages/db", import.meta.url).pathname, env: process.env, stdio: "ignore" });
    const plan = await db.plan.create({ data: { key: `support-${suffix}`, name: "Support test", seatLimit: 5, monthlyPriceCents: 0 } });
    const org = await db.organization.create({ data: { name: `Support ${suffix}`, slug: `support-${suffix}`, planId: plan.id, seatLimit: 5 } });
    const other = await db.organization.create({ data: { name: `Other ${suffix}`, slug: `support-o-${suffix}`, planId: plan.id, seatLimit: 5 } });
    const a = await db.brand.create({ data: { organizationId: org.id, name: "Brand A", slug: `a-${suffix}`, niche: "finance" } });
    const b = await db.brand.create({ data: { organizationId: org.id, name: "Brand B", slug: `b-${suffix}` } });
    const otherBrand = await db.brand.create({ data: { organizationId: other.id, name: "Other", slug: `o-${suffix}` } });
    Object.assign(ids, { org: org.id, other: other.id, a: a.id, b: b.id, otherBrand: otherBrand.id });

    const seeds: [string, string, string, string, string][] = [
      ["faqPublic", ids.a, "faqs", "public", "published"],
      ["faqMember", ids.a, "faqs", "member", "published"],
      ["billingPublic", ids.a, "billing", "public", "published"],
      ["faqDraft", ids.a, "faqs", "public", "draft"],
      ["faqB", ids.b, "faqs", "public", "published"],
    ];
    for (const [key, brandId, category, audience, status] of seeds) {
      const saved = await saveRecord(write(brandId), null, { category, audience, status, title: `${key} ${word}`, body: `Answer about the ${word} for ${key}.` });
      if (!saved.ok) throw new Error(saved.error);
      rec[key] = saved.id;
    }
    const otherSaved = await saveRecord(write(ids.otherBrand, ids.other), null, { category: "faqs", audience: "public", status: "published", title: `otherOrg ${word}`, body: `Other org ${word}.` });
    if (!otherSaved.ok) throw new Error(otherSaved.error);
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [ids.org, ids.other].filter(Boolean) } } });
    await db.plan.deleteMany({ where: { key: `support-${suffix}` } });
  });

  const publicFaqs: Scope = { categories: ["faqs"], audiences: ["public"] };
  const everything: Scope = { categories: ["faqs", "billing"], audiences: ["public", "member"] };

  it("a public key never reads member, draft, other-category, other-brand or other-org records", async () => {
    expect(await titles(publicFaqs)).toEqual([`faqPublic ${word}`]);
    expect(await titles(everything)).toEqual([`billingPublic ${word}`, `faqMember ${word}`, `faqPublic ${word}`]);
    expect(await titles(everything, word, ids.b)).toEqual([`faqB ${word}`]);
    expect((await searchKnowledge(read(everything, ids.a, ids.other), word)).length).toBe(0);
  });

  it("a requested category narrows in SQL and can never widen", async () => {
    expect(await titles(effectiveScope(publicFaqs, { category: "billing" }))).toEqual([]);
    expect(await titles(effectiveScope(everything, { category: "billing" }))).toEqual([`billingPublic ${word}`]);
    expect(await titles(effectiveScope(publicFaqs, { audience: "member" }))).toEqual([]);
  });

  it("get-record and category counts apply the same scope", async () => {
    expect(await getScopedRecord(read(publicFaqs), rec.faqPublic!)).not.toBeNull();
    expect(await getScopedRecord(read(publicFaqs), rec.faqMember!)).toBeNull();
    expect(await getScopedRecord(read(publicFaqs), rec.faqDraft!)).toBeNull();
    expect(await getScopedRecord(read(publicFaqs), rec.faqB!)).toBeNull();
    expect(await categoryCounts(read(publicFaqs))).toEqual([{ category: "faqs", count: 1 }]);
  });

  it("a key resolves to its stored scope, with trades only on finance brands", async () => {
    const minted = mintAgentKey();
    await tenantDb(ids.org).supportAgentProfile.create({ data: { organizationId: ids.org, brandId: ids.b, name: "Chat", categories: ["faqs", "trades"], audiences: ["public"], keyHash: minted.hash } });
    const found = await tenantDb(ids.org).supportAgentProfile.findFirst({ where: { keyHash: hashKey(minted.key) } });
    expect(found).not.toBeNull();
    expect(normalizeScope(found!, "general")).toEqual({ categories: ["faqs"], audiences: ["public"] });
    expect(await tenantDb(ids.other).supportAgentProfile.findFirst({ where: { keyHash: hashKey(minted.key) } })).toBeNull();
  });

  it("the write path blocks publishing internal material and keeps revisions", async () => {
    const blocked = await saveRecord(write(ids.a), rec.faqPublic!, { category: "faqs", audience: "public", status: "published", title: "Renewals", body: "INTERNAL ONLY: our upsell" });
    expect(blocked.ok).toBe(false);
    const draft = await saveRecord(write(ids.a), rec.faqPublic!, { category: "faqs", audience: "public", status: "draft", title: "Renewals", body: "INTERNAL ONLY: our upsell" });
    expect(draft).toMatchObject({ ok: true, status: "draft" });
    expect(await titles(publicFaqs)).toEqual([]);
    const revisions = await tenantDb(ids.org).supportRevision.count({ where: { recordId: rec.faqPublic! } });
    expect(revisions).toBe(1);
    const writer = await saveRecord({ ...write(ids.a), canPublish: false }, null, { category: "faqs", audience: "public", status: "published", title: "x", body: "y" });
    expect(writer.ok).toBe(false);
  });

  it("website import classifies fail-safe and never overwrites a locked page", async () => {
    const scope = { organizationId: ids.org, brandId: ids.a, actorId: null };
    const first = await importPages(scope, [
      { title: `Spring outlook ${word}`, url: "https://example.com/spring", date: "2026-03-01", accessLevel: "Free" },
      { title: `Member report ${word}`, url: "https://example.com/report", date: "2026-04-01", accessLevel: "" },
    ]);
    expect(first).toMatchObject({ created: 2, byAudience: { public: 1, member: 1 } });
    const again = await importPages(scope, [{ title: `Spring outlook ${word}`, url: "https://example.com/spring/", date: "2026-03-01", accessLevel: "Free" }]);
    expect(again.unchanged).toBe(1);
    const row = await tenantDb(ids.org).supportRecord.findFirst({ where: { brandId: ids.a, sourceRef: "site:https://example.com/spring" } });
    await tenantDb(ids.org).supportRecord.updateMany({ where: { id: row!.id }, data: { locked: true } });
    const locked = await importPages(scope, [{ title: "Renamed", url: "https://example.com/spring", accessLevel: "Free" }]);
    expect(locked.locked).toBe(1);
    const articles = await findArticles(read({ categories: ["website"], audiences: ["public"] }), { topic: "spring outlook" });
    expect(articles.map((a) => a.title)).toEqual([`Spring outlook ${word}`]);
    const memberOnly = await findArticles(read({ categories: ["website"], audiences: ["public"] }), { topic: "member report" });
    expect(memberOnly).toEqual([]);
  });

  it("Publication Setup sync is public-safe, keeps prices as drafts and is idempotent", async () => {
    await tenantDb(ids.org).calendarPublication.create({
      data: { organizationId: ids.org, brandId: ids.a, code: "TDE", name: "The Daily Edge", slug: `tde-${suffix}`, description: "A daily note.", positioning: "SECRET POSITIONING", offers: [{ label: "Annual", price: "$49", term: "per year" }] },
    });
    const first = await syncFromPubsetup(ids.org, ids.a, null);
    expect(first.created).toBe(2);
    const rows = await tenantDb(ids.org).supportRecord.findMany({ where: { brandId: ids.a, source: "pubsetup" } });
    expect(rows.map((r) => `${r.category}:${r.status}`).sort()).toEqual(["pricing:draft", "products:published"]);
    expect(rows.every((r) => !r.body.includes("SECRET POSITIONING"))).toBe(true);
    const second = await syncFromPubsetup(ids.org, ids.a, null);
    expect(second).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
  });

  it("gaps collapse by question and count repeats", async () => {
    const one = await recordGaps({ organizationId: ids.org, brandId: ids.a, profileId: null, source: "manual", gaps: [{ question: "Can I pause my plan?", reason: "x" }] });
    const two = await recordGaps({ organizationId: ids.org, brandId: ids.a, profileId: null, source: "webhook", gaps: [{ question: "can I PAUSE my plan", reason: "y" }] });
    expect(one).toEqual({ added: 1, repeated: 0 });
    expect(two).toEqual({ added: 0, repeated: 1 });
    const gap = await tenantDb(ids.org).supportGap.findFirst({ where: { brandId: ids.a } });
    expect(gap?.count).toBe(2);
  });
});
