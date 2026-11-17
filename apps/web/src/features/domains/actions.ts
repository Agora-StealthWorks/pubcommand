"use server";

import { appendOrgAudit, appendPlatformAudit, tenantDb, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { rootDomain } from "@/lib/auth";
import { currentRequest } from "@/lib/request";
import { normalizeHostname } from "../../../../../modules/settings/domains/hostname";
import { formatPrice } from "../../../../../modules/settings/domains/records";
import { STATUS_LABELS } from "../../../../../modules/settings/domains/status";
import { domainsAccess, providersFromEnv, purchaseLedger } from "./access";
import { cloudflareFromEnv } from "./cloudflare";
import { cloudflareAccountPays, purchaseDomain } from "./purchase";
import { changeTarget, checkDomain, connectDomain, removeDomain } from "./service";
import { labelForPath, listDomainTargets } from "./targets";

const HOME = "/settings/domains";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function back(path: string, params: Record<string, string>): never {
  redirect(`${path}?${new URLSearchParams(params).toString()}`);
}

async function domainsContext() {
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/");
  const access = await domainsAccess(request.site.slug);
  if (access.kind === "missing") redirect("/");
  if (access.kind === "denied") back(HOME, { error: "You do not have permission to manage domains." });
  return access.ctx;
}

type Ctx = Awaited<ReturnType<typeof domainsContext>>;

function text(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

async function audit(ctx: Ctx, action: string, targetId: string | null, metadata: Record<string, string | number | boolean | null>) {
  const actorId = ctx.auth.user.id;
  const meta = { ...metadata, ...(ctx.impersonatingHere ? { impersonatedUserId: ctx.impersonatingHere.targetUserId } : {}) } as Prisma.InputJsonValue;
  await appendOrgAudit(ctx.resolved.id, { actorId, action, targetType: "custom_domain", targetId, metadata: meta });
  if (ctx.impersonatingHere) {
    await appendPlatformAudit({ actorId, action, targetType: "custom_domain", targetId, metadata: { organizationId: ctx.resolved.id, ...(meta as object) } });
  }
}

async function isPurchasedHere(organizationId: string, apex: string): Promise<boolean> {
  const bought = await tenantDb(organizationId).domainPurchase.count({ where: { domain: apex, result: "SUCCEEDED" } });
  return bought > 0;
}

export async function connectDomainAction(formData: FormData) {
  const ctx = await domainsContext();
  const raw = text(formData, "hostname", 260);
  const picked = text(formData, "target");
  const custom = text(formData, "customPath");
  const targetPath = picked === "custom" || !picked ? custom : picked;
  const wwwRedirect = formData.get("www") === "redirect";
  const host = normalizeHostname(raw, rootDomain());
  if (!host.ok) back(HOME, { error: host.reason, hostname: raw });
  const groups = await listDomainTargets(ctx.resolved.id);
  const provider = (await isPurchasedHere(ctx.resolved.id, host.apex)) ? "CLOUDFLARE_PURCHASED" : "EXTERNAL";
  const result = await connectDomain(providersFromEnv(), {
    organizationId: ctx.resolved.id,
    brandId: ctx.brand?.id ?? null,
    actorId: ctx.auth.user.id,
    hostname: host.hostname,
    targetPath,
    targetLabel: labelForPath(groups, targetPath),
    wwwRedirect,
    provider,
    rootDomain: rootDomain(),
  });
  if (!result.ok) back(HOME, { error: result.error, hostname: host.hostname });
  for (const [index, id] of result.ids.entries()) {
    await audit(ctx, "domains.connected", id, { hostname: result.hostnames[index] ?? null, targetPath, provider, redirectsToApex: index > 0 });
  }
  const notice = `${result.hostnames.join(" and ")} connected. Add the DNS records below if they are not in place yet.`;
  back(HOME, result.warning ? { notice, error: result.warning } : { notice });
}

export async function checkDomainAction(formData: FormData) {
  const ctx = await domainsContext();
  const id = text(formData, "id");
  if (!UUID.test(id)) back(HOME, { error: "Unknown domain." });
  const result = await checkDomain(providersFromEnv(), ctx.resolved.id, id);
  if (!result.ok) back(HOME, { error: result.error });
  if (result.changed) await audit(ctx, "domains.status.changed", id, { from: result.from, to: result.status });
  back(HOME, { notice: `Checked: ${STATUS_LABELS[result.status]}.` });
}

export async function removeDomainAction(formData: FormData) {
  const ctx = await domainsContext();
  const id = text(formData, "id");
  if (!UUID.test(id)) back(HOME, { error: "Unknown domain." });
  const confirm = text(formData, "confirm", 260).toLowerCase();
  const row = await tenantDb(ctx.resolved.id).customDomain.findFirst({ where: { id }, select: { hostname: true } });
  if (!row) back(HOME, { error: "That domain is not connected." });
  if (confirm !== row.hostname) back(HOME, { error: `Type ${row.hostname} to confirm removing it.` });
  const result = await removeDomain(providersFromEnv(), ctx.resolved.id, id);
  if (!result.ok) back(HOME, { error: result.error });
  await audit(ctx, "domains.removed", id, { hostnames: result.hostnames.join(", ") });
  back(HOME, { notice: `${result.hostnames.join(" and ")} removed. The domain stays registered; only the connection was removed.` });
}

export async function changeTargetAction(formData: FormData) {
  const ctx = await domainsContext();
  const id = text(formData, "id");
  if (!UUID.test(id)) back(HOME, { error: "Unknown domain." });
  const picked = text(formData, "target");
  const targetPath = picked === "custom" || !picked ? text(formData, "customPath") : picked;
  const groups = await listDomainTargets(ctx.resolved.id);
  const result = await changeTarget(ctx.resolved.id, id, targetPath, labelForPath(groups, targetPath));
  if (!result.ok) back(HOME, { error: result.error });
  await audit(ctx, "domains.target.changed", id, { hostname: result.hostname, from: result.from, to: result.to });
  back(HOME, { notice: `${result.hostname} now shows ${result.to}.` });
}

/** Buys a domain. Non-refundable: the person confirmed the exact price on the previous screen. */
export async function buyDomainAction(formData: FormData) {
  const ctx = await domainsContext();
  const domain = text(formData, "domain", 260).toLowerCase();
  const price = text(formData, "price", 20);
  const currency = text(formData, "currency", 3).toUpperCase();
  const buyPage = `${HOME}/buy`;
  const host = normalizeHostname(domain, rootDomain());
  if (!host.ok || !host.isApex || host.hostname !== domain) back(buyPage, { error: "Choose a domain to buy, like example.com." });
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(price) || !/^[A-Z]{3}$/.test(currency)) back(buyPage, { error: "The price is missing. Check the domain again.", domain });
  if (formData.get("acknowledge") !== "yes") back(buyPage, { error: "Tick the box to confirm the purchase is non-refundable.", domain });
  const cloudflare = cloudflareFromEnv();
  if (!cloudflare) back(buyPage, { error: "Cloudflare is not configured." });

  const outcome = await purchaseDomain(
    { organizationId: ctx.resolved.id, brandId: ctx.brand?.id ?? null, actorId: ctx.auth.user.id, domain, quotedPrice: price, quotedCurrency: currency },
    { registrar: cloudflare, payment: cloudflareAccountPays, ledger: purchaseLedger(ctx.resolved.id) },
  );
  const shown = formatPrice(price, currency);
  const base = { domain, price, currency, sandbox: cloudflare.sandbox, payment: cloudflareAccountPays.name };
  if (outcome.kind === "refused" || outcome.kind === "failed") {
    await audit(ctx, "domains.purchase.failed", outcome.purchaseId, { ...base, reason: outcome.reason });
    back(buyPage, { error: outcome.reason, domain });
  }
  if (outcome.kind === "pending") {
    await audit(ctx, "domains.purchase.pending", outcome.purchaseId, base);
    back(HOME, { notice: `Cloudflare is registering ${domain} (${shown}/year). It will show as bought when it finishes; then connect it.` });
  }
  await audit(ctx, "domains.purchase.succeeded", outcome.purchaseId, base);
  back(HOME, { notice: `${domain} is yours (${shown}/year). Choose the page it should show and connect it.`, hostname: domain, bought: "1" });
}

/** Kicks off a background re-check of every domain on the page (the page polls while any are settling). */
export async function recheckAllAction() {
  const ctx = await domainsContext();
  const organizationId = ctx.resolved.id;
  const providers = providersFromEnv();
  after(async () => {
    const rows = await tenantDb(organizationId).customDomain.findMany({ select: { id: true } });
    for (const row of rows) await checkDomain(providers, organizationId, row.id).catch(() => undefined);
  });
  back(HOME, { notice: "Checking every domain in the background." });
}
