import { rawPrisma } from "@pubcommand/db";
import type { ConflictEntity, EntityKind } from "../../../../../modules/knowledge/conflicts";
import { editorFacts, publicationFacts, type FactRecord } from "../../../../../modules/pubsetup/brain";
import { mainBrain } from "../main-brain/db";
import { getEditors, getPublications } from "../pubsetup/read";

/**
 * Publication Setup entities across every organization, with their facts.
 * Platform code only (the console and the conflict job). Facts are built from
 * the rows with the same publicationFacts()/editorFacts() Publication Setup uses
 * when it saves, so a save whose after() failed never leaves a stale snapshot.
 */
export type EntityRecord = {
  kind: EntityKind;
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  brandId: string;
  brandName: string;
  name: string;
  code: string | null;
  archived: boolean;
  entity: ConflictEntity;
};

export function entityKey(kind: EntityKind, id: string): string {
  return `${kind}:${id}`;
}

export async function loadEntities(filter: { organizationId?: string; kind?: EntityKind; id?: string } = {}): Promise<EntityRecord[]> {
  const brands = await rawPrisma().brand.findMany({
    where: filter.organizationId ? { organizationId: filter.organizationId } : {},
    select: { id: true, name: true, organizationId: true, organization: { select: { name: true, slug: true } } },
    orderBy: [{ organizationId: "asc" }, { name: "asc" }],
  });
  const out: EntityRecord[] = [];
  for (const brand of brands) {
    const [pubs, editors] = await Promise.all([
      getPublications(brand.organizationId, brand.id, { includeArchived: true }),
      getEditors(brand.organizationId, brand.id, { includeArchived: true }),
    ]);
    if (!pubs.length && !editors.length) continue;
    const knownPublications = pubs.filter((p) => !p.archived).map((p) => ({ name: p.name, code: p.code }));
    const allNames = [...pubs.map((p) => p.name), ...editors.map((e) => e.name)];
    const base = { organizationId: brand.organizationId, organizationName: brand.organization.name, organizationSlug: brand.organization.slug, brandId: brand.id, brandName: brand.name };
    if (filter.kind !== "editor") {
      for (const pub of pubs) {
        if (filter.id && pub.id !== filter.id) continue;
        const facts = publicationFacts({
          id: pub.id,
          brandName: brand.name,
          record: pub as unknown as FactRecord,
          editors: pub.editors.map((e) => ({ name: e.name, role: e.role })),
          archived: pub.archived,
        });
        out.push({
          ...base,
          kind: "publication",
          id: pub.id,
          name: pub.name,
          code: pub.code,
          archived: pub.archived,
          entity: {
            kind: "publication",
            id: pub.id,
            name: pub.name,
            aliases: pub.code && pub.code.toLowerCase() !== pub.name.toLowerCase() ? [pub.code] : [],
            fields: withoutLayout(facts.fields),
            otherNames: allNames.filter((n) => n !== pub.name),
            knownPublications,
          },
        });
      }
    }
    if (filter.kind !== "publication") {
      for (const editor of editors) {
        if (filter.id && editor.id !== filter.id) continue;
        const facts = editorFacts({
          id: editor.id,
          brandName: brand.name,
          record: editor as unknown as FactRecord,
          publications: editor.publications.map((p) => ({ name: p.name, code: p.code, role: p.role })),
          archived: editor.archived,
        });
        out.push({
          ...base,
          kind: "editor",
          id: editor.id,
          name: editor.name,
          code: null,
          archived: editor.archived,
          entity: { kind: "editor", id: editor.id, name: editor.name, aliases: [], fields: withoutLayout(facts.fields), otherNames: allNames.filter((n) => n !== editor.name), knownPublications },
        });
      }
    }
  }
  return out;
}

/** Fields that say nothing the Brain could contradict (calendar color, URL name). */
function withoutLayout(fields: Record<string, string | string[]>): Record<string, string | string[]> {
  const { color: _color, slug: _slug, ...rest } = fields;
  return rest;
}

export async function loadEntity(kind: EntityKind, id: string): Promise<EntityRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  // Which organization owns the id: a platform read (bypass_rls for one transaction).
  const owner = await mainBrain((tx) =>
    kind === "publication" ? tx.calendarPublication.findUnique({ where: { id }, select: { organizationId: true } }) : tx.pubEditor.findUnique({ where: { id }, select: { organizationId: true } }),
  );
  if (!owner) return null;
  const [record] = await loadEntities({ organizationId: owner.organizationId, kind, id });
  return record ?? null;
}
