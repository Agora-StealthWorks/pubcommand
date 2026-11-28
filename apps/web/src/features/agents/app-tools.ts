import { brandProfile } from "@pubcommand/core";
import { loadSuperAdminSubject, rawPrisma, tenantDb } from "@pubcommand/db";
import { moduleRegistry } from "@pubcommand/modules";
import { visibleApps } from "@/lib/apps";
import { CONSOLE_ORG_SLUG } from "@/lib/console-workspace";
import { pickBrand, scopeFor, type AgentContext } from "./context";
import { callAgentApi, describeForm, openPage, submitForm, type BridgeAgent } from "./page-bridge";
import { ToolError, UUID, str, type Tool } from "./tool-kit";
import { newBlockId } from "../../../../../modules/funnels/blocks";

/**
 * Using the apps: list_app_pages, open_page and submit_form let an agent work in any app the way a
 * person does (funnels, forms, calendar, testimonials, research, …), through the app's own pages
 * and server actions (features/agents/page-bridge.ts). Organization agents work in their own
 * organization with their own access. Platform agents name an organization and work there with
 * full access; submitting needs "Can make admin changes".
 */

async function bridgeAgent(ctx: AgentContext, args: Record<string, unknown>, submitting: boolean): Promise<BridgeAgent & { brands: { id: string; name: string; slug: string; niche: string | null }[] }> {
  const base = { userId: ctx.agent.userId, agentId: ctx.agent.id, tokenId: ctx.tokenId, homeOrganizationId: ctx.organization.id };
  if (ctx.scope === "platform") {
    if (submitting && !ctx.allowAdminActions) throw new ToolError('This platform agent is read-only. A super admin can turn on "Can make admin changes" in the console.');
    const wanted = (str(args, "organization", 100) ?? "").trim().toLowerCase();
    if (!wanted) throw new ToolError("organization is required (slug or id).");
    const org = await rawPrisma().organization.findFirst({ where: { deletedAt: null, suspendedAt: null, NOT: { slug: CONSOLE_ORG_SLUG }, OR: [{ slug: wanted }, ...(UUID.test(wanted) ? [{ id: wanted }] : [])] }, select: { id: true, slug: true } });
    if (!org) throw new ToolError(`No active organization "${wanted}". Call list_organizations.`);
    const brands = await tenantDb(org.id).brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, slug: true, niche: true } });
    const b = str(args, "brand", 100)?.trim().toLowerCase();
    const brand = b ? brands.find((x) => x.id === b || x.slug === b || x.name.toLowerCase() === b) : brands[0];
    if (b && !brand) throw new ToolError(`No brand "${b}" there. Brands: ${brands.map((x) => x.name).join(", ")}.`);
    return { ...base, organizationId: org.id, organizationSlug: org.slug, brandId: brand?.id ?? null, fullAccess: true, brands };
  }
  if (args.organization) throw new ToolError("organization is only for platform agents. You work in your own organization.");
  const brand = args.brand ? pickBrand(ctx, args.brand) : (ctx.brands[0] ?? null);
  if (args.brand && !brand) throw new ToolError("No brand by that name you can work in. Call list_brands.");
  const brands = await tenantDb(ctx.organization.id).brand.findMany({ where: { id: { in: ctx.brands.map((x) => x.id) } }, orderBy: { name: "asc" }, select: { id: true, name: true, slug: true, niche: true } });
  return { ...base, organizationId: ctx.organization.id, organizationSlug: ctx.organization.slug, brandId: brand?.id ?? null, fullAccess: false, brands };
}


/** The funnel's own brand (an organization agent must have access to it). */
async function funnelAgent(ctx: AgentContext, args: Record<string, unknown>, submitting: boolean): Promise<{ agent: BridgeAgent; funnelId: string }> {
  const agent = await bridgeAgent(ctx, { ...args, brand: undefined }, submitting);
  const funnelId = (str(args, "funnel", 40) ?? "").trim().toLowerCase();
  if (!UUID.test(funnelId)) throw new ToolError("funnel must be the funnel's id (from /funnels or its page address).");
  const row = await tenantDb(agent.organizationId).funnel.findFirst({ where: { id: funnelId, deletedAt: null }, select: { brandId: true } });
  if (!row || (!agent.fullAccess && !ctx.brands.some((b) => b.id === row.brandId))) throw new ToolError("No funnel with that id you can work on.");
  return { agent: { ...agent, brandId: row.brandId }, funnelId };
}

const PARTS = ["design", "home", "offer"] as const;

const where = {
  organization: { type: "string", description: "Platform agents only: the organization (slug or id)." },
  brand: { type: "string", description: "Brand id, slug or name to work in (default: the first)." },
};

export const APP_TOOLS: Tool[] = [
  {
    name: "list_app_pages",
    title: "List the apps",
    description: "The apps you can use in the organization (funnels, forms, calendar, websites, research…) and their pages. Open one with open_page.",
    inputSchema: { type: "object", properties: { ...where }, additionalProperties: false },
    readOnly: true,
    available: () => true,
    run: async (ctx, args) => {
      const agent = await bridgeAgent(ctx, args, false);
      const subject = ctx.scope === "platform" ? await loadSuperAdminSubject(agent.organizationId, ctx.agent.userId, moduleRegistry.permissionModules()) : ctx.subject;
      if (!subject) throw new ToolError("That organization is not available.");
      const brand = agent.brands.find((b) => b.id === agent.brandId) ?? null;
      const scope = ctx.scope === "platform" ? { organizationId: agent.organizationId, brandId: agent.brandId } : scopeFor(ctx, agent.brandId);
      const apps = visibleApps(subject, scope, brandProfile({ name: brand?.name ?? "", niche: brand?.niche }).niche);
      return {
        data: {
          brand: brand?.name ?? null,
          apps: apps.map((app) => ({ app: app.name, page: app.href, pages: app.subnav.map((item) => ({ name: item.label, page: item.href })) })),
          also: [{ name: "Settings (brands, users, publications)", page: "/settings" }],
          how: "open_page shows a page's text, links and forms; submit_form fills in and sends one of its forms, exactly as a person would.",
        },
      };
    },
  },
  {
    name: "open_page",
    title: "Open an app page",
    description:
      "Open any page of PubCommand's apps as you (e.g. /funnels, /forms, /calendar, /funnels/<id>): returns the page's text, its links (other pages to open), and every form on it with its fields (names, labels, current values, choices) and buttons. Then use submit_form to act.",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "The page, starting with /, e.g. /funnels." }, ...where }, required: ["path"], additionalProperties: false },
    readOnly: true,
    available: () => true,
    run: async (ctx, args) => {
      const agent = await bridgeAgent(ctx, args, false);
      const page = await openPage(agent, str(args, "path", 500) ?? "");
      return {
        data: { path: page.path, title: page.title, ...(page.message.notice || page.message.error ? { message: page.message } : {}), text: page.text, links: page.links, forms: page.forms.map(describeForm) },
        targetType: "page",
        targetId: page.path.slice(0, 200),
      };
    },
  },
  {
    name: "submit_form",
    title: "Submit a form on a page",
    description:
      'Fill in and send a form on a page, as a person would (it runs the app\'s own action, with your permissions). Name the form by its index or title/button from open_page; give only the fields to change (others keep their current values; fields a page fills in with JavaScript, such as an editor\'s hidden bodyHtml or an intent like publish, can be sent too); checkboxes take true/false; choose a button by label when a form has several (e.g. "Publish"). files sets file fields from public https image addresses. Returns the app\'s message (e.g. "Saved.") and the page you land on.',
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The page the form is on." },
        form: { description: "Form index (number) or its title / button label (text).", anyOf: [{ type: "integer" }, { type: "string" }] },
        fields: { type: "object", description: "Field name → value." },
        button: { type: "string", description: "Which button to press, by label." },
        files: { type: "object", description: "File field name → public https image address." },
        ...where,
      },
      required: ["path", "form"],
      additionalProperties: false,
    },
    readOnly: false,
    available: () => true,
    run: async (ctx, args) => {
      const agent = await bridgeAgent(ctx, args, true);
      const form = typeof args.form === "number" ? args.form : typeof args.form === "string" ? args.form : 0;
      const fields = args.fields && typeof args.fields === "object" && !Array.isArray(args.fields) ? (args.fields as Record<string, unknown>) : {};
      const files = args.files && typeof args.files === "object" && !Array.isArray(args.files) ? Object.fromEntries(Object.entries(args.files as Record<string, unknown>).map(([k, v]) => [k, String(v)])) : undefined;
      const result = await submitForm(agent, str(args, "path", 500) ?? "", { form, fields, button: str(args, "button", 100), files });
      if (result.result === "error") throw new ToolError(`The app said: ${result.message}`);
      return { data: result, targetType: "page", targetId: result.now_at.slice(0, 200) };
    },
  },
  {
    name: "get_funnel_editor",
    title: "Read a funnel's Design, Home page and Offer section",
    description:
      "The funnel builder's Design tab (header, page, content box, tiles, footer, fonts, logo, legal links, Forms theme), Home page blocks and Offer section blocks as JSON, plus the choices they can use (forms, SMS forms, module and page targets, themes) and every block type with its fields. Change what you need and send it back with save_funnel_editor.",
    inputSchema: { type: "object", properties: { funnel: { type: "string", description: "The funnel id." }, organization: where.organization }, required: ["funnel"], additionalProperties: false },
    readOnly: true,
    available: () => true,
    run: async (ctx, args) => {
      const { agent, funnelId } = await funnelAgent(ctx, args, false);
      return { data: await callAgentApi(agent, `/agent-api/funnels/${funnelId}`), targetType: "funnel", targetId: funnelId };
    },
  },
  {
    name: "save_funnel_editor",
    title: "Save a funnel's Design, Home page or Offer section",
    description:
      'Save one part of the funnel builder, exactly as its Save button does. part "design": data is the design object from get_funnel_editor (design, logoAssetId, logoUrl, companyName, privacyUrl, termsUrl, footerHtml, formThemeId; fields left out keep their values). part "offer": data is { blocks }. part "home": data is { blocks, shell, title }. Blocks replace the whole list: send every block, in order, each with a type and its fields (new blocks need no id). Images: add them with add_funnel_image and use the id and src it returns. It goes live on the funnel\'s pages at once.',
    inputSchema: {
      type: "object",
      properties: { funnel: { type: "string", description: "The funnel id." }, part: { type: "string", enum: [...PARTS] }, data: { type: "object" }, organization: where.organization },
      required: ["funnel", "part", "data"],
      additionalProperties: false,
    },
    readOnly: false,
    available: () => true,
    run: async (ctx, args) => {
      const { agent, funnelId } = await funnelAgent(ctx, args, true);
      const part = String(args.part ?? "");
      if (!(PARTS as readonly string[]).includes(part)) throw new ToolError('part must be "design", "home" or "offer".');
      const data = args.data && typeof args.data === "object" && !Array.isArray(args.data) ? (args.data as Record<string, unknown>) : {};
      if (part !== "design" && Array.isArray(data.blocks)) data.blocks = data.blocks.map((block: unknown) => (block && typeof block === "object" && !(block as { id?: unknown }).id ? { ...block, id: newBlockId() } : block));
      await callAgentApi(agent, `/agent-api/funnels/${funnelId}`, "PUT", { part, data });
      const now = await callAgentApi(agent, `/agent-api/funnels/${funnelId}`);
      return { data: { saved: part, now: now[part] }, targetType: "funnel", targetId: funnelId };
    },
  },
  {
    name: "add_funnel_image",
    title: "Add an image to a funnel",
    description: 'Store an image from a public https address in the funnel, for its logo (kind "logo"), header or page background ("header_bg", "page_bg"), footer logo ("footer_logo") or an image block ("block", the default). Returns the id and src to put in save_funnel_editor (e.g. logoAssetId, or an image block\'s assetId and src).',
    inputSchema: {
      type: "object",
      properties: { funnel: { type: "string", description: "The funnel id." }, image_url: { type: "string" }, kind: { type: "string", enum: ["logo", "header_bg", "page_bg", "footer_logo", "block"] }, organization: where.organization },
      required: ["funnel", "image_url"],
      additionalProperties: false,
    },
    readOnly: false,
    available: () => true,
    run: async (ctx, args) => {
      const { agent, funnelId } = await funnelAgent(ctx, args, true);
      const result = await callAgentApi(agent, `/agent-api/funnels/${funnelId}`, "POST", { image_url: str(args, "image_url", 2000), kind: str(args, "kind", 20) ?? "block" });
      return { data: { id: result.id, src: result.src }, targetType: "funnel_asset", targetId: String(result.id ?? "") };
    },
  },
];
