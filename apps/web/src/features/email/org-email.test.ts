import { createServer, type Server } from "node:http";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rawPrisma, tenantDb } from "@pubcommand/db";
import { sendSetPasswordLink } from "../websites/members";
import { connectResendKey, getOrgEmailStatus, removeResendKey, saveDefaultSender, saveSender, sendTestEmail } from "./org-email";

/**
 * Organization email against a local mock of Resend's HTTP API (RESEND_API_URL). No real sends.
 */

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";
process.env.AUTH_SECRET ??= "local-dev-secret-at-least-16-chars";
process.env.EMAIL_FROM = "login@pubcommand.example";

type Captured = { authorization: string; body: { from: string; to: string[]; subject: string; html: string; text?: string; reply_to?: string } };
const captured: Captured[] = [];
let server: Server;

const db = rawPrisma();
const suffix = randomBytes(4).toString("hex");
const ids = { plan: "", org: "", brand: "", pub: "", actor: "" };
const ORG_KEY = "re_orgTestKey_abcdef9876";
const PLATFORM_KEY = "re_platformTestKey_1111";

async function site() {
  return (await tenantDb(ids.org).webSite.findFirst({ where: { organizationId: ids.org } }))!;
}
async function member() {
  return (await tenantDb(ids.org).webMember.findFirst({ where: { organizationId: ids.org } }))!;
}

beforeAll(async () => {
  execSync("pnpm exec prisma migrate deploy --schema prisma/schema", { cwd: new URL("../../../../../packages/db", import.meta.url).pathname, env: process.env, stdio: "ignore" });
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      captured.push({ authorization: String(req.headers.authorization ?? ""), body: JSON.parse(raw) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `mock-${captured.length}` }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  process.env.RESEND_API_URL = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const plan = await db.plan.create({ data: { key: `email-${suffix}`, name: "Email test", seatLimit: 5, monthlyPriceCents: 0 } });
  const org = await db.organization.create({ data: { name: `Email Org ${suffix}`, slug: `email-${suffix}`, planId: plan.id, seatLimit: 5 } });
  const brand = await db.brand.create({ data: { organizationId: org.id, name: "Liberty Letters", slug: `lib-${suffix}`, niche: "finance" } });
  const actor = await db.user.create({ data: { email: `admin-${suffix}@example.com` } });
  const t = tenantDb(org.id);
  const pub = await t.calendarPublication.create({ data: { organizationId: org.id, brandId: brand.id, code: "EDGE", slug: "edge", name: "The Edge", tier: "Back-end" } });
  const webSite = await t.webSite.create({ data: { organizationId: org.id, brandId: brand.id, name: "Liberty Site", slug: `lib-${suffix}`, status: "live" } });
  await t.webMember.create({ data: { organizationId: org.id, siteId: webSite.id, email: `reader-${suffix}@example.com`, name: "Ann" } });
  Object.assign(ids, { plan: plan.id, org: org.id, brand: brand.id, pub: pub.id, actor: actor.id });
  await saveSender(org.id, actor.id, "brand", brand.id, { fromName: "Liberty Letters", fromAddress: "news@liberty.example", replyTo: "" });
  await saveSender(org.id, actor.id, "publication", pub.id, { fromName: "The Edge", fromAddress: "", replyTo: "edge@liberty.example" });
  await saveDefaultSender(org.id, actor.id, { fromName: "Acme Media", fromAddress: "hello@acme.example", replyTo: "help@acme.example" });
});

afterAll(async () => {
  server?.close();
  if (ids.org) await db.organization.deleteMany({ where: { id: ids.org } });
  if (ids.actor) await db.user.deleteMany({ where: { id: ids.actor } });
  if (ids.plan) await db.plan.deleteMany({ where: { id: ids.plan } });
  delete process.env.RESEND_API_URL;
  await db.$disconnect();
});

beforeEach(() => {
  captured.length = 0;
  delete process.env.RESEND_API_KEY;
});

describe("organization Resend key", () => {
  it("is stored encrypted and never returned in plain text", async () => {
    await expect(connectResendKey(ids.org, ids.actor, "not-a-key")).rejects.toThrow(/Resend API key/);
    await connectResendKey(ids.org, ids.actor, ORG_KEY);
    const row = await tenantDb(ids.org).orgEmailSettings.findFirst({ where: { organizationId: ids.org } });
    expect(row?.resendKeyCipher).toBeTruthy();
    expect(row?.resendKeyCipher).not.toContain(ORG_KEY);
    expect(row?.resendKeyCipher).not.toContain("9876");
    const status = await getOrgEmailStatus(ids.org);
    expect(status).toMatchObject({ connected: true, keyHint: "…9876" });
    expect(JSON.stringify(status)).not.toContain(ORG_KEY);
    const audits = await tenantDb(ids.org).auditLog.findMany({ where: { organizationId: ids.org, action: { startsWith: "email.resend" } } });
    expect(audits.map((a) => a.action)).toContain("email.resend.connected");
    expect(JSON.stringify(audits)).not.toContain(ORG_KEY);
  });

  it("sends member emails with the org key and the brand sender, branded without PubCommand", async () => {
    process.env.RESEND_API_KEY = PLATFORM_KEY;
    const result = await sendSetPasswordLink({ organizationId: ids.org, site: await site(), member: await member(), origin: "http://example.localhost:3000" });
    expect(result.status).toBe("sent");
    expect(captured).toHaveLength(1);
    expect(captured[0]!.authorization).toBe(`Bearer ${ORG_KEY}`);
    expect(captured[0]!.body.from).toBe('"Liberty Letters" <news@liberty.example>');
    expect(captured[0]!.body.reply_to).toBe("help@acme.example");
    expect(captured[0]!.body.subject).toBe("Set your password for Liberty Site");
    expect(captured[0]!.body.html).toContain("Set your password");
    expect(`${captured[0]!.body.html}${captured[0]!.body.text}`).not.toMatch(/pubcommand/i);
  });

  it("uses the publication's sender when the reader came from that publication's page", async () => {
    await sendSetPasswordLink({ organizationId: ids.org, site: await site(), member: await member(), origin: "http://example.localhost:3000", returnTo: "/research/edge" });
    expect(captured[0]!.body.from).toBe('"The Edge" <news@liberty.example>');
    expect(captured[0]!.body.reply_to).toBe("edge@liberty.example");
  });

  it("sends a test email through the org key only", async () => {
    const result = await sendTestEmail({ organizationId: ids.org, organizationName: "Email Org", actorId: ids.actor, to: "admin@example.com" });
    expect(result.status).toBe("sent");
    expect(captured[0]!.authorization).toBe(`Bearer ${ORG_KEY}`);
    expect(captured[0]!.body.to).toEqual(["admin@example.com"]);
  });

  it("falls back to PubCommand's key and address, with the brand's name, when the org has no key", async () => {
    await removeResendKey(ids.org, ids.actor);
    expect((await getOrgEmailStatus(ids.org)).connected).toBe(false);
    process.env.RESEND_API_KEY = PLATFORM_KEY;
    await sendSetPasswordLink({ organizationId: ids.org, site: await site(), member: await member(), origin: "http://example.localhost:3000" });
    expect(captured[0]!.authorization).toBe(`Bearer ${PLATFORM_KEY}`);
    expect(captured[0]!.body.from).toBe('"Liberty Letters" <login@pubcommand.example>');
    expect(captured[0]!.body.reply_to).toBe("help@acme.example");
    const test = await sendTestEmail({ organizationId: ids.org, organizationName: "Email Org", actorId: ids.actor, to: "admin@example.com" });
    expect(test.status).toBe("failed");
  });

  it("sends nothing when neither the org nor PubCommand has a key", async () => {
    const result = await sendSetPasswordLink({ organizationId: ids.org, site: await site(), member: await member(), origin: "http://example.localhost:3000" });
    expect(result.status).toBe("logged");
    expect(captured).toHaveLength(0);
  });
});
