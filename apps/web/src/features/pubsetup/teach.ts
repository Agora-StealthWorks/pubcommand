import { tenantDb, type Prisma } from "@pubcommand/db";
import { teachBrain } from "@/features/brain/teach";
import { editorFacts, editorNote, publicationFacts, publicationNote } from "../../../../../modules/pubsetup/brain";
import { getBranding, getEditor, getPublication } from "./read";

/**
 * After every save: store the publication's facts JSON and teach the brand's mini-brain
 * one note per publication (sourceRef pub:<id>, folder "Publications"). Soft-fails.
 */
export async function refreshPublication(input: { organizationId: string; brandId: string; publicationId: string; actorId: string | null }): Promise<void> {
  try {
    const db = tenantDb(input.organizationId);
    const [pub, brand, branding] = await Promise.all([
      getPublication(input.organizationId, input.brandId, input.publicationId),
      db.brand.findFirst({ where: { id: input.brandId }, select: { name: true } }),
      getBranding(input.organizationId, input.publicationId),
    ]);
    if (!pub || !brand) return;
    const facts = publicationFacts({ id: pub.id, brandName: brand.name, record: pub, editors: pub.editors, branding, archived: pub.archived });
    await db.calendarPublication.updateMany({ where: { id: pub.id }, data: { facts: facts as unknown as Prisma.InputJsonValue } });
    const note = publicationNote(facts);
    await teachBrain({
      organizationId: input.organizationId,
      brandId: input.brandId,
      sourceRef: `pub:${pub.id}`,
      title: note.title,
      body: note.body,
      folder: "Publications",
      source: "pubsetup",
      actorId: input.actorId,
    });
  } catch (error) {
    console.error("[pubsetup] refresh publication failed", input.publicationId, error);
  }
}

/** Same for one editor (sourceRef editor:<id>, folder "Editors"). */
export async function refreshEditor(input: { organizationId: string; brandId: string; editorId: string; actorId: string | null }): Promise<void> {
  try {
    const db = tenantDb(input.organizationId);
    const [editor, brand] = await Promise.all([getEditor(input.organizationId, input.brandId, input.editorId), db.brand.findFirst({ where: { id: input.brandId }, select: { name: true } })]);
    if (!editor || !brand) return;
    const facts = editorFacts({ id: editor.id, brandName: brand.name, record: editor, publications: editor.publications, archived: editor.archived });
    await db.pubEditor.updateMany({ where: { id: editor.id }, data: { facts: facts as unknown as Prisma.InputJsonValue } });
    const note = editorNote(facts);
    await teachBrain({
      organizationId: input.organizationId,
      brandId: input.brandId,
      sourceRef: `editor:${editor.id}`,
      title: note.title,
      body: note.body,
      folder: "Editors",
      source: "pubsetup",
      actorId: input.actorId,
    });
  } catch (error) {
    console.error("[pubsetup] refresh editor failed", input.editorId, error);
  }
}

/** Brand defaults changed: every publication's resolved branding may have too. */
export async function refreshAllPublications(input: { organizationId: string; brandId: string; actorId: string | null }): Promise<void> {
  const rows = await tenantDb(input.organizationId).calendarPublication.findMany({ where: { brandId: input.brandId }, select: { id: true } });
  for (const row of rows) await refreshPublication({ ...input, publicationId: row.id });
}
