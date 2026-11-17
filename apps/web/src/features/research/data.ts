import { tenantDb } from "@pubcommand/db";
import { normalizeEmail } from "../../../../../modules/research/access";
import { normalizeKeyPoints, type CardType, type KeyPoint } from "../../../../../modules/research/extract";
import type { ExportProject } from "../../../../../modules/research/export";
import { sortByPosition } from "../../../../../modules/research/outline";
import type { ResearchViewer } from "./context";

/** A run stuck this long (server restarted mid-run) is shown as interrupted. */
export const STALE_RUN_MS = 10 * 60 * 1000;

export function isBusy(status: string): boolean {
  return status === "QUEUED" || status === "RUNNING";
}

export function isStale(status: string, updatedAt: Date): boolean {
  return isBusy(status) && Date.now() - updatedAt.getTime() > STALE_RUN_MS;
}

/** Names for user ids, read through memberships of this organization. */
export async function memberNames(organizationId: string, userIds: string[]): Promise<Map<string, string>> {
  if (!userIds.length) return new Map();
  const rows = await tenantDb(organizationId).membership.findMany({
    where: { userId: { in: [...new Set(userIds)] } },
    select: { userId: true, user: { select: { name: true, email: true } } },
  });
  return new Map(rows.map((row) => [row.userId, row.user.name || row.user.email]));
}

export async function memberEmails(organizationId: string): Promise<string[]> {
  const rows = await tenantDb(organizationId).membership.findMany({
    where: { status: "ACTIVE" },
    select: { user: { select: { email: true } } },
  });
  return rows.map((row) => row.user.email).sort();
}

/** Projects in the current brand that this viewer may open: their own, shared with them, or all for admins. */
export async function listProjects(viewer: ResearchViewer, q = "") {
  const visibility = viewer.isAdmin ? {} : { OR: [{ ownerId: viewer.userId }, { shares: { some: { email: normalizeEmail(viewer.email) } } }] };
  const search = q.trim() ? { OR: [{ name: { contains: q.trim(), mode: "insensitive" as const } }, { description: { contains: q.trim(), mode: "insensitive" as const } }] } : {};
  const rows = await tenantDb(viewer.organizationId).researchProject.findMany({
    where: { AND: [{ brandId: viewer.brandId, deletedAt: null }, visibility, search] },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      name: true,
      description: true,
      ownerId: true,
      updatedAt: true,
      shareWithBrain: true,
      publicEnabled: true,
      _count: { select: { cards: true, sources: true, shares: true } },
    },
  });
  const names = await memberNames(viewer.organizationId, rows.map((row) => row.ownerId));
  return rows.map((row) => ({ ...row, ownerName: row.ownerId === viewer.userId ? "You" : (names.get(row.ownerId) ?? "Former member") }));
}

export type CardView = {
  id: string;
  sourceId: string | null;
  topic: string;
  summary: string;
  details: string;
  cardType: CardType;
  keyPoints: KeyPoint[];
  sourceLabel: string;
  sourceUrl: string | null;
  groupName: string | null;
  tags: string[];
  origin: string;
};

export type OutlineView = {
  id: string;
  title: string;
  bullets: { id: string; text: string; cardIds: string[] }[];
}[];

/** Everything the project page shows. Source text and file bytes stay in the database. */
export async function loadProjectContents(organizationId: string, projectId: string) {
  const db = tenantDb(organizationId);
  const [sources, cards, sections, bullets, links] = await Promise.all([
    db.researchSource.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: { id: true, kind: true, inputType: true, title: true, sourceRef: true, summary: true, status: true, error: true, cardCount: true, createdAt: true, updatedAt: true },
    }),
    db.researchCard.findMany({ where: { projectId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    db.researchSection.findMany({ where: { projectId }, select: { id: true, title: true, position: true } }),
    db.researchBullet.findMany({ where: { projectId }, select: { id: true, sectionId: true, text: true, position: true } }),
    db.researchBulletCard.findMany({ where: { projectId }, select: { id: true, bulletId: true, cardId: true, position: true } }),
  ]);
  const cardViews: CardView[] = cards.map((card) => ({
    id: card.id,
    sourceId: card.sourceId,
    topic: card.topic,
    summary: card.summary,
    details: card.details,
    cardType: card.cardType as CardType,
    keyPoints: normalizeKeyPoints(card.keyPoints),
    sourceLabel: card.sourceLabel,
    sourceUrl: card.sourceUrl,
    groupName: card.groupName,
    tags: card.tags,
    origin: card.origin,
  }));
  const outline: OutlineView = sortByPosition(sections).map((section) => ({
    id: section.id,
    title: section.title,
    bullets: sortByPosition(bullets.filter((bullet) => bullet.sectionId === section.id)).map((bullet) => ({
      id: bullet.id,
      text: bullet.text,
      cardIds: sortByPosition(links.filter((link) => link.bulletId === bullet.id)).map((link) => link.cardId),
    })),
  }));
  return { sources, cards: cardViews, outline };
}

export function exportModel(input: {
  name: string;
  description: string;
  brandName: string;
  cards: CardView[];
  outline: OutlineView;
  includeUnplaced: boolean;
}): ExportProject {
  return {
    name: input.name,
    description: input.description,
    brandName: input.brandName,
    includeUnplaced: input.includeUnplaced,
    sections: input.outline.map((section) => ({ title: section.title, bullets: section.bullets.map((bullet) => ({ text: bullet.text, cardIds: bullet.cardIds })) })),
    cards: input.cards.map((card) => ({ id: card.id, topic: card.topic, summary: card.summary, keyPoints: card.keyPoints, sourceLabel: card.sourceLabel, sourceUrl: card.sourceUrl })),
  };
}

/** Public read-only page: the project behind an enabled token, with its brand name. */
export async function projectByPublicToken(organizationId: string, token: string) {
  const project = await tenantDb(organizationId).researchProject.findFirst({
    where: { publicToken: token, publicEnabled: true, deletedAt: null },
    select: { id: true, name: true, description: true, brandId: true },
  });
  if (!project) return null;
  const brand = await tenantDb(organizationId).brand.findFirst({ where: { id: project.brandId }, select: { name: true } });
  return { project, brandName: brand?.name ?? "" };
}
