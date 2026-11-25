import { agentPlatformLabel } from "@pubcommand/core";
import { rawPrisma, tenantDb } from "@pubcommand/db";
import { agentCan, pickBrand, type AgentContext } from "./context";
import { agentSettings } from "./data";
import { PostError, saveTextPostAsAgent, saveWebPostAsAgent } from "./posts";
import { siteEditors } from "../websites/data";

/**
 * The MCP tools an agent can call. Each checks the agent's own permissions (its role and
 * per-app access) in the brand it works in, exactly as the app checks a person's.
 */

export class ToolError extends Error {}

type JsonSchema = Record<string, unknown>;
export type ToolResult = { data: unknown; targetType?: string; targetId?: string };
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  readOnly: boolean;
  /** Shown in tools/list only when this returns true. */
  available: (ctx: AgentContext) => boolean;
  run: (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolResult>;
};

// ── argument readers ────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(args: Record<string, unknown>, key: string, max = 300): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ToolError(`${key} must be a string.`);
  return value.slice(0, max);
}
function uuid(args: Record<string, unknown>, key: string, required = true): string | undefined {
  const value = str(args, key, 40)?.trim();
  if (!value) {
    if (required) throw new ToolError(`${key} is required.`);
    return undefined;
  }
  if (!UUID.test(value)) throw new ToolError(`${key} must be an id from a list_ tool.`);
  return value.toLowerCase();
}
function strings(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new ToolError(`${key} must be a list of strings.`);
  return (value as string[]).slice(0, 30).map((item) => item.slice(0, 60));
}
function date(args: Record<string, unknown>, key: string): Date | undefined {
  const value = str(args, key, 40);
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new ToolError(`${key} must be an ISO 8601 date-time, e.g. 2026-12-01T14:00:00Z.`);
  return parsed;
}
function limit(args: Record<string, unknown>, fallback = 20): number {
  const value = Number(args.limit ?? fallback);
  return Number.isFinite(value) ? Math.max(1, Math.min(100, Math.round(value))) : fallback;
}
function oneOf<T extends string>(args: Record<string, unknown>, key: string, allowed: readonly T[], fallback?: T): T | undefined {
  const value = str(args, key, 40);
  if (value === undefined || value === "") return fallback;
  if (!(allowed as readonly string[]).includes(value)) throw new ToolError(`${key} must be one of: ${allowed.join(", ")}.`);
  return value as T;
}

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

const TOOLS: Tool[] = [
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
          organization: ctx.organization.name,
          agent: ctx.agent.name,
          platform: agentPlatformLabel(ctx.agent.platform),
          owner: owner?.name || owner?.email || null,
          brands: ctx.brands.map((item) => ({ id: item.id, name: item.name, slug: item.slug })),
          apps,
          publishing: allowPublishing ? "Your publishes go live (if you have publish rights)." : "Your publishes wait for a person's approval in AI Agents → Approvals.",
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

export function toolsFor(ctx: AgentContext) {
  return TOOLS.filter((tool) => tool.available(ctx)).map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { title: tool.title, readOnlyHint: tool.readOnly, destructiveHint: false, openWorldHint: false },
  }));
}

export function findTool(ctx: AgentContext, name: string): Tool | null {
  return TOOLS.find((tool) => tool.name === name && tool.available(ctx)) ?? null;
}
