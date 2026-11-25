import { agentPlatformLabel } from "@pubcommand/core";
import { rawPrisma, tenantDb } from "@pubcommand/db";
import { agentCan, pickBrand, type AgentContext } from "./context";
import { agentSettings } from "./data";
import { PLATFORM_TOOLS } from "./platform-tools";
import { PLATFORM_AUDIT_TOOLS } from "./platform-audit-tools";
import { PLATFORM_ORG_TOOLS } from "./platform-org-tools";
import { PUBLICATION_TOOLS } from "./publication-tools";
import { USAGE_TOOLS } from "./usage-tools";
import { ToolError, UUID, date, limit, oneOf, str, strings, uuid, type Tool } from "./tool-kit";
import { PostError, saveTextPostAsAgent, saveWebPostAsAgent } from "./posts";
import { siteEditors } from "../websites/data";
import { folderCounts, searchNotes } from "../brain/search";
import { getVisibleNote, notesInFolder, recentNotes } from "../brain/notes";
import { teachBrain } from "../brain/teach";

/**
 * The MCP tools an agent can call. Each checks the agent's own permissions (its role and
 * per-app access) in the brand it works in, exactly as the app checks a person's.
 */

export { ToolError };

const brandArg = { brand: { type: "string", description: "Brand id, slug or name (see list_brands). Defaults to your first brand." } };

function brandOrFail(ctx: AgentContext, args: Record<string, unknown>) {
  const brand = pickBrand(ctx, args.brand);
  if (!brand) throw new ToolError(args.brand ? "No brand by that name you can work in. Call list_brands." : "This organization has no brands yet.");
  return brand;
}

function entitled(ctx: AgentContext, moduleId: string) {
  return ctx.subject.entitledModuleIds.includes(moduleId);
}

/** The app is on and the agent can read it in at least one of its brands (else its tools are hidden). */
function readable(ctx: AgentContext, moduleId: string) {
  return entitled(ctx, moduleId) && ctx.brands.some((brand) => agentCan(ctx, `${moduleId}.read`, brand.id));
}

function need(ctx: AgentContext, moduleId: string, permission: string, brandId: string, what: string) {
  if (!entitled(ctx, moduleId)) throw new ToolError(`${what} is not turned on for this organization.`);
  if (!agentCan(ctx, `${moduleId}.read`, brandId) || !agentCan(ctx, permission, brandId)) throw new ToolError(`You do not have permission for that (${permission}). Ask an admin to change your access in AI Agents.`);
}

function brandIds(ctx: AgentContext) {
  return ctx.brands.map((brand) => brand.id);
}

// ── shared shapes ───────────────────────────────────────────────────────────

const webPostFields = {
  title: { type: "string", description: "Headline." },
  body_html: { type: "string", description: "The post body as HTML (p, h2, h3, ul, ol, li, a, strong, em, blockquote, img). It is sanitized." },
  excerpt: { type: "string", description: "Short summary for cards and search. Made from the body when left out." },
  slug: { type: "string", description: "URL slug. Made from the title when left out; kept unique." },
  publish_at: { type: "string", description: "ISO 8601 date-time. With publish=schedule, when it goes live." },
  access: { type: "string", enum: ["public", "free", "members"], description: "Who can read it. Default public." },
  content_type: { type: "string", enum: ["article", "issue", "alert", "update", "report", "guide"] },
  author_editor_id: { type: "string", description: "Byline: an editor id from list_editors." },
  author_name: { type: "string", description: "Byline text when there is no editor profile." },
  tags: { type: "array", items: { type: "string" }, description: "Tag names (created when new)." },
  categories: { type: "array", items: { type: "string" }, description: "Existing category names or slugs." },
  seo_title: { type: "string" },
  seo_description: { type: "string" },
};

function webPostInput(args: Record<string, unknown>) {
  return {
    title: str(args, "title", 300),
    bodyHtml: str(args, "body_html", 400_000),
    excerpt: str(args, "excerpt", 600),
    slug: str(args, "slug", 100),
    publishAt: date(args, "publish_at"),
    access: str(args, "access", 10),
    contentType: str(args, "content_type", 20),
    authorEditorId: args.author_editor_id === null ? null : uuid(args, "author_editor_id", false),
    authorName: str(args, "author_name", 120),
    tags: strings(args, "tags"),
    categories: strings(args, "categories"),
    seoTitle: str(args, "seo_title", 120),
    seoDescription: str(args, "seo_description", 300),
  };
}

function webPostJson(post: { id: string; siteId: string; kind: string; title: string; slug: string; status: string; publishedAt: Date | null; excerpt: string; access: string; contentType: string; authorName: string; updatedAt: Date }, body?: string) {
  return {
    id: post.id,
    site_id: post.siteId,
    kind: post.kind,
    title: post.title,
    slug: post.slug,
    status: post.status,
    published_at: post.publishedAt?.toISOString() ?? null,
    excerpt: post.excerpt,
    access: post.access,
    content_type: post.contentType,
    author_name: post.authorName,
    updated_at: post.updatedAt.toISOString(),
    ...(body !== undefined ? { body_html: body } : {}),
  };
}

function savedMessage(result: { status: string; heldForApproval: boolean }) {
  if (result.heldForApproval) return "Saved and submitted for approval. A person with publish rights approves it in AI Agents → Approvals.";
  if (result.status === "published") return "Published.";
  if (result.status === "scheduled") return "Scheduled.";
  if (result.status === "pending") return "Submitted for review.";
  return "Saved as a draft.";
}

async function postSite(ctx: AgentContext, postId: string) {
  const db = tenantDb(ctx.organization.id);
  const post = await db.webPost.findFirst({ where: { id: postId, deletedAt: null } });
  const site = post ? await db.webSite.findFirst({ where: { id: post.siteId, deletedAt: null, brandId: { in: brandIds(ctx) } } }) : null;
  if (!post || !site) throw new ToolError("No website post with that id.");
  return { post, site };
}

async function textPostSite(ctx: AgentContext, postId: string) {
  const db = tenantDb(ctx.organization.id);
  const post = await db.textPost.findFirst({ where: { id: postId, deletedAt: null } });
  const site = post ? await db.textSite.findFirst({ where: { id: post.siteId, deletedAt: null, brandId: { in: brandIds(ctx) } } }) : null;
  if (!post || !site) throw new ToolError("No Mini-Blog post with that id.");
  return { post, site };
}

function wrapPostError<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((error: unknown) => {
    if (error instanceof PostError) throw new ToolError(error.message);
    throw error;
  });
}

// ── tools ───────────────────────────────────────────────────────────────────

const ORG_TOOLS: Tool[] = [
  {
    name: "whoami",
    title: "Who am I",
    description: "Your agent identity in PubCommand: the organization, your owner, your brands, what you can do in each app, and whether your publishing goes live or waits for approval. Call this first.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    available: () => true,
    run: async (ctx) => {
      const owner = await rawPrisma().user.findUnique({ where: { id: ctx.agent.ownerUserId }, select: { name: true, email: true } });
      const { allowPublishing } = await agentSettings(ctx.organization.id);
      const brand = ctx.brands[0]?.id ?? null;
      const apps = [
        { id: "websites", name: "Websites" },
        { id: "miniblog", name: "Mini-Blog" },
      ]
        .filter((app) => entitled(ctx, app.id))
        .map((app) => ({
          app: app.name,
          read: agentCan(ctx, `${app.id}.read`, brand),
          write: agentCan(ctx, `${app.id}.write`, brand),
          publish: agentCan(ctx, `${app.id}.publish`, brand),
        }));
      return {
        data: {
          ...(ctx.scope === "platform"
            ? {
                kind: "Platform agent (PubCommand staff). You see the whole platform: Master Brain, organizations, users, audit logs, jobs, AI usage. You can read any organization's Brain (organization argument).",
                admin_changes: ctx.allowAdminActions ? "Allowed (each needs a reason and is audited): suspend/resume organizations, plans, app access, invite people, run jobs; rename organizations; add, change and remove empty brands; move Brain and Master Brain notes; delete and restore notes; create and update publications and gurus (with photos) and link them." : "Not allowed for this agent (read-only).",
              }
            : {}),
          organization: ctx.scope === "platform" ? "PubCommand platform" : ctx.organization.name,
          agent: ctx.agent.name,
          platform: agentPlatformLabel(ctx.agent.platform),
          owner: owner?.name || owner?.email || null,
          ...(ctx.scope === "organization"
            ? {
                brands: ctx.brands.map((item) => ({ id: item.id, name: item.name, slug: item.slug })),
                apps: [...apps, ...(entitled(ctx, "knowledge") ? [{ app: "Brain", read: agentCan(ctx, "knowledge.read", brand), write: agentCan(ctx, "knowledge.write", brand), publish: false }] : [])],
                publishing: allowPublishing ? "Your publishes go live (if you have publish rights)." : "Your publishes wait for a person's approval in AI Agents → Approvals.",
              }
            : {}),
        },
      };
    },
  },
  {
    name: "list_brands",
    title: "List brands",
    description: "The brands (publishing businesses) of this organization you can work in.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    available: () => true,
    run: async (ctx) => ({ data: { brands: ctx.brands.map((brand) => ({ id: brand.id, name: brand.name, slug: brand.slug })) } }),
  },

  // Websites
  {
    name: "list_websites",
    title: "List websites",
    description: "The websites of a brand (Websites app). Use a site_id from here to list or create posts.",
    inputSchema: { type: "object", properties: { ...brandArg }, additionalProperties: false },
    readOnly: true,
    available: (ctx) => readable(ctx, "websites"),
    run: async (ctx, args) => {
      const brand = brandOrFail(ctx, args);
      need(ctx, "websites", "websites.read", brand.id, "Websites");
      const sites = await tenantDb(ctx.organization.id).webSite.findMany({ where: { brandId: brand.id, deletedAt: null }, orderBy: { createdAt: "asc" } });
      return { data: { brand: brand.name, websites: sites.map((site) => ({ id: site.id, name: site.name, slug: site.slug })) } };
    },
  },
  {
    name: "list_editors",
    title: "List editors",
    description: "The brand's editor profiles, for the byline of a website post (author_editor_id).",
    inputSchema: { type: "object", properties: { ...brandArg }, additionalProperties: false },
    readOnly: true,
    available: (ctx) => readable(ctx, "websites"),
    run: async (ctx, args) => {
      const brand = brandOrFail(ctx, args);
      need(ctx, "websites", "websites.read", brand.id, "Websites");
      const editors = await siteEditors(ctx.organization.id, brand.id);
      return { data: { editors: editors.map((editor) => ({ id: editor.id, name: editor.name })) } };
    },
  },
  {
    name: "list_website_posts",
    title: "List website posts",
    description: "Posts (or pages) of one website, newest first. Filter by status.",
    inputSchema: {
      type: "object",
      properties: {
        site_id: { type: "string", description: "From list_websites." },
        status: { type: "string", enum: ["draft", "pending", "scheduled", "published"] },
        kind: { type: "string", enum: ["post", "page"], description: "Default post." },
        search: { type: "string", description: "Words in the title." },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["site_id"],
      additionalProperties: false,
    },
    readOnly: true,
    available: (ctx) => readable(ctx, "websites"),
    run: async (ctx, args) => {
      const db = tenantDb(ctx.organization.id);
      const site = await db.webSite.findFirst({ where: { id: uuid(args, "site_id"), deletedAt: null, brandId: { in: brandIds(ctx) } } });
      if (!site) throw new ToolError("No website with that id.");
      need(ctx, "websites", "websites.read", site.brandId, "Websites");
      const status = oneOf(args, "status", ["draft", "pending", "scheduled", "published"] as const);
      const search = str(args, "search", 100)?.trim();
      const posts = await db.webPost.findMany({
        where: { siteId: site.id, deletedAt: null, kind: oneOf(args, "kind", ["post", "page"] as const, "post"), ...(status ? { status } : {}), ...(search ? { title: { contains: search, mode: "insensitive" } } : {}) },
        orderBy: { updatedAt: "desc" },
        take: limit(args),
      });
      return { data: { website: site.name, posts: posts.map((post) => webPostJson(post)) } };
    },
  },
  {
    name: "get_website_post",
    title: "Get a website post",
    description: "One website post with its full body.",
    inputSchema: { type: "object", properties: { post_id: { type: "string" } }, required: ["post_id"], additionalProperties: false },
    readOnly: true,
    available: (ctx) => readable(ctx, "websites"),
    run: async (ctx, args) => {
      const { post, site } = await postSite(ctx, uuid(args, "post_id")!);
      need(ctx, "websites", "websites.read", site.brandId, "Websites");
      return { data: webPostJson(post, post.bodyHtml), targetType: "web_post", targetId: post.id };
    },
  },
  {
    name: "create_website_post",
    title: "Create a website post",
    description:
      "Write a new post (or page) on a website. publish: draft (default), publish (live now), or schedule (at publish_at). If the organization requires approval for AI agents, publish and schedule are held as pending until a person approves.",
    inputSchema: {
      type: "object",
      properties: {
        site_id: { type: "string", description: "From list_websites." },
        kind: { type: "string", enum: ["post", "page"], description: "Default post." },
        publish: { type: "string", enum: ["draft", "publish", "schedule"], description: "Default draft." },
        ...webPostFields,
      },
      required: ["site_id", "title", "body_html"],
      additionalProperties: false,
    },
    readOnly: false,
    available: (ctx) => readable(ctx, "websites"),
    run: async (ctx, args) => {
      const site = await tenantDb(ctx.organization.id).webSite.findFirst({ where: { id: uuid(args, "site_id"), deletedAt: null, brandId: { in: brandIds(ctx) } } });
      if (!site) throw new ToolError("No website with that id.");
      need(ctx, "websites", "websites.write", site.brandId, "Websites");
      const result = await wrapPostError(
        saveWebPostAsAgent({
          organizationId: ctx.organization.id,
          brandId: site.brandId,
          actorId: ctx.agent.userId,
          canPublish: agentCan(ctx, "websites.publish", site.brandId),
          post: { siteId: site.id, kind: oneOf(args, "kind", ["post", "page"] as const, "post"), intent: oneOf(args, "publish", ["draft", "publish", "schedule"] as const, "draft")!, ...webPostInput(args) },
        }),
      );
      return { data: { id: result.id, status: result.status, slug: result.slug, message: savedMessage(result) }, targetType: "web_post", targetId: result.id };
    },
  },
  {
    name: "update_website_post",
    title: "Update a website post",
    description: "Change a website post. Send only the fields to change. publish: keep (default), draft (unpublish), publish, or schedule.",
    inputSchema: {
      type: "object",
      properties: { post_id: { type: "string" }, publish: { type: "string", enum: ["keep", "draft", "publish", "schedule"] }, ...webPostFields },
      required: ["post_id"],
      additionalProperties: false,
    },
    readOnly: false,
    available: (ctx) => readable(ctx, "websites"),
    run: async (ctx, args) => {
      const { post, site } = await postSite(ctx, uuid(args, "post_id")!);
      need(ctx, "websites", "websites.write", site.brandId, "Websites");
      const publish = oneOf(args, "publish", ["keep", "draft", "publish", "schedule"] as const, "keep")!;
      const result = await wrapPostError(
        saveWebPostAsAgent({
          organizationId: ctx.organization.id,
          brandId: site.brandId,
          actorId: ctx.agent.userId,
          canPublish: agentCan(ctx, "websites.publish", site.brandId),
          post: { postId: post.id, siteId: site.id, intent: publish === "keep" ? "save" : publish, ...webPostInput(args) },
        }),
      );
      return { data: { id: result.id, status: result.status, slug: result.slug, message: savedMessage(result) }, targetType: "web_post", targetId: result.id };
    },
  },

  // Mini-Blog
  {
    name: "list_miniblogs",
    title: "List Mini-Blogs",
    description: "The Mini-Blogs (short text-alert blogs) of a brand.",
    inputSchema: { type: "object", properties: { ...brandArg }, additionalProperties: false },
    readOnly: true,
    available: (ctx) => readable(ctx, "miniblog"),
    run: async (ctx, args) => {
      const brand = brandOrFail(ctx, args);
      need(ctx, "miniblog", "miniblog.read", brand.id, "Mini-Blog");
      const sites = await tenantDb(ctx.organization.id).textSite.findMany({ where: { brandId: brand.id, deletedAt: null }, orderBy: { createdAt: "asc" } });
      return { data: { brand: brand.name, miniblogs: sites.map((site) => ({ id: site.id, name: site.name, slug: site.slug, status: site.status })) } };
    },
  },
  {
    name: "list_miniblog_posts",
    title: "List Mini-Blog posts",
    description: "Posts of one Mini-Blog, newest first.",
    inputSchema: {
      type: "object",
      properties: { site_id: { type: "string", description: "From list_miniblogs." }, status: { type: "string", enum: ["draft", "pending", "published"] }, limit: { type: "integer", minimum: 1, maximum: 100 } },
      required: ["site_id"],
      additionalProperties: false,
    },
    readOnly: true,
    available: (ctx) => readable(ctx, "miniblog"),
    run: async (ctx, args) => {
      const db = tenantDb(ctx.organization.id);
      const site = await db.textSite.findFirst({ where: { id: uuid(args, "site_id"), deletedAt: null, brandId: { in: brandIds(ctx) } } });
      if (!site) throw new ToolError("No Mini-Blog with that id.");
      need(ctx, "miniblog", "miniblog.read", site.brandId, "Mini-Blog");
      const status = oneOf(args, "status", ["draft", "pending", "published"] as const);
      const posts = await db.textPost.findMany({ where: { siteId: site.id, deletedAt: null, ...(status ? { status } : {}) }, orderBy: { publishAt: "desc" }, take: limit(args) });
      return {
        data: {
          miniblog: site.name,
          posts: posts.map((post) => ({ id: post.id, title: post.title, slug: post.slug, status: post.status, publish_at: post.publishAt.toISOString() })),
        },
      };
    },
  },
  {
    name: "get_miniblog_post",
    title: "Get a Mini-Blog post",
    description: "One Mini-Blog post with its body.",
    inputSchema: { type: "object", properties: { post_id: { type: "string" } }, required: ["post_id"], additionalProperties: false },
    readOnly: true,
    available: (ctx) => readable(ctx, "miniblog"),
    run: async (ctx, args) => {
      const { post, site } = await textPostSite(ctx, uuid(args, "post_id")!);
      need(ctx, "miniblog", "miniblog.read", site.brandId, "Mini-Blog");
      return {
        data: {
          id: post.id,
          site_id: post.siteId,
          title: post.title,
          slug: post.slug,
          status: post.status,
          publish_at: post.publishAt.toISOString(),
          body_html: post.bodyHtml,
          action_to_take: post.actionToTake,
          button_text: post.buttonText,
          button_url: post.buttonUrl,
        },
        targetType: "text_post",
        targetId: post.id,
      };
    },
  },
  ...(["create", "update"] as const).map(
    (mode): Tool => ({
      name: `${mode}_miniblog_post`,
      title: mode === "create" ? "Create a Mini-Blog post" : "Update a Mini-Blog post",
      description:
        mode === "create"
          ? "Write a new Mini-Blog post. publish: draft (default) or publish (live at publish_at, default now). Held as pending when the organization requires approval for AI agents."
          : "Change a Mini-Blog post. Send only the fields to change. publish: keep (default), draft (unpublish) or publish.",
      inputSchema: {
        type: "object",
        properties: {
          ...(mode === "create" ? { site_id: { type: "string", description: "From list_miniblogs." } } : { post_id: { type: "string" } }),
          publish: { type: "string", enum: mode === "create" ? ["draft", "publish"] : ["keep", "draft", "publish"] },
          title: { type: "string" },
          body_html: { type: "string", description: "Short HTML body (p, a, strong, em, ul, li)." },
          slug: { type: "string" },
          publish_at: { type: "string", description: "ISO 8601 date-time. A future time schedules it." },
          action_to_take: { type: "string", description: "The 'Action to take' box." },
          button_text: { type: "string" },
          button_url: { type: "string", description: "https link for the button." },
        },
        required: mode === "create" ? ["site_id", "title", "body_html"] : ["post_id"],
        additionalProperties: false,
      },
      readOnly: false,
      available: (ctx) => readable(ctx, "miniblog"),
      run: async (ctx, args) => {
        let siteId: string;
        let brandId: string;
        let postId: string | undefined;
        if (mode === "create") {
          const site = await tenantDb(ctx.organization.id).textSite.findFirst({ where: { id: uuid(args, "site_id"), deletedAt: null, brandId: { in: brandIds(ctx) } } });
          if (!site) throw new ToolError("No Mini-Blog with that id.");
          siteId = site.id;
          brandId = site.brandId;
        } else {
          const { post, site } = await textPostSite(ctx, uuid(args, "post_id")!);
          siteId = site.id;
          brandId = site.brandId;
          postId = post.id;
        }
        need(ctx, "miniblog", "miniblog.write", brandId, "Mini-Blog");
        const publish = oneOf(args, "publish", ["keep", "draft", "publish"] as const, mode === "create" ? "draft" : "keep")!;
        const canPublish = agentCan(ctx, "miniblog.publish", brandId);
        const result = await wrapPostError(
          saveTextPostAsAgent({
            organizationId: ctx.organization.id,
            orgSlug: ctx.organization.slug,
            host: ctx.host,
            brandId,
            actorId: ctx.agent.userId,
            canPublish,
            editorialEntitled: entitled(ctx, "editorial"),
            post: {
              postId,
              siteId,
              intent: publish === "keep" ? "save" : publish,
              title: str(args, "title", 200),
              bodyHtml: str(args, "body_html", 100_000),
              slug: str(args, "slug", 80),
              publishAt: date(args, "publish_at"),
              actionToTake: str(args, "action_to_take", 1000),
              buttonText: str(args, "button_text", 60),
              buttonUrl: str(args, "button_url", 1000),
            },
          }),
        );
        return { data: { id: result.id, status: result.status, slug: result.slug, message: savedMessage(result) }, targetType: "text_post", targetId: result.id };
      },
    }),
  ),
];


// ── Brain (the organization's knowledge) ────────────────────────────────────

type BrainTarget = { organizationId: string; organizationName: string; brandId: string; brandName: string; own: boolean };

/**
 * Which Brain a tool reads: a brand of the agent's organization (it needs knowledge.read there).
 * Platform agents may also name another organization (slug or id) to read its brands' Brains.
 */
async function brainTarget(ctx: AgentContext, args: Record<string, unknown>): Promise<BrainTarget> {
  const wantedOrg = str(args, "organization", 100)?.trim();
  if (wantedOrg && ctx.scope === "platform") {
    const org = await rawPrisma().organization.findFirst({
      where: { deletedAt: null, OR: [{ slug: wantedOrg.toLowerCase() }, ...(UUID.test(wantedOrg) ? [{ id: wantedOrg.toLowerCase() }] : [])] },
      select: { id: true, name: true },
    });
    if (!org) throw new ToolError("No organization with that slug or id. Call list_organizations.");
    const brands = await tenantDb(org.id).brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, slug: true } });
    const wanted = str(args, "brand", 100)?.trim().toLowerCase();
    const brand = wanted ? brands.find((item) => item.id === wanted || item.slug === wanted || item.name.toLowerCase() === wanted) : brands[0];
    if (!brand) throw new ToolError(wanted ? `No brand "${wanted}" in ${org.name}. Brands: ${brands.map((item) => item.name).join(", ") || "none"}.` : `${org.name} has no brands.`);
    return { organizationId: org.id, organizationName: org.name, brandId: brand.id, brandName: brand.name, own: false };
  }
  if (wantedOrg) throw new ToolError("organization is only for platform agents. You work in your own organization.");
  const brand = brandOrFail(ctx, args);
  if (!entitled(ctx, "knowledge")) throw new ToolError("The Brain is not turned on for this organization.");
  if (!agentCan(ctx, "knowledge.read", brand.id)) throw new ToolError("You do not have permission for that (knowledge.read). Ask an admin to change your access in AI Agents.");
  return { organizationId: ctx.organization.id, organizationName: ctx.organization.name, brandId: brand.id, brandName: brand.name, own: true };
}

const orgArg = { organization: { type: "string", description: "Platform agents only: another organization's slug or id, to read its Brain." } };

function noteRow(note: { id: string; title: string; folder: string | null; source: string; visibility: string; updatedAt: Date }) {
  return { id: note.id, title: note.title, folder: note.folder, source: note.source, shared: note.visibility === "SHARED", updated_at: note.updatedAt.toISOString() };
}

const BRAIN_TOOLS: Tool[] = [
  {
    name: "search_brain",
    title: "Search the Brain",
    description:
      "Full-text search of the organization's Brain (its knowledge base: research, promos, lessons, notes) for one brand: that brand's notes plus other brands' shared notes. Returns titles and snippets; read a note in full with read_brain_note.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Words to look for." }, ...brandArg, folder: { type: "string", description: "Only this folder." }, limit: { type: "integer", minimum: 1, maximum: 50 }, ...orgArg },
      required: ["query"],
      additionalProperties: false,
    },
    readOnly: true,
    available: (ctx) => ctx.scope === "platform" || readable(ctx, "knowledge"),
    run: async (ctx, args) => {
      const target = await brainTarget(ctx, args);
      const query = str(args, "query", 300)?.trim();
      if (!query) throw new ToolError("query is required.");
      const folder = str(args, "folder", 200)?.trim() || null;
      const max = Math.min(limit(args, 15), 50);
      const scope = { kind: "brand" as const, brandId: target.brandId };
      let hits = await searchNotes({ organizationId: target.organizationId, scope, query, mode: "all", limit: max, folder });
      if (hits.length < Math.min(3, max)) {
        const seen = new Set(hits.map((hit) => hit.id));
        const more = await searchNotes({ organizationId: target.organizationId, scope, query, mode: "any", limit: max, folder });
        hits = [...hits, ...more.filter((hit) => !seen.has(hit.id))].slice(0, max);
      }
      return {
        data: {
          brain: `${target.organizationName} · ${target.brandName}`,
          results: hits.map((hit) => ({ ...noteRow(hit), snippet: hit.snippet.replace(/[«»]/g, "") })),
        },
      };
    },
  },
  {
    name: "read_brain_note",
    title: "Read a Brain note",
    description: "One Brain note in full (Markdown body).",
    inputSchema: { type: "object", properties: { note_id: { type: "string" }, ...brandArg, ...orgArg }, required: ["note_id"], additionalProperties: false },
    readOnly: true,
    available: (ctx) => ctx.scope === "platform" || readable(ctx, "knowledge"),
    run: async (ctx, args) => {
      const target = await brainTarget(ctx, args);
      const note = await getVisibleNote(target.organizationId, { kind: "brand", brandId: target.brandId }, uuid(args, "note_id")!);
      if (!note) throw new ToolError("No note with that id in this Brain.");
      return { data: { ...noteRow(note), body: note.body }, targetType: "knowledge_page", targetId: note.id };
    },
  },
  {
    name: "list_brain_notes",
    title: "List Brain notes",
    description: "The newest notes of a brand's Brain, or the notes of one folder, plus the folder list with counts.",
    inputSchema: { type: "object", properties: { ...brandArg, folder: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 }, ...orgArg }, additionalProperties: false },
    readOnly: true,
    available: (ctx) => ctx.scope === "platform" || readable(ctx, "knowledge"),
    run: async (ctx, args) => {
      const target = await brainTarget(ctx, args);
      const scope = { kind: "brand" as const, brandId: target.brandId };
      const folder = str(args, "folder", 200)?.trim();
      const [notes, folders] = await Promise.all([
        folder ? notesInFolder(target.organizationId, scope, folder, limit(args, 50)) : recentNotes(target.organizationId, scope, limit(args, 20)),
        folderCounts(target.organizationId, scope),
      ]);
      return {
        data: {
          brain: `${target.organizationName} · ${target.brandName}`,
          folders: folders.sort((a, b) => b.count - a.count).map((row) => ({ folder: row.folder ?? "Top level", notes: row.count })),
          notes: notes.map(noteRow),
        },
      };
    },
  },
  {
    name: "save_brain_note",
    title: "Save a Brain note",
    description:
      "Add a note to a brand's Brain (private to that brand), or update a note you added before (note_id from this tool). Use it to record research, findings and lessons for the team. Needs Brain write access.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string", description: "Markdown." },
        folder: { type: "string", description: "e.g. Research/Gold" },
        note_id: { type: "string", description: "To update a note you saved earlier." },
        ...brandArg,
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
    readOnly: false,
    available: (ctx) => ctx.scope === "organization" && readable(ctx, "knowledge"),
    run: async (ctx, args) => {
      const target = await brainTarget(ctx, { ...args, organization: undefined });
      if (!agentCan(ctx, "knowledge.write", target.brandId)) throw new ToolError("You do not have permission for that (knowledge.write). Ask an admin to change your access in AI Agents.");
      const title = str(args, "title", 200)?.replace(/\s+/g, " ").trim();
      const body = str(args, "body", 200_000)?.trim();
      if (!title || !body) throw new ToolError("title and body are required.");
      const folder = str(args, "folder", 200)?.trim() || undefined;
      const db = tenantDb(target.organizationId);
      const prefix = `agent:${ctx.agent.id}:`;
      let sourceRef = `${prefix}${crypto.randomUUID()}`;
      const noteId = uuid(args, "note_id", false);
      if (noteId) {
        const existing = await db.knowledgePage.findFirst({ where: { id: noteId, brandId: target.brandId, deletedAt: null } });
        if (!existing || !existing.sourceRef?.startsWith(prefix)) throw new ToolError("You can only update notes you saved. Save a new note instead.");
        sourceRef = existing.sourceRef;
      }
      await teachBrain({ organizationId: target.organizationId, brandId: target.brandId, sourceRef, title, body, folder, source: "ai-agent", actorId: ctx.agent.userId });
      const saved = await db.knowledgePage.findFirst({ where: { sourceRef, deletedAt: null }, select: { id: true } });
      if (!saved) throw new ToolError("The Brain could not save that note. Try again.");
      return { data: { id: saved.id, title, brain: `${target.organizationName} · ${target.brandName}`, message: noteId ? "Note updated." : "Note saved." }, targetType: "knowledge_page", targetId: saved.id };
    },
  },
];

/** Organization content tools are for organization agents; platform agents get whoami and the Brain/platform tools. */
const forOrganizations = (tool: Tool): Tool => (tool.name === "whoami" ? tool : { ...tool, available: (ctx) => ctx.scope === "organization" && tool.available(ctx) });

function allTools(): Tool[] {
  return [...ORG_TOOLS.map(forOrganizations), ...BRAIN_TOOLS, ...PLATFORM_TOOLS, ...USAGE_TOOLS, ...PLATFORM_AUDIT_TOOLS, ...PLATFORM_ORG_TOOLS, ...PUBLICATION_TOOLS];
}

export function toolsFor(ctx: AgentContext) {
  return allTools().filter((tool) => tool.available(ctx)).map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { title: tool.title, readOnlyHint: tool.readOnly, destructiveHint: false, openWorldHint: false },
  }));
}

export function findTool(ctx: AgentContext, name: string): Tool | null {
  return allTools().find((tool) => tool.name === name && tool.available(ctx)) ?? null;
}
