import { execSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawPrisma, tenantDb } from "@pubcommand/db";
import { guessMapping } from "../../../../../modules/promo-studio/performance";
import { encryptSecret } from "../../../../../modules/promo-studio/sheets";
import { teachBrain } from "../brain/teach";
import { claimNextBulk, drainBulkQueue, enqueueBulk } from "./bulk-queue";
import { linkPerformanceRow, retier, runPerformanceImport, setTierOverride, undoImport } from "./insights";
import { runSheetSync } from "./sheets";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";

const db = rawPrisma();
const suffix = randomBytes(4).toString("hex");
const ids = { org: "", plan: "", brand: "" };
const promoIds: string[] = [];

beforeAll(async () => {
  execSync("pnpm exec prisma migrate deploy --schema prisma/schema", {
    cwd: new URL("../../../../../packages/db", import.meta.url).pathname,
    env: process.env,
    stdio: "ignore",
  });
  const plan = await db.plan.create({ data: { key: `copy-${suffix}`, name: "Copy test", seatLimit: 5, monthlyPriceCents: 0 } });
  const org = await db.organization.create({ data: { name: `Copy ${suffix}`, slug: `copy-${suffix}`, planId: plan.id, seatLimit: 5 } });
  const brand = await db.brand.create({ data: { organizationId: org.id, name: "Test Daily", slug: `t-${suffix}`, niche: "finance" } });
  Object.assign(ids, { org: org.id, plan: plan.id, brand: brand.id });
  for (let i = 1; i <= 25; i += 1) {
    const promo = await tenantDb(org.id).promo.create({
      data: { organizationId: org.id, brandId: brand.id, title: `Promo ${i}`, promoCode: `CODE-${i}`, promoType: "Front-end", analysisStatus: "DONE" },
    });
    promoIds.push(promo.id);
  }
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: ids.org } });
  await db.plan.deleteMany({ where: { id: ids.plan } });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("durable bulk queue", () => {
  it("keeps queued promos in the database and never runs more than two at once, even from two servers", async () => {
    const added = await enqueueBulk({ organizationId: ids.org, brandId: ids.brand, promoIds: promoIds.slice(0, 6), actorId: null });
    expect(added).toHaveLength(6);
    // Already-waiting promos are not queued twice.
    expect(await enqueueBulk({ organizationId: ids.org, brandId: ids.brand, promoIds: promoIds.slice(0, 2), actorId: null })).toEqual([]);
    expect(await tenantDb(ids.org).promoBulkJob.count({ where: { status: "QUEUED" } })).toBe(6);

    let running = 0;
    let peak = 0;
    const seen: string[] = [];
    const run = async (job: { promoId: string }) => {
      running += 1;
      peak = Math.max(peak, running);
      await sleep(40);
      running -= 1;
      seen.push(job.promoId);
      return job.promoId === promoIds[3] ? { ok: false, error: "boom" } : { ok: true };
    };
    // Two "servers" draining at the same time with two workers each.
    const [a, b] = await Promise.all([drainBulkQueue({ run, limit: 2 }), drainBulkQueue({ run, limit: 2 })]);
    expect(peak).toBeLessThanOrEqual(2);
    expect(a.ran + b.ran).toBe(6);
    expect(new Set(seen).size).toBe(6);
    const rows = await tenantDb(ids.org).promoBulkJob.findMany({ where: { promoId: { in: promoIds.slice(0, 6) } } });
    expect(rows.filter((r) => r.status === "DONE")).toHaveLength(5);
    expect(rows.find((r) => r.promoId === promoIds[3])).toMatchObject({ status: "FAILED", error: "boom" });
  });

  it("picks up after a restart: a stale run is requeued and claimed again", async () => {
    await enqueueBulk({ organizationId: ids.org, brandId: ids.brand, promoIds: [promoIds[10]!], actorId: null });
    const first = await claimNextBulk(new Date());
    expect(first?.promoId).toBe(promoIds[10]);
    // The server "dies": nothing finishes the row. Twenty-one minutes later another server looks.
    const later = new Date(Date.now() + 21 * 60_000);
    const again = await claimNextBulk(later);
    expect(again).toMatchObject({ id: first!.id, attempts: 2 });
    const row = await tenantDb(ids.org).promoBulkJob.findFirst({ where: { id: first!.id } });
    expect(row?.status).toBe("RUNNING");
    // After the attempt limit it is failed instead of retried forever.
    await claimNextBulk(new Date(Date.now() + 42 * 60_000));
    const third = await tenantDb(ids.org).promoBulkJob.findFirst({ where: { id: first!.id } });
    expect(third?.attempts).toBe(3);
    expect(await claimNextBulk(new Date(Date.now() + 63 * 60_000))).toBeNull();
    expect((await tenantDb(ids.org).promoBulkJob.findFirst({ where: { id: first!.id } }))?.status).toBe("FAILED");
    expect((await tenantDb(ids.org).promo.findFirst({ where: { id: promoIds[10] } }))?.analysisStatus).toBe("FAILED");
  });
});

async function importCsv(csv: string): Promise<string> {
  const data = new Uint8Array(Buffer.from(csv, "utf8"));
  const headers = csv.split(/\r?\n/)[0]!.split(",");
  const upload = await tenantDb(ids.org).promoPerformanceImport.create({
    data: { organizationId: ids.org, brandId: ids.brand, filename: "results.csv", mimeType: "text/csv", size: data.length, data, headers, status: "IMPORTING" },
  });
  await runPerformanceImport({ organizationId: ids.org, brandId: ids.brand, importId: upload.id, mapping: guessMapping(headers) });
  return upload.id;
}

const rowsCsv = (orders: (code: number) => number, codes: number[]) => ["Promo Code,Orders,Revenue", ...codes.map((n) => `CODE-${n},${orders(n)},${orders(n) * 100}`)].join("\n");

describe("performance: undo import, tier overrides, hand links", () => {
  let first = "";
  let second = "";

  it("imports, then a second import replaces some numbers and adds codes", async () => {
    first = await importCsv(rowsCsv((n) => n * 10, Array.from({ length: 20 }, (_, i) => i + 1)));
    const one = await tenantDb(ids.org).promoPerformanceImport.findFirst({ where: { id: first } });
    expect(one).toMatchObject({ status: "DONE", codeCount: 20 });
    expect(one?.createdCodes).toHaveLength(20);
    second = await importCsv(rowsCsv((n) => n * 1000, [1, 2, 21, 22]));
    const two = await tenantDb(ids.org).promoPerformanceImport.findFirst({ where: { id: second } });
    expect(two?.createdCodes.sort()).toEqual(["CODE21", "CODE22"]);
    expect(Array.isArray(two?.previous) && (two!.previous as unknown[]).length).toBe(2);
    const code1 = await tenantDb(ids.org).promoPerformance.findFirst({ where: { brandId: ids.brand, codeKey: "CODE1" } });
    expect(code1?.orders).toBe(1000);
  });

  it("undoing the second import removes its new codes, restores the old numbers and recomputes tiers", async () => {
    const result = await undoImport({ organizationId: ids.org, brandId: ids.brand, importId: second, actorId: null });
    expect(result).toEqual({ removed: 2, restored: 2, kept: 0 });
    const perf = tenantDb(ids.org).promoPerformance;
    expect(await perf.count({ where: { brandId: ids.brand } })).toBe(20);
    const code1 = await perf.findFirst({ where: { brandId: ids.brand, codeKey: "CODE1" } });
    expect(code1).toMatchObject({ orders: 10, importId: first, tier: "bottom10" });
    expect(await perf.findFirst({ where: { brandId: ids.brand, codeKey: "CODE21" } })).toBeNull();
    expect((await tenantDb(ids.org).promoPerformanceImport.findFirst({ where: { id: second } }))?.status).toBe("UNDONE");
    expect(await undoImport({ organizationId: ids.org, brandId: ids.brand, importId: second, actorId: null })).toEqual({ error: "That import was already undone." });
  });

  it("keeps a person's tier override, with its reason, through every re-tier, and can clear it", async () => {
    const row = await tenantDb(ids.org).promoPerformance.findFirst({ where: { brandId: ids.brand, codeKey: "CODE1" } });
    const changed = await setTierOverride({ organizationId: ids.org, brandId: ids.brand, performanceId: row!.id, tier: "top10", reason: "List was a tiny test segment", actorId: null });
    expect(changed).toMatchObject({ from: "bottom10", to: "top10", computed: "bottom10" });
    await retier(ids.org, ids.brand);
    const after = await tenantDb(ids.org).promoPerformance.findFirst({ where: { id: row!.id } });
    expect(after).toMatchObject({ tier: "top10", computedTier: "bottom10", tierOverride: "top10", tierOverrideReason: "List was a tiny test segment" });
    await setTierOverride({ organizationId: ids.org, brandId: ids.brand, performanceId: row!.id, tier: null, reason: null, actorId: null });
    await retier(ids.org, ids.brand);
    expect((await tenantDb(ids.org).promoPerformance.findFirst({ where: { id: row!.id } }))?.tier).toBe("bottom10");
  });

  it("links an unmatched row to a promo by hand and keeps the link through re-matching", async () => {
    await importCsv("Promo Code,Orders\nNOMATCH-9,55");
    const row = await tenantDb(ids.org).promoPerformance.findFirst({ where: { brandId: ids.brand, codeKey: "NOMATCH9" } });
    expect(row?.promoId).toBeNull();
    await linkPerformanceRow({ organizationId: ids.org, brandId: ids.brand, performanceId: row!.id, target: promoIds[24]! });
    await retier(ids.org, ids.brand);
    expect(await tenantDb(ids.org).promoPerformance.findFirst({ where: { id: row!.id } })).toMatchObject({ promoId: promoIds[24], linkedManually: true });
    // "Keep unlinked" survives re-matching even when the code would match.
    const coded = await tenantDb(ids.org).promoPerformance.findFirst({ where: { brandId: ids.brand, codeKey: "CODE2" } });
    await linkPerformanceRow({ organizationId: ids.org, brandId: ids.brand, performanceId: coded!.id, target: "none" });
    await retier(ids.org, ids.brand);
    expect((await tenantDb(ids.org).promoPerformance.findFirst({ where: { id: coded!.id } }))?.promoId).toBeNull();
    await linkPerformanceRow({ organizationId: ids.org, brandId: ids.brand, performanceId: coded!.id, target: "auto" });
    expect((await tenantDb(ids.org).promoPerformance.findFirst({ where: { id: coded!.id } }))?.promoId).toBe(promoIds[1]);
  });
});

describe("promo Brain notes", () => {
  it("re-teaching the same promo refreshes its one note instead of adding another", async () => {
    const ref = `promo:${promoIds[0]}`;
    await teachBrain({ organizationId: ids.org, brandId: ids.brand, sourceRef: ref, title: "Promo review: Promo 1", body: "first", folder: "Promo reviews", source: "promo-analyzer", actorId: null });
    await teachBrain({ organizationId: ids.org, brandId: ids.brand, sourceRef: ref, title: "Promo review: Promo 1", body: "second", folder: "Promo reviews", source: "promo-analyzer", actorId: null });
    const notes = await tenantDb(ids.org).knowledgePage.findMany({ where: { sourceRef: ref } });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toContain("second");
  });
});

describe("Google Sheets sync", () => {
  it("imports the sheet with the saved key, skips an unchanged sheet, and the sync can be undone", async () => {
    process.env.AUTH_SECRET ??= "local-dev-secret-at-least-16-chars";
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const key = JSON.stringify({ type: "service_account", client_email: "sync@demo.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() });
    await tenantDb(ids.org).promoSheetSync.create({
      data: {
        organizationId: ids.org,
        brandId: ids.brand,
        spreadsheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz012345",
        range: "Results",
        credentials: encryptSecret(key, process.env.AUTH_SECRET!),
        clientEmail: "sync@demo.iam.gserviceaccount.com",
        mapping: { code: "Creative Code", orders: "Orders" },
        enabled: true,
      },
    });
    const calls: string[] = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      calls.push(href);
      if (href.startsWith("https://oauth2.googleapis.com/token")) {
        expect(String(init?.body)).toContain("assertion=");
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      expect(href).toContain("/spreadsheets/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/values/Results");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tok");
      // Columns moved around since the mapping was saved: it is remembered by header name.
      return new Response(JSON.stringify({ values: [["Orders", "Creative Code"], ["77", "SHEET-1"], ["5", "SHEET-2"]] }), { status: 200 });
    }) as typeof fetch;
    const first = await runSheetSync({ organizationId: ids.org, brandId: ids.brand, actorId: null, fetcher });
    expect(first.status).toBe("imported");
    expect(await tenantDb(ids.org).promoPerformance.findFirst({ where: { brandId: ids.brand, codeKey: "SHEET1" } })).toMatchObject({ orders: 77 });
    expect(calls.some((c) => c.includes("oauth2"))).toBe(true);
    expect((await runSheetSync({ organizationId: ids.org, brandId: ids.brand, actorId: null, fetcher })).status).toBe("unchanged");
    const undone = await undoImport({ organizationId: ids.org, brandId: ids.brand, importId: first.importId!, actorId: null });
    expect(undone).toMatchObject({ removed: 2 });
    const failing = (async () => new Response(JSON.stringify({ error: { message: "denied" } }), { status: 403 })) as typeof fetch;
    const failed = await runSheetSync({ organizationId: ids.org, brandId: ids.brand, actorId: null, fetcher: failing, force: true });
    expect(failed).toMatchObject({ status: "failed", error: expect.stringContaining("Share the sheet") });
    expect((await tenantDb(ids.org).promoSheetSync.findFirst({ where: { brandId: ids.brand } }))?.status).toBe("FAILED");
  });
});
