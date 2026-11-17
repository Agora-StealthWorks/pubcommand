import { tenantDb } from "@pubcommand/db";
import { getEditors, getPublications, type Editor } from "@/features/pubsetup/read";
import { editorTrackSummaries, expertForEditor, portfolioPublication, type EditorPubSummary, type PubRef } from "../../../../../modules/performance/attribution";
import { trackAccess, type TrackScope } from "./context";
import { marketConnected } from "./prices";
import { callViews, listPortfolios, positionViews, toStat, type CallView } from "./server";

/**
 * Track Record on a wiki editor profile: the editor's archived calls and their per-publication summaries.
 * Read only. Callers render nothing when this returns null (Track Record off, not a finance brand, or no access).
 */

export type ClaimFile = { id: string; filename: string; mimeType: string; size: number; role: string };
/** What the profile table needs of a call (plain data: it is handed to a client component). */
export type ClaimRow = {
  id: string;
  title: string;
  ticker: string | null;
  callType: string;
  direction: string;
  callDate: Date | null;
  gainBasis: string;
  entryPrice: number | null;
  categoryIds: string[];
  /** Price fields read from a document by AI and not yet checked by a person. */
  priceCheck: string[];
  gain: CallView["gain"];
  files: ClaimFile[];
};
export type ClaimCategory = { id: string; name: string; color: string };

export type EditorTrackData = {
  scope: TrackScope;
  marketConnected: boolean;
  expertId: string | null;
  claims: ClaimRow[];
  categories: ClaimCategory[];
  summaries: EditorPubSummary[];
};

/** Calls on one profile are capped; the archive itself lists more. */
const MAX_CLAIMS = 500;

export function pubRefs(publications: Awaited<ReturnType<typeof getPublications>>): PubRef[] {
  return publications.map((p) => ({ id: p.id, code: p.code, name: p.name, slug: p.slug, editorIds: p.editors.map((e) => e.id) }));
}

export async function editorTrackData(slug: string, editor: Editor): Promise<EditorTrackData | null> {
  const access = await trackAccess("performance.read", slug);
  if (!access.ok || access.scope.brandId !== editor.brandId) return null;
  const { scope } = access;
  const db = tenantDb(scope.organizationId);
  const [experts, editors, categories, publications, portfolios, positions] = await Promise.all([
    db.trackExpert.findMany({ where: { brandId: scope.brandId, deletedAt: null }, select: { id: true, name: true, editorId: true } }),
    getEditors(scope.organizationId, scope.brandId),
    db.trackCategory.findMany({ where: { brandId: scope.brandId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, color: true } }),
    getPublications(scope.organizationId, scope.brandId),
    listPortfolios(scope),
    // One batched quote load for every position (the same path the Track Record home uses).
    positionViews(scope.organizationId, { brandId: scope.brandId }, { refresh: true }),
  ]);
  const expert = expertForEditor(experts, editor, editors);
  const rows = expert
    ? await db.trackCall.findMany({
        where: { brandId: scope.brandId, expertId: expert.id, deletedAt: null },
        include: { files: { select: { id: true, filename: true, mimeType: true, size: true, role: true }, orderBy: { createdAt: "asc" } } },
        orderBy: [{ callDate: "desc" }, { createdAt: "desc" }],
        take: MAX_CLAIMS,
      })
    : [];
  // callViews batches every symbol into one loadQuotes call (no per-row price fetches).
  const views = await callViews(scope.organizationId, rows, { refresh: true });
  const files = new Map(rows.map((row) => [row.id, row.files]));
  const claims: ClaimRow[] = views.map((v) => ({
    id: v.id,
    title: v.title,
    ticker: v.ticker,
    callType: v.callType,
    direction: v.direction,
    callDate: v.callDate,
    gainBasis: v.gainBasis,
    entryPrice: v.entryPrice,
    categoryIds: v.categoryIds,
    priceCheck: v.priceCheck,
    gain: v.gain,
    files: files.get(v.id) ?? [],
  }));
  const summaries = editorTrackSummaries({
    editorId: editor.id,
    editorPublicationIds: editor.publications.map((p) => p.id),
    portfolios: portfolios.map((p) => ({ id: p.id, name: p.name, publication: p.publication, defaultEditorId: p.defaultEditorId })),
    publications: pubRefs(publications),
    positions: positions.map((view) => ({ ...toStat(view), portfolioId: view.portfolioId, editorId: view.editorId })),
  });
  return { scope, marketConnected: marketConnected(), expertId: expert?.id ?? null, claims, categories, summaries };
}

/**
 * Editors offered on a position or portfolio: those linked to the portfolio's publication in Publication Setup,
 * else every active editor of the brand. The current value is always kept as an option.
 */
export async function editorOptions(
  scope: Pick<TrackScope, "organizationId" | "brandId">,
  publication: string,
  keep: readonly (string | null | undefined)[] = [],
): Promise<{ options: { id: string; name: string }[]; fromPublication: boolean; publicationEditorIds: string[] }> {
  const [editors, publications] = await Promise.all([getEditors(scope.organizationId, scope.brandId), getPublications(scope.organizationId, scope.brandId)]);
  const pub = portfolioPublication(publication, publications);
  const linked = pub ? pub.editors.map((e) => e.id) : [];
  const wanted = new Set(keep.filter((id): id is string => !!id));
  const base = linked.length ? editors.filter((e) => linked.includes(e.id)) : editors.filter((e) => e.status === "active");
  const extra = editors.filter((e) => wanted.has(e.id) && !base.some((b) => b.id === e.id));
  return { options: [...base, ...extra].map((e) => ({ id: e.id, name: e.name })), fromPublication: linked.length > 0, publicationEditorIds: linked };
}

/** The Editor picker on the position form, with what an empty choice resolves to spelled out. */
export async function positionEditorPicker(
  scope: Pick<TrackScope, "organizationId" | "brandId">,
  portfolio: { publication: string; defaultEditorId: string | null },
  currentEditorId: string | null,
): Promise<{ options: { id: string; name: string }[]; fallbackLabel: string }> {
  const { options, publicationEditorIds } = await editorOptions(scope, portfolio.publication, [currentEditorId, portfolio.defaultEditorId]);
  const name = (id: string | null | undefined) => options.find((o) => o.id === id)?.name ?? "an archived editor";
  const fallbackLabel = portfolio.defaultEditorId
    ? `Portfolio default (${name(portfolio.defaultEditorId)})`
    : publicationEditorIds.length === 1
      ? `The publication's editor (${name(publicationEditorIds[0])})`
      : "Not assigned";
  return { options, fallbackLabel };
}
