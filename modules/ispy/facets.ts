/**
 * Linked filter dropdowns: picking a publisher, publication, list or guru narrows the
 * other dropdowns to entries linked to it. Pure over a small registry snapshot.
 */
export type FacetRegistry = {
  publishers: { id: string; name: string }[];
  publications: { id: string; name: string; publisherId: string }[];
  lists: { id: string; name: string; publisherId: string; publicationId: string | null }[];
  gurus: { id: string; name: string; publicationIds: string[]; listIds: string[]; publisherId: string | null }[];
};

export type FacetSelection = { publisherId?: string | null; publicationId?: string | null; listId?: string | null; guruId?: string | null };

export type FacetOptions = {
  publishers: { id: string; name: string }[];
  publications: { id: string; name: string }[];
  lists: { id: string; name: string }[];
  gurus: { id: string; name: string }[];
};

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

export function facetOptions(reg: FacetRegistry, sel: FacetSelection): FacetOptions {
  const guru = sel.guruId ? reg.gurus.find((g) => g.id === sel.guruId) ?? null : null;
  const list = sel.listId ? reg.lists.find((l) => l.id === sel.listId) ?? null : null;
  const publication = sel.publicationId ? reg.publications.find((p) => p.id === sel.publicationId) ?? null : null;

  let lists = reg.lists;
  if (sel.publisherId) lists = lists.filter((l) => l.publisherId === sel.publisherId);
  if (publication) lists = lists.filter((l) => l.publicationId === publication.id);
  if (guru) lists = lists.filter((l) => guru.listIds.includes(l.id) || (l.publicationId !== null && guru.publicationIds.includes(l.publicationId)));

  let publications = reg.publications;
  if (sel.publisherId) publications = publications.filter((p) => p.publisherId === sel.publisherId);
  if (list) publications = publications.filter((p) => p.id === list.publicationId);
  if (guru) publications = publications.filter((p) => guru.publicationIds.includes(p.id) || reg.lists.some((l) => l.publicationId === p.id && guru.listIds.includes(l.id)));

  let gurus = reg.gurus;
  if (sel.publisherId) gurus = gurus.filter((g) => g.publisherId === sel.publisherId || g.publicationIds.some((id) => reg.publications.find((p) => p.id === id)?.publisherId === sel.publisherId));
  if (publication) gurus = gurus.filter((g) => g.publicationIds.includes(publication.id) || g.listIds.some((id) => reg.lists.find((l) => l.id === id)?.publicationId === publication.id));
  if (list) gurus = gurus.filter((g) => g.listIds.includes(list.id) || (list.publicationId !== null && g.publicationIds.includes(list.publicationId)));

  let publishers = reg.publishers;
  if (publication) publishers = publishers.filter((p) => p.id === publication.publisherId);
  if (list) publishers = publishers.filter((p) => p.id === list.publisherId);
  if (guru) {
    const ids = new Set([guru.publisherId, ...guru.publicationIds.map((id) => reg.publications.find((p) => p.id === id)?.publisherId)].filter(Boolean));
    publishers = publishers.filter((p) => ids.has(p.id));
  }

  return {
    publishers: publishers.map(({ id, name }) => ({ id, name })).sort(byName),
    publications: publications.map(({ id, name }) => ({ id, name })).sort(byName),
    lists: lists.map(({ id, name }) => ({ id, name })).sort(byName),
    gurus: gurus.map(({ id, name }) => ({ id, name })).sort(byName),
  };
}
