import { tenantDb } from "@pubcommand/db";
import { teachBrain } from "@/features/brain/teach";
import { funnelBrainNote } from "../../../../../modules/funnels/stats";
import { PROGRESSIONS, type Progression } from "../../../../../modules/funnels/state";
import { formatZoned } from "../../../../../modules/funnels/time";
import { BLOCK_INFO } from "../../../../../modules/funnels/blocks";
import { funnelStats, orgTimezone } from "./data";
import { homeBlocks } from "./site-data";

/** Teach the brand Brain about a published funnel: structure and aggregates only. Soft-fails. */
export async function teachFunnel(input: { organizationId: string; funnelId: string; actorId: string | null }): Promise<void> {
  try {
    const db = tenantDb(input.organizationId);
    const funnel = await db.funnel.findFirst({ where: { id: input.funnelId, deletedAt: null } });
    if (!funnel || funnel.status !== "published" || !funnel.brainSyncEnabled) return;
    const [days, navItems, brand, timeZone] = await Promise.all([
      db.funnelDay.findMany({ where: { funnelId: funnel.id }, orderBy: { position: "asc" } }),
      db.funnelNavItem.findMany({ where: { funnelId: funnel.id, kind: "page" }, orderBy: { sort: "asc" }, select: { title: true, label: true } }),
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
      siteType: funnel.siteType === "microsite" ? "microsite" : "launch",
      homeSections: homeBlocks(funnel).map((block) => BLOCK_INFO[block.type].label),
      pages: navItems.map((item) => item.title || item.label).filter(Boolean),
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
