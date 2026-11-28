import { NextResponse } from "next/server";
import { tenantDb } from "@pubcommand/db";
import { readAgentPassFromRequest } from "@/lib/auth";
import { fetchRemoteImage } from "@/features/agents/remote-image";
import { funnelDesign, loadFunnelForBrand } from "@/features/funnels/data";
import { funnelsAccess } from "@/features/funnels/guard";
import { saveDesign, saveHomePage, saveOfferSection, uploadFunnelImage } from "@/features/funnels/site-actions";
import { listSmsForms } from "@/features/funnels/sms-data";
import { BLOCK_DEFAULTS, BLOCK_INFO, BLOCK_TYPES, normalizeBlocks } from "../../../../../../../../../../modules/funnels/blocks";

/**
 * The funnel builder's Design, Home page and Offer section editors for AI agents. Those editors
 * save structured data from the browser (no HTML form), so the page bridge's submit_form cannot
 * drive them; the funnel tools (features/agents/app-tools.ts) call this instead. Only requests
 * carrying a valid agent pass reach it, and saving runs the editors' own server actions, so the
 * checks, validation, sanitizing and audit log are the same as for a person.
 */

type Params = { params: Promise<{ slug: string; funnelId: string }> };

const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });

export async function GET(_request: Request, { params }: Params) {
  if (!(await readAgentPassFromRequest())) return notFound();
  const { slug, funnelId } = await params;
  const access = await funnelsAccess(slug, "funnels.read", funnelId);
  if (access.kind !== "ok") return NextResponse.json({ error: access.kind === "denied" ? access.title : "Not found." }, { status: 403 });
  const { ctx, canWrite } = access;
  const loaded = await loadFunnelForBrand(ctx.resolved.id, ctx.brand.id, funnelId);
  if (!loaded) return notFound();
  const { funnel, days, navItems } = loaded;
  const db = tenantDb(ctx.resolved.id);
  const [themes, forms, smsForms] = await Promise.all([
    db.formTheme.findMany({ where: { brandId: ctx.brand.id, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.form.findMany({ where: { brandId: ctx.brand.id, deletedAt: null, status: "OPEN" }, orderBy: { title: "asc" }, select: { slug: true, title: true } }),
    listSmsForms(ctx.resolved.id, funnel.id),
  ]);
  return NextResponse.json({
    funnel: { id: funnel.id, name: funnel.name, slug: funnel.slug, type: funnel.siteType, status: funnel.status, can_edit: canWrite },
    design: {
      design: funnelDesign(funnel),
      logoAssetId: funnel.logoAssetId,
      logoUrl: funnel.logoUrl,
      companyName: funnel.companyName,
      privacyUrl: funnel.privacyUrl,
      termsUrl: funnel.termsUrl,
      footerHtml: funnel.footerHtml,
      formThemeId: funnel.formThemeId,
    },
    home: { blocks: normalizeBlocks(funnel.homeBlocks), shell: funnel.homeShell, title: funnel.homeTitle },
    offer: { blocks: normalizeBlocks(funnel.offerBlocks) },
    choices: {
      form_themes: themes,
      forms: forms.map((form) => ({ formSlug: form.slug, title: form.title })),
      sms_forms: smsForms.map((form) => ({ smsFormId: form.id, name: form.name })),
      module_targets: days.map((day) => ({ target: `module:${day.position}`, title: day.title })),
      page_targets: navItems.filter((item) => item.kind === "page").map((item) => ({ target: `page:${item.slug}`, title: item.title || item.label || item.slug })),
    },
    blocks: BLOCK_TYPES.map((type) => ({ type, ...BLOCK_INFO[type], fields: BLOCK_DEFAULTS[type] })),
  });
}

export async function PUT(request: Request, { params }: Params) {
  if (!(await readAgentPassFromRequest())) return notFound();
  const { funnelId } = await params;
  const body = (await request.json().catch(() => null)) as { part?: unknown; data?: unknown } | null;
  const part = body?.part;
  const result =
    part === "design" ? await saveDesign(funnelId, body?.data) : part === "home" ? await saveHomePage(funnelId, body?.data) : part === "offer" ? await saveOfferSection(funnelId, body?.data) : { ok: false as const, error: 'part must be "design", "home" or "offer".' };
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

/** Add an image from a public https address (for the logo, design backgrounds and image blocks). */
export async function POST(request: Request, { params }: Params) {
  if (!(await readAgentPassFromRequest())) return notFound();
  const { funnelId } = await params;
  const body = (await request.json().catch(() => null)) as { image_url?: unknown; kind?: unknown } | null;
  let image;
  try {
    image = await fetchRemoteImage(String(body?.image_url ?? ""), 10);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not fetch that image." }, { status: 400 });
  }
  const form = new FormData();
  form.set("funnelId", funnelId);
  form.set("kind", typeof body?.kind === "string" ? body.kind : "block");
  form.set("file", new File([image.data], image.filename, { type: image.mime }));
  const result = await uploadFunnelImage(form);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
