"use server";

import { randomBytes } from "node:crypto";
import { appendOrgAudit, tenantDb, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { isEmail, normalizeEmail } from "../../../../../modules/research/access";
import { CARD_TYPES, normalizeKeyPoints, normalizeTags } from "../../../../../modules/research/extract";
import { nextPosition } from "../../../../../modules/research/outline";
import { canEdit, canManage, projectFor, researchContext, type ResearchViewer } from "./context";
import { CAPTURE_MAX_CHARS, CAPTURE_MIN_CHARS } from "../../../../../modules/research/capture";
import { ingestFile, ingestPasted, ingestUrl, ingestX, ingestYoutube, type IngestOutcome } from "./ingest";
import { refreshBrainNote, removeBrainNote, runCondense, runExtraction, runGrouping } from "./server";

function text(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

function go(path: string, message?: { error?: string; notice?: string }): never {
  const params = new URLSearchParams();
  if (message?.error) params.set("error", message.error);
  if (message?.notice) params.set("notice", message.notice);
  const query = params.toString();
  redirect(query ? `${path}${path.includes("?") ? "&" : "?"}${query}` : path);
}

async function viewerOrBack(): Promise<ResearchViewer> {
  const context = await researchContext();
  if (!context.ok) go("/research", { error: context.error });
  return context.viewer;
}

type Need = "edit" | "manage";

async function projectOrBack(projectId: string, need: Need) {
  const viewer = await viewerOrBack();
  const found = await projectFor(viewer, projectId);
  if (!found) go("/research", { error: "That project no longer exists, or it is not shared with you." });
  const allowed = need === "manage" ? canManage(found.access) : canEdit(found.access);
  if (!allowed) go(`/research/${projectId}`, { error: need === "manage" ? "Only the owner or an admin can change that." : "You can view this project but not edit it." });
  return { viewer, project: found.project, access: found.access };
}

function audit(viewer: ResearchViewer, action: string, targetId: string, metadata?: Record<string, unknown>) {
  return appendOrgAudit(viewer.organizationId, { actorId: viewer.actorId, action, targetType: "research_project", targetId, ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}) });
}

function touch(viewer: ResearchViewer, projectId: string) {
  return tenantDb(viewer.organizationId).researchProject.updateMany({ where: { id: projectId }, data: { updatedAt: new Date() } });
}

function runInput(viewer: ResearchViewer, projectId: string) {
  return { organizationId: viewer.organizationId, projectId, brand: viewer.brand, actorId: viewer.actorId };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function createProject(formData: FormData) {
  const viewer = await viewerOrBack();
  if (!viewer.canWrite) go("/research", { error: "You need research.write to start a project." });
  const name = text(formData, "name", 160);
  if (!name) go("/research", { error: "Give the project a name." });
  const project = await tenantDb(viewer.organizationId).researchProject.create({
    data: { organizationId: viewer.organizationId, brandId: viewer.brandId, ownerId: viewer.userId, name, description: text(formData, "description", 2000) },
  });
  await audit(viewer, "research.project.created", project.id);
  go(`/research/${project.id}`);
}

export async function updateProject(formData: FormData) {
  const { viewer, project } = await projectOrBack(text(formData, "projectId", 40), "manage");
  const name = text(formData, "name", 160) || project.name;
  await tenantDb(viewer.organizationId).researchProject.updateMany({ where: { id: project.id }, data: { name, description: text(formData, "description", 2000) } });
  await audit(viewer, "research.project.updated", project.id);
  if (project.shareWithBrain) await refreshBrainNote(runInput(viewer, project.id));
  go(`/research/${project.id}?tab=settings`, { notice: "Saved." });
}

export async function deleteProject(formData: FormData) {
  const { viewer, project } = await projectOrBack(text(formData, "projectId", 40), "manage");
  if (text(formData, "confirm", 160) !== project.name) go(`/research/${project.id}?tab=settings`, { error: "Type the project name exactly to delete it." });
  await tenantDb(viewer.organizationId).researchProject.updateMany({ where: { id: project.id }, data: { deletedAt: new Date(), publicEnabled: false } });
  await removeBrainNote(viewer.organizationId, project.id);
  await audit(viewer, "research.project.deleted", project.id);
  go("/research", { notice: "Project deleted." });
}

export async function addShare(formData: FormData) {
  const { viewer, project } = await projectOrBack(text(formData, "projectId", 40), "manage");
  const email = normalizeEmail(text(formData, "email", 254));
  const permission = text(formData, "permission", 10) === "edit" ? "edit" : "view";
  const back = `/research/${project.id}?tab=settings`;
  if (!isEmail(email)) go(back, { error: "Enter a teammate's email address." });
  if (email === normalizeEmail(viewer.email) && project.ownerId === viewer.userId) go(back, { error: "You already own this project." });
  const db = tenantDb(viewer.organizationId);
  const existing = await db.researchShare.findFirst({ where: { projectId: project.id, email } });
  if (existing) await db.researchShare.updateMany({ where: { id: existing.id }, data: { permission } });
  else await db.researchShare.create({ data: { organizationId: viewer.organizationId, projectId: project.id, email, permission, createdById: viewer.actorId } });
  await audit(viewer, "research.project.shared", project.id, { email, permission });
  go(back, { notice: `Shared with ${email} (${permission === "edit" ? "can edit" : "can view"}).` });
}

export async function removeShare(formData: FormData) {
  const { viewer, project } = await projectOrBack(text(formData, "projectId", 40), "manage");
  const shareId = text(formData, "shareId", 40);
  const share = project.shares.find((row) => row.id === shareId);
  if (share) {
    await tenantDb(viewer.organizationId).researchShare.deleteMany({ where: { id: share.id, projectId: project.id } });
    await audit(viewer, "research.project.unshared", project.id, { email: share.email });
  }
  go(`/research/${project.id}?tab=settings`, { notice: "Access removed." });
}

export async function setPublicLink(formData: FormData) {
  const { viewer, project } = await projectOrBack(text(formData, "projectId", 40), "manage");
  const mode = text(formData, "mode", 12);
  const db = tenantDb(viewer.organizationId);
  if (mode === "disable") {
    await db.researchProject.updateMany({ where: { id: project.id }, data: { publicEnabled: false } });
  } else {
    // A new token on every "regenerate" makes the old link stop working.
    const token = mode === "regenerate" || !project.publicToken ? randomBytes(24).toString("base64url") : project.publicToken;
    await db.researchProject.updateMany({ where: { id: project.id }, data: { publicEnabled: true, publicToken: token } });
  }
  await audit(viewer, `research.public_link.${mode === "disable" ? "disabled" : mode === "regenerate" ? "regenerated" : "enabled"}`, project.id);
  go(`/research/${project.id}?tab=settings`, { notice: mode === "disable" ? "Public link turned off." : "Public read-only link is on." });
}

export async function setBrainSharing(formData: FormData) {
  const { viewer, project } = await projectOrBack(text(formData, "projectId", 40), "manage");
  const on = formData.get("shareWithBrain") === "on";
  await tenantDb(viewer.organizationId).researchProject.updateMany({ where: { id: project.id }, data: { shareWithBrain: on } });
  if (on) await refreshBrainNote(runInput(viewer, project.id));
  else await removeBrainNote(viewer.organizationId, project.id);
  await audit(viewer, on ? "research.brain.enabled" : "research.brain.disabled", project.id);
  go(`/research/${project.id}?tab=settings`, { notice: on ? `Cards now teach the ${viewer.brand.name} Brain (one note, kept current).` : "Brain sharing is off and the note was removed." });
}

// ---------------------------------------------------------------------------
// Sources and extraction
// ---------------------------------------------------------------------------

export async function addSource(formData: FormData) {
  const { viewer, project } = await projectOrBack(text(formData, "projectId", 40), "edit");
  const back = `/research/${project.id}`;
  const kind = text(formData, "kind", 10);
  const title = text(formData, "title", 200);
  let outcome: IngestOutcome;
  if (kind === "url") outcome = await ingestUrl(text(formData, "url", 2000), title);
  else if (kind === "youtube") outcome = await ingestYoutube(text(formData, "youtube", 2000), title, String(formData.get("transcript") ?? "").slice(0, 400_000));
  else if (kind === "x") outcome = await ingestX(text(formData, "xUrl", 2000), title, String(formData.get("xText") ?? "").slice(0, 400_000));
  else if (kind === "file") {
    const file = formData.get("file");
    outcome = file instanceof File && file.size > 0 ? await ingestFile(file, title) : { error: "Choose a file to upload." };
  } else outcome = ingestPasted({ text: String(formData.get("pasted") ?? "").slice(0, 400_000), title, url: text(formData, "pastedUrl", 2000) });
  if ("error" in outcome) go(`${back}?add=${encodeURIComponent(kind || "text")}`, { error: outcome.error });
  await saveSource(viewer, project.id, outcome);
  go(back, { notice: outcome.readVia === "jina" || outcome.readVia === "wayback" ? `Source added (read through ${outcome.readVia === "jina" ? "a reader service" : "the Wayback Machine archive"}, because the page blocked a direct read). Cards will appear in a minute.` : "Source added. Cards will appear in a minute." });
}

/** Store an ingested source and start extracting its cards. */
async function saveSource(viewer: ResearchViewer, projectId: string, outcome: Exclude<IngestOutcome, { error: string }>) {
  const db = tenantDb(viewer.organizationId);
  const source = await db.researchSource.create({
    data: {
      organizationId: viewer.organizationId,
      projectId,
      kind: outcome.kind,
      inputType: outcome.inputType,
      title: outcome.title,
      sourceRef: outcome.sourceRef,
      rawText: outcome.text,
      readVia: outcome.readVia ?? null,
      status: "QUEUED",
      createdById: viewer.actorId,
    },
  });
  if (outcome.file) {
    await db.researchFile.create({
      data: {
        organizationId: viewer.organizationId,
        sourceId: source.id,
        filename: outcome.file.filename,
        mimeType: outcome.file.mimeType,
        size: outcome.file.data.length,
        data: new Uint8Array(outcome.file.data),
      },
    });
  }
  await touch(viewer, projectId);
  await audit(viewer, "research.source.added", projectId, { sourceId: source.id, kind: outcome.kind, readVia: outcome.readVia ?? null });
  after(() => runExtraction({ ...runInput(viewer, projectId), sourceId: source.id }));
  return source.id;
}

/**
 * The bookmarklet's capture page: the text of a page the person had open in
 * their own browser. It goes into an existing project or a new one.
 */
export async function addCapturedSource(formData: FormData) {
  const viewer = await viewerOrBack();
  let projectId = text(formData, "projectId", 40);
  if (projectId === "new") {
    if (!viewer.canWrite) go("/research/capture", { error: "You need research.write to start a project." });
    const project = await tenantDb(viewer.organizationId).researchProject.create({
      data: { organizationId: viewer.organizationId, brandId: viewer.brandId, ownerId: viewer.userId, name: text(formData, "newName", 160) || text(formData, "title", 160) || "Captured research", description: "" },
    });
    await audit(viewer, "research.project.created", project.id, { via: "capture" });
    projectId = project.id;
  }
  const { project } = await projectOrBack(projectId, "edit");
  const body = String(formData.get("text") ?? "").slice(0, CAPTURE_MAX_CHARS);
  if (body.trim().length < CAPTURE_MIN_CHARS) go("/research/capture", { error: "Too little text arrived. Select the article text on the page and click the bookmarklet again." });
  const outcome = ingestPasted({ text: body, title: text(formData, "title", 200), url: text(formData, "url", 2000) });
  if ("error" in outcome) go("/research/capture", { error: outcome.error });
  await saveSource(viewer, project.id, { ...outcome, kind: outcome.sourceRef ? "url" : "text", readVia: "capture" });
  go(`/research/${project.id}`, { notice: "Captured. Cards will appear in a minute." });
}

/** Condense: merge the chosen cards (a group, or all) into fewer, denser cards. */
export async function condenseCards(formData: FormData) {
  const { viewer, project } = await projectOrBack(text(formData, "projectId", 40), "edit");
  const scope = text(formData, "scope", 80);
  const target = Number(text(formData, "target", 4)) || null;
  const replace = formData.get("replace") === "on";
  await tenantDb(viewer.organizationId).researchProject.updateMany({ where: { id: project.id }, data: { condenseStatus: "QUEUED", condenseError: null } });
  await audit(viewer, "research.cards.condense_requested", project.id, { scope: scope || "all", replace });
  after(() => runCondense({ ...runInput(viewer, project.id), scope: scope || null, target, replace }));
  go(`/research/${project.id}`, { notice: "Condensing cards…" });
}

export async function rerunSource(formData: FormData) {
  const { viewer, project } = await projectOrBack(text(formData, "projectId", 40), "edit");
  const sourceId = text(formData, "sourceId", 40);
  const db = tenantDb(viewer.organizationId);
  const updated = await db.researchSource.updateMany({ where: { id: sourceId, projectId: project.id }, data: { status: "QUEUED", error: null } });
  if (!updated.count) go(`/research/${project.id}`, { error: "That source no longer exists." });
  await audit(viewer, "research.source.rerun", project.id, { sourceId });
  after(() => runExtraction({ ...runInput(viewer, project.id), sourceId }));
  go(`/research/${project.id}`, { notice: "Extracting again. Cards from this source are replaced unless they are in the outline." });
}

export async function deleteSource(formData: FormData) {
  const { viewer, project } = await projectOrBack(text(formData, "projectId", 40), "edit");
  const sourceId = text(formData, "sourceId", 40);
  const db = tenantDb(viewer.organizationId);
  const source = await db.researchSource.findFirst({ where: { id: sourceId, projectId: project.id }, select: { id: true } });
  if (source) {
    // Cards already in the outline stay (with their source label); the rest go with the source.
    const cards = await db.researchCard.findMany({ where: { sourceId: source.id }, select: { id: true, _count: { select: { bullets: true } } } });
    const unused = cards.filter((card) => card._count.bullets === 0).map((card) => card.id);
    if (unused.length) await db.researchCard.deleteMany({ where: { id: { in: unused } } });
    await db.researchSource.deleteMany({ where: { id: source.id } });
    await touch(viewer, project.id);
    await audit(viewer, "research.source.deleted", project.id, { sourceId });
    if (project.shareWithBrain) await refreshBrainNote(runInput(viewer, project.id));
  }
  go(`/research/${project.id}`, { notice: "Source removed." });
}

export async function suggestGroups(formData: FormData) {
  const { viewer, project } = await projectOrBack(text(formData, "projectId", 40), "edit");
  await tenantDb(viewer.organizationId).researchProject.updateMany({ where: { id: project.id }, data: { groupStatus: "QUEUED", groupError: null } });
  await audit(viewer, "research.cards.group_requested", project.id);
  after(() => runGrouping(runInput(viewer, project.id)));
  go(`/research/${project.id}`, { notice: "Sorting cards into topic groups…" });
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function cardFields(formData: FormData, previous: { text: string; kind: string }[] = []) {
  const kinds = new Map(previous.map((point) => [point.text, point.kind]));
  const cardType = text(formData, "cardType", 10);
  const points = String(formData.get("keyPoints") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((line) => {
      // "text | location" keeps the location editable in a plain textarea.
      const [body, ...rest] = line.split(" | ");
      const location = rest.join(" | ").trim();
      const clean = body!.trim();
      const kind = kinds.get(clean) ?? (/^["“]/.test(clean) ? "quote" : /\d/.test(clean) ? "stat" : "fact");
      return { text: clean, kind, location };
    });
  return {
    topic: text(formData, "topic", 200),
    summary: text(formData, "summary", 2000),
    details: text(formData, "details", 6000),
    cardType: (CARD_TYPES as readonly string[]).includes(cardType) ? cardType : "fact",
    keyPoints: normalizeKeyPoints(points) as unknown as Prisma.InputJsonValue,
    tags: normalizeTags(text(formData, "tags", 400).split(",")),
    groupName: text(formData, "groupName", 60) || null,
    sourceLabel: text(formData, "sourceLabel", 200),
    sourceUrl: /^https?:\/\//i.test(text(formData, "sourceUrl", 2000)) ? text(formData, "sourceUrl", 2000) : null,
  };
}

export async function createCard(formData: FormData) {
  const { viewer, project } = await projectOrBack(text(formData, "projectId", 40), "edit");
  const fields = cardFields(formData);
  if (!fields.topic || !fields.summary) go(`/research/${project.id}?add=card`, { error: "A card needs a topic and a summary." });
  const db = tenantDb(viewer.organizationId);
  const existing = await db.researchCard.findMany({ where: { projectId: project.id }, select: { id: true, position: true } });
  const card = await db.researchCard.create({
    data: { organizationId: viewer.organizationId, projectId: project.id, ...fields, position: nextPosition(existing), origin: "manual", createdById: viewer.actorId },
  });
  await touch(viewer, project.id);
  await audit(viewer, "research.card.created", project.id, { cardId: card.id });
  if (project.shareWithBrain) await refreshBrainNote(runInput(viewer, project.id));
  go(`/research/${project.id}#card-${card.id}`, { notice: "Card added." });
}

export async function updateCard(formData: FormData) {
  const { viewer, project } = await projectOrBack(text(formData, "projectId", 40), "edit");
  const cardId = text(formData, "cardId", 40);
  const db = tenantDb(viewer.organizationId);
  const current = await db.researchCard.findFirst({ where: { id: cardId, projectId: project.id }, select: { keyPoints: true } });
  if (!current) go(`/research/${project.id}`, { error: "That card no longer exists." });
  const fields = cardFields(formData, normalizeKeyPoints(current.keyPoints));
  if (!fields.topic || !fields.summary) go(`/research/${project.id}`, { error: "A card needs a topic and a summary." });
  await db.researchCard.updateMany({ where: { id: cardId, projectId: project.id }, data: fields });
  await touch(viewer, project.id);
  await audit(viewer, "research.card.updated", project.id, { cardId });
  if (project.shareWithBrain) await refreshBrainNote(runInput(viewer, project.id));
  go(`/research/${project.id}`, { notice: "Card saved." });
}

export async function deleteCard(formData: FormData) {
  const { viewer, project } = await projectOrBack(text(formData, "projectId", 40), "edit");
  const cardId = text(formData, "cardId", 40);
  await tenantDb(viewer.organizationId).researchCard.deleteMany({ where: { id: cardId, projectId: project.id } });
  await touch(viewer, project.id);
  await audit(viewer, "research.card.deleted", project.id, { cardId });
  if (project.shareWithBrain) await refreshBrainNote(runInput(viewer, project.id));
  go(`/research/${project.id}`, { notice: "Card deleted." });
}

export async function renameGroup(formData: FormData) {
  const { viewer, project } = await projectOrBack(text(formData, "projectId", 40), "edit");
  const from = text(formData, "from", 60);
  const to = text(formData, "to", 60) || null;
  if (from) {
    await tenantDb(viewer.organizationId).researchCard.updateMany({ where: { projectId: project.id, groupName: from }, data: { groupName: to } });
    await audit(viewer, "research.group.renamed", project.id, { from, to });
  }
  go(`/research/${project.id}`, { notice: to ? `Group renamed to ${to}.` : "Group removed; its cards are ungrouped." });
}
