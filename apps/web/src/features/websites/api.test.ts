import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawPrisma, tenantDb } from "@pubcommand/db";
import { hashPassword } from "@pubcommand/auth";
import { GET, POST } from "@/app/api/websites/v1/[...path]/route";
import { createApiKey } from "./api";
import { createSetPasswordLink } from "./members";

/**
 * Website API (v1) contract for the separately hosted site: members log in with a password,
 * the emailed link only sets one, and publications carry their category (never internal fields).
 */

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";

const db = rawPrisma();
const suffix = randomBytes(4).toString("hex");
const ids = { plan: "", org: "", brand: "", site: "", member: "", pubPaid: "", pubFree: "", catPaid: "", catFree: "" };
let key = "";

const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });
function req(path: string, init: { method?: string; body?: unknown; session?: string | null } = {}) {
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, "content-type": "application/json" };
  if (init.session) headers["x-member-session"] = init.session;
  return new Request(`http://api.local/api/websites/v1/${path}`, { method: init.method ?? "GET", headers, ...(init.body ? { body: JSON.stringify(init.body) } : {}) });
}
const get = async (path: string, session?: string | null) => GET(req(path, { session }), ctx(path.split("?")[0]!.split("/")));
const post = async (path: string, body: unknown, session?: string | null) => POST(req(path, { method: "POST", body, session }), ctx(path.split("/")));

beforeAll(async () => {
  execSync("pnpm exec prisma migrate deploy --schema prisma/schema", { cwd: new URL("../../../../../packages/db", import.meta.url).pathname, env: process.env, stdio: "ignore" });
  const plan = await db.plan.create({ data: { key: `wsapi-${suffix}`, name: "Website API test", seatLimit: 5, monthlyPriceCents: 0 } });
  const org = await db.organization.create({ data: { name: `WsApi ${suffix}`, slug: `wsapi-${suffix}`, planId: plan.id, seatLimit: 5 } });
  const brand = await db.brand.create({ data: { organizationId: org.id, name: "Liberty Letters", slug: `lib-${suffix}`, niche: "finance" } });
  Object.assign(ids, { plan: plan.id, org: org.id, brand: brand.id });
  const t = tenantDb(org.id);
  const catFree = await t.pubCategory.create({ data: { organizationId: org.id, brandId: brand.id, name: "Free newsletters", sortOrder: 10 } });
  const catPaid = await t.pubCategory.create({ data: { organizationId: org.id, brandId: brand.id, name: "Research services", sortOrder: 20 } });
  const pubPaid = await t.calendarPublication.create({
    data: {
      organizationId: org.id,
      brandId: brand.id,
      code: "EDGE",
      slug: "edge",
      name: "The Edge",
      tier: "Back-end",
      pubType: "Premium service",
      categoryId: catPaid.id,
      retailPrice: "$1,995/yr",
      salePrice: "$995 promo",
      pricingNotes: "Never below $995",
      offers: [{ label: "Annual", price: "$1,995", term: "per year" }],
      faq: [{ question: "How often?", answer: "Weekly." }, { question: "", answer: "dropped" }],
      sortOrder: 0,
    },
  });
  const pubFree = await t.calendarPublication.create({ data: { organizationId: org.id, brandId: brand.id, code: "DAILY", slug: "daily", name: "Daily Brief", tier: "Free / lead gen", categoryId: catFree.id, sortOrder: 5 } });
  const site = await t.webSite.create({ data: { organizationId: org.id, brandId: brand.id, name: "Liberty Site", slug: `lib-${suffix}`, status: "live" } });
  const member = await t.webMember.create({ data: { organizationId: org.id, siteId: site.id, email: `reader-${suffix}@example.com`, name: "Ann" } });
  const product = await t.webProduct.create({ data: { organizationId: org.id, siteId: site.id, name: "Edge", publicationIds: [pubPaid.id], active: true } });
  await t.webEntitlement.create({ data: { organizationId: org.id, memberId: member.id, productId: product.id, status: "active", source: "manual" } });
  await t.webPost.create({
    data: { organizationId: org.id, siteId: site.id, kind: "post", title: "Locked", slug: "locked", bodyHtml: "<p>One</p><p>Two secret</p>", access: "members", publicationId: pubPaid.id, status: "published", publishedAt: new Date(Date.now() - 60_000), teaserBlocks: 1 },
  });
  await t.testimonial.create({ data: { organizationId: org.id, brandId: brand.id, publicationId: pubPaid.id, displayName: "Mark T.", quote: "Worth it.", contactEmail: "private@example.com", status: "approved" } });
  Object.assign(ids, { site: site.id, member: member.id, pubPaid: pubPaid.id, pubFree: pubFree.id, catPaid: catPaid.id, catFree: catFree.id });
  key = (await createApiKey(org.id, site.id)).key;
});

afterAll(async () => {
  if (ids.org) await db.organization.deleteMany({ where: { id: ids.org } });
  if (ids.plan) await db.plan.deleteMany({ where: { id: ids.plan } });
  await db.$disconnect();
});

describe("Website API v1: publications and categories", () => {
  it("lists publications in category order with their category, and the category list", async () => {
    const body = (await (await get("site")).json()) as { publications: Record<string, unknown>[]; categories: unknown[] };
    expect(body.categories).toEqual([
      { id: ids.catFree, name: "Free newsletters", order: 10 },
      { id: ids.catPaid, name: "Research services", order: 20 },
    ]);
    expect(body.publications.map((p) => p.code)).toEqual(["DAILY", "EDGE"]);
    const edge = body.publications[1]!;
    expect(edge.category).toEqual({ id: ids.catPaid, name: "Research services", order: 20 });
    expect(edge.free).toBe(false);
    expect(edge.pricing).toEqual({ retail: "$1,995/yr", lifetime: null, offers: [{ label: "Annual", price: "$1,995", term: "per year" }] });
    expect(edge.faq).toEqual([{ question: "How often?", answer: "Weekly." }]);
    // Internal pricing never leaves PubCommand.
    expect(JSON.stringify(body)).not.toContain("$995 promo");
    expect(JSON.stringify(body)).not.toContain("Never below");
  });

  it("serves approved testimonials without contact details", async () => {
    const body = (await (await get(`testimonials?publication=${ids.pubPaid}`)).json()) as { testimonials: Record<string, unknown>[]; total: number };
    expect(body.total).toBe(1);
    expect(body.testimonials[0]).toMatchObject({ displayName: "Mark T.", quote: "Worth it." });
    expect(JSON.stringify(body)).not.toContain("private@example.com");
  });
});

describe("Website API v1: members log in with a password", () => {
  let linkSession = "";

  it("auth/link answers the same for unknown emails", async () => {
    expect(await (await post("auth/link", { email: "nobody@example.com" })).json()).toEqual({ ok: true });
    expect(await (await post("auth/link", { email: `reader-${suffix}@example.com` })).json()).toEqual({ ok: true });
  });

  it("auth/verify opens a set-password session that reads as signed out", async () => {
    const link = await createSetPasswordLink(ids.org, ids.member, "https://site.example");
    const token = new URL(link).searchParams.get("token")!;
    const res = await post("auth/verify", { token });
    const body = (await res.json()) as { session: string; mustSetPassword: boolean; purpose: string; maxAge: number };
    expect(body).toMatchObject({ mustSetPassword: true, purpose: "set-password" });
    expect(body.maxAge).toBeLessThanOrEqual(60 * 60);
    linkSession = body.session;
    // A link works once.
    expect((await post("auth/verify", { token })).status).toBe(401);
    // Paying member, but no password yet: members-only text stays locked.
    const postBody = (await (await get("posts/locked", linkSession)).json()) as { access: { allowed: boolean }; post: { html: string } };
    expect(postBody.access.allowed).toBe(false);
    expect(postBody.post.html).not.toContain("secret");
    const me = (await (await get("me", linkSession)).json()) as { member: { mustSetPassword: boolean; hasPassword: boolean } };
    expect(me.member).toMatchObject({ mustSetPassword: true, hasPassword: false });
  });

  it("auth/set-password sets it, then auth/password logs in and unlocks content", async () => {
    expect((await post("auth/set-password", { password: "short" }, linkSession)).status).toBe(400);
    const set = (await (await post("auth/set-password", { password: "correct horse battery" }, linkSession)).json()) as { ok: boolean; maxAge: number };
    expect(set.ok).toBe(true);
    expect(set.maxAge).toBeGreaterThan(60 * 60 * 24);
    expect((await post("auth/password", { email: `reader-${suffix}@example.com`, password: "wrong password!!" })).status).toBe(401);
    const login = (await (await post("auth/password", { email: `reader-${suffix}@example.com`, password: "correct horse battery" })).json()) as { session: string };
    expect(login.session).toBeTruthy();
    const postBody = (await (await get("posts/locked", login.session)).json()) as { access: { allowed: boolean }; post: { html: string } };
    expect(postBody.access.allowed).toBe(true);
    expect(postBody.post.html).toContain("secret");
    const me = (await (await get("me", login.session)).json()) as { member: { mustSetPassword: boolean } };
    expect(me.member.mustSetPassword).toBe(false);
  });

  it("changing a password from a normal session needs the current one", async () => {
    const login = (await (await post("auth/password", { email: `reader-${suffix}@example.com`, password: "correct horse battery" })).json()) as { session: string };
    const wrong = await post("auth/set-password", { password: "another long pass", currentPassword: "nope" }, login.session);
    expect(wrong.status).toBe(400);
    const ok = await post("auth/set-password", { password: "another long pass", currentPassword: "correct horse battery" }, login.session);
    expect(ok.status).toBe(200);
  });

  it("a member's stored hash from staff still logs in (admin set password)", async () => {
    await tenantDb(ids.org).webMember.updateMany({ where: { id: ids.member }, data: { passwordHash: await hashPassword("staff chose this one") } });
    expect((await post("auth/password", { email: `reader-${suffix}@example.com`, password: "staff chose this one" })).status).toBe(200);
  });
});
