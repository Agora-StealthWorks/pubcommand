import { tenantDb } from "@pubcommand/db";
import { teachBrain } from "@/features/brain/teach";
import { funnelBrainNote, postBrainNote } from "../../../../../modules/funnels/stats";
import { PROGRESSIONS, type Progression } from "../../../../../modules/funnels/state";
import { formatZoned } from "../../../../../modules/funnels/time";
import { funnelStats, orgTimezone } from "./data";

/** Teach the brand Brain about a published funnel: structure and aggregates only. Soft-fails. */
export async function teachFunnel(input: { organizationId: string; funnelId: string; actorId: string | null }): Promise<void> {
  try {
    const db = tenantDb(input.organizationId);
    const funnel = await db.funnel.findFirst({ where: { id: input.funnelId, deletedAt: null } });
    if (!funnel || funnel.status !== "published" || !funnel.brainSyncEnabled) return;
    const [days, brand, timeZone] = await Promise.all([
      db.funnelDay.findMany({ where: { funnelId: funnel.id }, orderBy: { position: "asc" } }),
      db.brand.findFirst({ where: { id: funnel.brandId }, select: { name: true } }),
      orgTimezone(input.organizationId),
    ]);
    const stats = await funnelStats(input.organizationId, funnel, days.map((day) => day.id));
    const note = funnelBrainNote({
      name: funnel.name,
      brandName: brand?.name ?? "the brand",
      mode: funnel.mode === "live" ? "live" : "evergreen",
      progression: (PROGRESSIONS as readonly string[]).includes(funnel.progression) ? (funnel.progression as Progression) : "all_open",
      startLabel: funnel.startAt ? formatZoned(funnel.startAt, timeZone, { year: true }) : null,
      days: days.map((day) => ({ position: day.position, title: day.title, topics: day.topics, isLive: day.isLive })),
      stats,
    });
    await teachBrain({
      organizationId: input.organizationId,
      brandId: funnel.brandId,
      sourceRef: `funnel:${funnel.id}`,
      title: note.title,
      body: note.body,
      folder: "Funnels",
      source: "funnels",
      actorId: input.actorId,
    });
  } catch (error) {
    console.error("[funnels] teach funnel failed", input.funnelId, error);
  }
}

/** Teach the brand Brain about a published text-letter post. Never phone numbers. Soft-fails. */
export async function teachPost(input: { organizationId: string; postId: string; actorId: string | null }): Promise<void> {
  try {
    const db = tenantDb(input.organizationId);
    const post = await db.textPost.findFirst({ where: { id: input.postId, deletedAt: null } });
    if (!post || post.status !== "published") return;
    const site = await db.textSite.findFirst({ where: { id: post.siteId, deletedAt: null } });
    if (!site || !site.brainSyncEnabled) return;
    const [optins, views, timeZone] = await Promise.all([
      db.textOptin.count({ where: { siteId: site.id } }),
      db.textView.count({ where: { postId: post.id } }),
      orgTimezone(input.organizationId),
    ]);
    const note = postBrainNote({
      siteName: site.name,
      title: post.title,
      publishLabel: formatZoned(post.publishAt, timeZone, { year: true }),
      bodyHtml: post.bodyHtml,
      actionToTake: post.actionToTake,
      siteOptins: optins,
      postViews: views,
    });
    await teachBrain({
      organizationId: input.organizationId,
      brandId: site.brandId,
      sourceRef: `tletter-post:${post.id}`,
      title: note.title,
      body: note.body,
      folder: "Text letters",
      source: "funnels",
      actorId: input.actorId,
    });
  } catch (error) {
    console.error("[funnels] teach post failed", input.postId, error);
  }
}
