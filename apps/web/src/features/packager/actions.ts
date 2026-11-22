"use server";

import { brandProfile, can } from "@pubcommand/core";
import { appendOrgAudit, tenantDb, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { getOrgContext, requestOrgSlug } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import { PACKAGE_COMPONENTS, checkClaims, clampQuantity, componentSpec, parseDirection } from "../../../../../modules/promo-studio/packager";
import { isUuid, loadPackage } from "./data";
import { parseFindings } from "../../../../../modules/promo-studio/timely";
import { allowedText, latestAnalysis, reopenIfApproved, runPackageGeneration, runPackageResearch, saveVersion, teachApprovedPackage, type GenerationRequest } from "./server";
import { learnFromComponent } from "./training";

type Permission = "promo.write" | "promo.approve";

function field(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

const enc = encodeURIComponent;

async function packagerContext(permission: Permission, back: string) {
  const request = await currentRequest();
  const orgSlug = requestOrgSlug(request);
  if (!orgSlug) redirect("/");
  const ctx = await getOrgContext(orgSlug);
  if (ctx.kind !== "ok") redirect("/");
  if (!ctx.subject.entitledModuleIds.includes("promo-studio") || !can(ctx.subject, permission, ctx.scope)) {
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=${enc("You do not have permission.")}`);
  }
  if (!ctx.brand) redirect("/promo-studio?error=Add a brand in Settings first.");
  return { ...ctx, brand: ctx.brand };
}

type Ctx = Awaited<ReturnType<typeof packagerContext>>;

const packagePath = (promoId: string, packageId: string) => `/promo-studio/${promoId}/package/${packageId}`;

/** The form's ids, validated, plus the package they point at (scoped to the current brand). */
async function target(formData: FormData, permission: Permission) {
  const promoId = field(formData, "promoId", 40);
  const packageId = field(formData, "packageId", 40);
  if (!isUuid(promoId) || !isUuid(packageId)) redirect("/promo-studio?error=That package no longer exists.");
  const back = packagePath(promoId, packageId);
  const ctx = await packagerContext(permission, back);
  const loaded = await loadPackage(ctx.resolved.id, ctx.brand.id, promoId, packageId);
  if (!loaded) redirect(`/promo-studio/${promoId}?tab=package&error=${enc("That package no longer exists.")}`);
  return { ctx, loaded, back };
}

function startGeneration(ctx: Ctx, packageId: string, requests: GenerationRequest[]) {
  if (!requests.length) return;
  after(() =>
    runPackageGeneration({
      organizationId: ctx.resolved.id,
      packageId,
      brand: ctx.brand,
      actorId: ctx.auth.user.id,
      requests,
    }),
  );
}

export async function createPackage(formData: FormData) {
  const promoId = field(formData, "promoId", 40);
  if (!isUuid(promoId)) redirect("/promo-studio?error=That promo no longer exists.");
  const newPath = `/promo-studio/${promoId}/package/new`;
  const ctx = await packagerContext("promo.write", newPath);
  const db = tenantDb(ctx.resolved.id);
  const promo = await db.promo.findFirst({ where: { id: promoId, brandId: ctx.brand.id, deletedAt: null }, select: { id: true, title: true } });
  if (!promo) redirect("/promo-studio?error=That promo no longer exists.");

  const direction = parseDirection({
    angle: field(formData, "angle", 1000),
    tone: field(formData, "tone"),
    length: field(formData, "length", 20),
    offerDetails: field(formData, "offerDetails", 4000),
    notes: field(formData, "notes", 4000),
    event: formData.get("withEvent") === "on" ? { name: field(formData, "eventName", 200), date: field(formData, "eventDate", 100) } : null,
  });
  const chosen = PACKAGE_COMPONENTS.filter((spec) => formData.get(`c_${spec.kind}`) === "on" && (!spec.event || direction.event));
  if (formData.get("withEvent") === "on" && !direction.event) redirect(`${newPath}?error=${enc("Name the live event, or untick it.")}`);
  if (!chosen.length) redirect(`${newPath}?error=${enc("Pick at least one component.")}`);

  const title = field(formData, "title", 200) || `${promo.title} copy package`;
  const pkg = await db.promoPackage.create({
    data: {
      organizationId: ctx.resolved.id,
      brandId: ctx.brand.id,
      promoId: promo.id,
      title,
      direction,
      createdById: ctx.auth.user.id,
    },
  });
  const ids: string[] = [];
  for (const [position, spec] of chosen.entries()) {
    const component = await db.promoPackageComponent.create({
      data: {
        organizationId: ctx.resolved.id,
        packageId: pkg.id,
        kind: spec.kind,
        position,
        quantity: clampQuantity(spec, formData.get(`q_${spec.kind}`)),
        genStatus: "QUEUED",
      },
    });
    ids.push(component.id);
  }
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "package.created", targetType: "promo_package", targetId: pkg.id });
  startGeneration(ctx, pkg.id, ids.map((componentId) => ({ componentId })));
  redirect(packagePath(promo.id, pkg.id));
}

export async function updatePackage(formData: FormData) {
  const { ctx, loaded, back } = await target(formData, "promo.write");
  const direction = parseDirection({
    angle: field(formData, "angle", 1000),
    tone: field(formData, "tone"),
    length: field(formData, "length", 20),
    offerDetails: field(formData, "offerDetails", 4000),
    notes: field(formData, "notes", 4000),
    event: field(formData, "eventName", 200) ? { name: field(formData, "eventName", 200), date: field(formData, "eventDate", 100) } : null,
  });
  await tenantDb(ctx.resolved.id).promoPackage.updateMany({
    where: { id: loaded.pkg.id },
    data: { title: field(formData, "title", 200) || loaded.pkg.title, direction },
  });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "package.updated", targetType: "promo_package", targetId: loaded.pkg.id });
  redirect(`${back}?notice=${enc("Direction saved. It applies to components you write or rewrite from now on.")}`);
}

/** Add components to an existing package, or retry failed ones. */
export async function addComponents(formData: FormData) {
  const { ctx, loaded, back } = await target(formData, "promo.write");
  const db = tenantDb(ctx.resolved.id);
  const have = new Set(loaded.components.map((c) => c.kind));
  const added: string[] = [];
  let position = loaded.components.length;
  for (const spec of PACKAGE_COMPONENTS) {
    if (have.has(spec.kind) || formData.get(`c_${spec.kind}`) !== "on") continue;
    if (spec.event && !loaded.pkg.direction.event) continue;
    const component = await db.promoPackageComponent.create({
      data: { organizationId: ctx.resolved.id, packageId: loaded.pkg.id, kind: spec.kind, position: position++, quantity: clampQuantity(spec, formData.get(`q_${spec.kind}`)), genStatus: "QUEUED" },
    });
    added.push(component.id);
  }
  if (!added.length) redirect(`${back}?error=${enc("Pick a component to add.")}`);
  await reopenIfApproved(db, loaded.pkg.id);
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "package.components.added", targetType: "promo_package", targetId: loaded.pkg.id });
  startGeneration(ctx, loaded.pkg.id, added.map((componentId) => ({ componentId })));
  redirect(`${back}?notice=${enc(`Writing ${added.length} more.`)}`);
}

export async function retryFailed(formData: FormData) {
  const { ctx, loaded, back } = await target(formData, "promo.write");
  const failed = loaded.components.filter((c) => c.genStatus === "FAILED" || c.genStatus === "NONE");
  if (!failed.length) redirect(back);
  await tenantDb(ctx.resolved.id).promoPackageComponent.updateMany({ where: { id: { in: failed.map((c) => c.id) } }, data: { genStatus: "QUEUED", genError: null } });
  startGeneration(ctx, loaded.pkg.id, failed.map((c) => ({ componentId: c.id })));
  redirect(back);
}

function componentOf(loaded: Awaited<ReturnType<typeof target>>["loaded"], formData: FormData) {
  return loaded.components.find((c) => c.id === field(formData, "componentId", 40)) ?? null;
}

export async function regenerateComponent(formData: FormData) {
  const { ctx, loaded, back } = await target(formData, "promo.write");
  const component = componentOf(loaded, formData);
  if (!component) redirect(`${back}?error=${enc("That component no longer exists.")}`);
  const spec = componentSpec(component.kind);
  const quantity = spec ? clampQuantity(spec, formData.get("quantity") ?? component.quantity) : component.quantity;
  await tenantDb(ctx.resolved.id).promoPackageComponent.updateMany({ where: { id: component.id }, data: { genStatus: "QUEUED", genError: null, quantity } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "package.component.regenerated", targetType: "promo_package_component", targetId: component.id });
  // Feedback present (even empty) means "rewrite the current copy"; no copy yet means a fresh write.
  startGeneration(ctx, loaded.pkg.id, [{ componentId: component.id, feedback: component.content.trim() ? field(formData, "feedback", 2000) : null }]);
  redirect(`${back}/${component.id}`);
}

async function claimsFor(ctx: Ctx, loaded: Awaited<ReturnType<typeof target>>["loaded"], content: string) {
  const profile = brandProfile(ctx.brand);
  const analysis = await latestAnalysis(tenantDb(ctx.resolved.id), loaded.promo.id);
  return checkClaims(content, { niche: profile.niche, rules: profile.complianceRules, allowedText: allowedText(loaded.promo, analysis, loaded.pkg.direction.offerDetails) });
}

const STATUSES = ["DRAFT", "NEEDS_EDITS", "APPROVED"] as const;

export async function saveComponent(formData: FormData) {
  const status = field(formData, "status", 20);
  let next = (STATUSES as readonly string[]).includes(status) ? (status as (typeof STATUSES)[number]) : "DRAFT";
  const { ctx, loaded, back } = await target(formData, "promo.write");
  const component = componentOf(loaded, formData);
  if (!component) redirect(`${back}?error=${enc("That component no longer exists.")}`);
  const here = `${back}/${component.id}`;
  if (component.genStatus === "QUEUED" || component.genStatus === "RUNNING") redirect(`${here}?error=${enc("Wait for the AI to finish before editing.")}`);
  const raw = formData.get("content");
  // A status-only form sends no content.
  const content = raw === null ? component.content : String(raw).replace(/\r\n/g, "\n").slice(0, 200000);
  const changed = content.trim() !== component.content.trim();
  if (next === "APPROVED" && !can(ctx.subject, "promo.approve", ctx.scope)) {
    if (component.status !== "APPROVED") redirect(`${here}?error=${enc("Approving needs the promo.approve permission.")}`);
    // Editing approved copy without approval rights sends it back to review.
    if (changed) next = "DRAFT";
  }
  const db = tenantDb(ctx.resolved.id);
  if (changed) {
    await saveVersion(db, {
      organizationId: ctx.resolved.id,
      componentId: component.id,
      packageId: loaded.pkg.id,
      content,
      source: "edit",
      actorId: ctx.auth.user.id,
      flags: await claimsFor(ctx, loaded, content),
      status: next,
    });
  } else if (next !== component.status) {
    await db.promoPackageComponent.updateMany({ where: { id: component.id }, data: { status: next } });
    if (next !== "APPROVED") await reopenIfApproved(db, loaded.pkg.id);
  }
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "package.component.saved", targetType: "promo_package_component", targetId: component.id });
  // Approved copy becomes a training example for future packages.
  if (next === "APPROVED") {
    await learnFromComponent({ organizationId: ctx.resolved.id, brand: ctx.brand, actorId: ctx.auth.user.id, component: { id: component.id, kind: component.kind, content }, promo: loaded.promo }).catch(() => undefined);
  }
  redirect(`${here}?notice=${enc(next === "APPROVED" ? "Saved. Approved copy joins the training library." : "Saved.")}`);
}

export async function restoreVersion(formData: FormData) {
  const { ctx, loaded, back } = await target(formData, "promo.write");
  const component = componentOf(loaded, formData);
  if (!component) redirect(`${back}?error=${enc("That component no longer exists.")}`);
  const db = tenantDb(ctx.resolved.id);
  const version = await db.promoPackageComponentVersion.findFirst({ where: { id: field(formData, "versionId", 40), componentId: component.id } });
  if (!version) redirect(`${back}/${component.id}?error=${enc("That version no longer exists.")}`);
  const n = await saveVersion(db, {
    organizationId: ctx.resolved.id,
    componentId: component.id,
    packageId: loaded.pkg.id,
    content: version.content,
    source: "restore",
    feedback: `Restored version ${version.version}`,
    actorId: ctx.auth.user.id,
    flags: await claimsFor(ctx, loaded, version.content),
    status: "DRAFT",
  });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "package.component.restored", targetType: "promo_package_component", targetId: component.id });
  redirect(`${back}/${component.id}?notice=${enc(`Version ${version.version} restored as version ${n}.`)}`);
}

export async function removeComponent(formData: FormData) {
  const { ctx, loaded, back } = await target(formData, "promo.write");
  const component = componentOf(loaded, formData);
  if (!component) redirect(back);
  await tenantDb(ctx.resolved.id).promoPackageComponent.deleteMany({ where: { id: component.id, packageId: loaded.pkg.id } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "package.component.removed", targetType: "promo_package_component", targetId: component.id });
  redirect(`${back}?notice=${enc(`${component.label} removed.`)}`);
}

export async function approvePackage(formData: FormData) {
  const { ctx, loaded, back } = await target(formData, "promo.approve");
  const pending = loaded.components.filter((c) => c.status !== "APPROVED" || !c.content.trim());
  if (!loaded.components.length || pending.length) {
    redirect(`${back}?error=${enc(`Approve every component first (${pending.length} left).`)}`);
  }
  const db = tenantDb(ctx.resolved.id);
  await db.promoPackage.updateMany({ where: { id: loaded.pkg.id }, data: { status: "APPROVED", approvedAt: new Date(), approvedById: ctx.auth.user.id } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "package.approved", targetType: "promo_package", targetId: loaded.pkg.id });
  for (const component of loaded.components) {
    await learnFromComponent({ organizationId: ctx.resolved.id, brand: ctx.brand, actorId: ctx.auth.user.id, component, promo: loaded.promo }).catch(() => undefined);
  }
  await teachApprovedPackage({
    organizationId: ctx.resolved.id,
    brandId: ctx.brand.id,
    brandName: ctx.brand.name,
    actorId: ctx.auth.user.id,
    pkg: loaded.pkg,
    promoTitle: loaded.promo.title,
    components: loaded.components,
  });
  redirect(`${back}?notice=${enc("Package approved. The brand Brain has a summary of it.")}`);
}

export async function reopenPackage(formData: FormData) {
  const { ctx, loaded, back } = await target(formData, "promo.approve");
  await reopenIfApproved(tenantDb(ctx.resolved.id), loaded.pkg.id);
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "package.reopened", targetType: "promo_package", targetId: loaded.pkg.id });
  redirect(`${back}?notice=Reopened.`);
}

export async function deletePackage(formData: FormData) {
  const { ctx, loaded } = await target(formData, "promo.write");
  await tenantDb(ctx.resolved.id).promoPackage.updateMany({ where: { id: loaded.pkg.id }, data: { deletedAt: new Date() } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "package.deleted", targetType: "promo_package", targetId: loaded.pkg.id });
  redirect(`/promo-studio/${loaded.promo.id}?tab=package&notice=${enc("Package deleted.")}`);
}

// ---------------------------------------------------------------------------
// Web research for timely hooks

export async function refreshResearch(formData: FormData) {
  const { ctx, loaded, back } = await target(formData, "promo.write");
  await tenantDb(ctx.resolved.id).promoPackage.updateMany({ where: { id: loaded.pkg.id }, data: { researchStatus: "QUEUED", researchError: null } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: "package.research.run", targetType: "promo_package", targetId: loaded.pkg.id });
  after(() => runPackageResearch({ organizationId: ctx.resolved.id, packageId: loaded.pkg.id, brand: ctx.brand, actorId: ctx.auth.user.id }));
  redirect(`${back}?notice=${enc("Searching the web for timely hooks…")}#research`);
}

/** An editor confirms (or un-confirms) a finding after opening its source. Only checked findings reach reader-facing copy. */
export async function toggleFinding(formData: FormData) {
  const { ctx, loaded, back } = await target(formData, "promo.write");
  const id = field(formData, "findingId", 10);
  const db = tenantDb(ctx.resolved.id);
  const row = await db.promoPackage.findFirst({ where: { id: loaded.pkg.id }, select: { research: true } });
  const findings = parseFindings(row?.research);
  const hit = findings.find((f) => f.id === id);
  if (!hit) redirect(`${back}#research`);
  const next = findings.map((f) => (f.id === id ? { ...f, checked: !f.checked } : f));
  await db.promoPackage.updateMany({ where: { id: loaded.pkg.id }, data: { research: next as unknown as Prisma.InputJsonValue } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.auth.user.id, action: hit.checked ? "package.research.unchecked" : "package.research.checked", targetType: "promo_package", targetId: loaded.pkg.id, metadata: { url: hit.sourceUrl } });
  redirect(`${back}#research`);
}
