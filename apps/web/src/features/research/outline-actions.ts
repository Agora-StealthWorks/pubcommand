"use server";

import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { moveStep, nextPosition, outlineFromGroups, positionChanges } from "../../../../../modules/research/outline";
import { canEdit, projectFor, researchContext } from "./context";

/** One outline change, sent by the outline board. Every field is re-checked here. */
export type OutlineOp =
  | { op: "addSection"; title?: string }
  | { op: "renameSection"; sectionId: string; title: string }
  | { op: "deleteSection"; sectionId: string }
  | { op: "moveSection"; sectionId: string; direction: "up" | "down" }
  | { op: "addBullet"; sectionId: string; text?: string }
  | { op: "editBullet"; bulletId: string; text: string }
  | { op: "deleteBullet"; bulletId: string }
  | { op: "moveBullet"; bulletId: string; direction: "up" | "down" }
  | { op: "placeCard"; cardId: string; bulletId: string; fromBulletId?: string | null }
  | { op: "removeCard"; cardId: string; bulletId: string }
  | { op: "moveCardStep"; cardId: string; bulletId: string; direction: "up" | "down" }
  | { op: "fromGroups" };

export type OutlineResult = { ok: true } | { ok: false; error: string };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (value: unknown): string | null => (typeof value === "string" && ID.test(value) ? value : null);
const line = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const direction = (value: unknown): "up" | "down" | null => (value === "up" || value === "down" ? value : null);

export async function outlineAction(projectId: string, input: OutlineOp): Promise<OutlineResult> {
  const context = await researchContext();
  if (!context.ok) return { ok: false, error: context.error };
  const { viewer } = context;
  const found = id(projectId) ? await projectFor(viewer, projectId) : null;
  if (!found) return { ok: false, error: "That project no longer exists." };
  if (!canEdit(found.access)) return { ok: false, error: "You can view this outline but not edit it." };
  const db = tenantDb(viewer.organizationId);
  const org = viewer.organizationId;
  const pid = found.project.id;

  const section = async (value: unknown) => {
    const sectionId = id(value);
    return sectionId ? db.researchSection.findFirst({ where: { id: sectionId, projectId: pid } }) : null;
  };
  const bullet = async (value: unknown) => {
    const bulletId = id(value);
    return bulletId ? db.researchBullet.findFirst({ where: { id: bulletId, projectId: pid } }) : null;
  };
  const card = async (value: unknown) => {
    const cardId = id(value);
    return cardId ? db.researchCard.findFirst({ where: { id: cardId, projectId: pid }, select: { id: true } }) : null;
  };
  const reorderBulletCards = async (bulletId: string, order: string[]) => {
    const links = await db.researchBulletCard.findMany({ where: { bulletId }, select: { id: true, cardId: true, position: true } });
    const byCard = new Map(links.map((link) => [link.cardId, link.id]));
    const changes = positionChanges(links.map((link) => ({ id: link.cardId, position: link.position })), order);
    for (const change of changes) await db.researchBulletCard.updateMany({ where: { id: byCard.get(change.id)! }, data: { position: change.position } });
  };

  switch (input?.op) {
    case "addSection": {
      const sections = await db.researchSection.findMany({ where: { projectId: pid }, select: { id: true, position: true } });
      await db.researchSection.create({ data: { organizationId: org, projectId: pid, title: line(input.title, 200) || `Section ${sections.length + 1}`, position: nextPosition(sections) } });
      break;
    }
    case "renameSection": {
      const row = await section(input.sectionId);
      if (!row) return { ok: false, error: "That section is gone." };
      await db.researchSection.updateMany({ where: { id: row.id }, data: { title: line(input.title, 200) || row.title } });
      break;
    }
    case "deleteSection": {
      const row = await section(input.sectionId);
      if (row) await db.researchSection.deleteMany({ where: { id: row.id } });
      break;
    }
    case "moveSection": {
      const row = await section(input.sectionId);
      const dir = direction(input.direction);
      if (!row || !dir) return { ok: false, error: "That section is gone." };
      const sections = await db.researchSection.findMany({ where: { projectId: pid }, select: { id: true, position: true }, orderBy: [{ position: "asc" }, { id: "asc" }] });
      for (const change of positionChanges(sections, moveStep(sections.map((s) => s.id), row.id, dir))) {
        await db.researchSection.updateMany({ where: { id: change.id }, data: { position: change.position } });
      }
      break;
    }
    case "addBullet": {
      const row = await section(input.sectionId);
      if (!row) return { ok: false, error: "That section is gone." };
      const bullets = await db.researchBullet.findMany({ where: { sectionId: row.id }, select: { id: true, position: true } });
      await db.researchBullet.create({ data: { organizationId: org, projectId: pid, sectionId: row.id, text: line(input.text, 1000), position: nextPosition(bullets) } });
      break;
    }
    case "editBullet": {
      const row = await bullet(input.bulletId);
      if (!row) return { ok: false, error: "That bullet is gone." };
      await db.researchBullet.updateMany({ where: { id: row.id }, data: { text: line(input.text, 1000) } });
      break;
    }
    case "deleteBullet": {
      const row = await bullet(input.bulletId);
      if (row) await db.researchBullet.deleteMany({ where: { id: row.id } });
      break;
    }
    case "moveBullet": {
      const row = await bullet(input.bulletId);
      const dir = direction(input.direction);
      if (!row || !dir) return { ok: false, error: "That bullet is gone." };
      const bullets = await db.researchBullet.findMany({ where: { sectionId: row.sectionId }, select: { id: true, position: true }, orderBy: [{ position: "asc" }, { id: "asc" }] });
      for (const change of positionChanges(bullets, moveStep(bullets.map((b) => b.id), row.id, dir))) {
        await db.researchBullet.updateMany({ where: { id: change.id }, data: { position: change.position } });
      }
      break;
    }
    case "placeCard": {
      const [target, row] = await Promise.all([bullet(input.bulletId), card(input.cardId)]);
      if (!target || !row) return { ok: false, error: "That card or bullet is gone." };
      const from = input.fromBulletId ? await bullet(input.fromBulletId) : null;
      if (from && from.id !== target.id) await db.researchBulletCard.deleteMany({ where: { bulletId: from.id, cardId: row.id } });
      const links = await db.researchBulletCard.findMany({ where: { bulletId: target.id }, select: { cardId: true, position: true }, orderBy: [{ position: "asc" }, { cardId: "asc" }] });
      if (!links.some((link) => link.cardId === row.id)) {
        await db.researchBulletCard.create({ data: { organizationId: org, projectId: pid, bulletId: target.id, cardId: row.id, position: nextPosition(links.map((link) => ({ id: link.cardId, position: link.position }))) } });
      }
      break;
    }
    case "removeCard": {
      const target = await bullet(input.bulletId);
      const cardId = id(input.cardId);
      if (target && cardId) await db.researchBulletCard.deleteMany({ where: { bulletId: target.id, cardId } });
      break;
    }
    case "moveCardStep": {
      const target = await bullet(input.bulletId);
      const cardId = id(input.cardId);
      const dir = direction(input.direction);
      if (!target || !cardId || !dir) return { ok: false, error: "That card is gone." };
      const links = await db.researchBulletCard.findMany({ where: { bulletId: target.id }, select: { cardId: true }, orderBy: [{ position: "asc" }, { cardId: "asc" }] });
      await reorderBulletCards(target.id, moveStep(links.map((link) => link.cardId), cardId, dir));
      break;
    }
    case "fromGroups": {
      if (await db.researchSection.count({ where: { projectId: pid } })) return { ok: false, error: "The outline already has sections. Start from groups only works on an empty outline." };
      const cards = await db.researchCard.findMany({ where: { projectId: pid }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, topic: true, groupName: true } });
      if (!cards.length) return { ok: false, error: "Add some cards first." };
      let sectionPosition = 0;
      for (const draft of outlineFromGroups(cards)) {
        const created = await db.researchSection.create({ data: { organizationId: org, projectId: pid, title: draft.title, position: sectionPosition++ } });
        let bulletPosition = 0;
        for (const item of draft.bullets) {
          const b = await db.researchBullet.create({ data: { organizationId: org, projectId: pid, sectionId: created.id, text: item.text, position: bulletPosition++ } });
          let cardPosition = 0;
          for (const cardId of item.cardIds) await db.researchBulletCard.create({ data: { organizationId: org, projectId: pid, bulletId: b.id, cardId, position: cardPosition++ } });
        }
      }
      break;
    }
    default:
      return { ok: false, error: "Unknown outline change." };
  }
  await db.researchProject.updateMany({ where: { id: pid }, data: { updatedAt: new Date() } });
  await appendOrgAudit(org, { actorId: viewer.actorId, action: `research.outline.${input.op}`, targetType: "research_project", targetId: pid });
  return { ok: true };
}
