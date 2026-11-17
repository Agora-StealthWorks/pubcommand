/**
 * Who a recommendation or an archived call belongs to, in Publication Setup terms (editors). Pure.
 *
 * A position's editor is, in order:
 *   1. the editor set on the position,
 *   2. the portfolio's default editor,
 *   3. the only editor linked to the portfolio's publication in Publication Setup,
 *   4. nobody (unattributed). Unattributed positions are never counted for any editor.
 *
 * An archive expert "is" an editor when its editorId points at them. Older experts without a link match an
 * editor by name (case-insensitive) only when the name is unambiguous on both sides.
 */
import { computeStats, type PortfolioStats, type StatPosition } from "./stats";

export type AttributionVia = "position" | "portfolio" | "publication" | "none";

export function attributeEditor(input: {
  positionEditorId: string | null | undefined;
  portfolioDefaultEditorId: string | null | undefined;
  /** Editors linked to the portfolio's publication (empty when it has none, or no publication matched). */
  publicationEditorIds: readonly string[];
}): { editorId: string | null; via: AttributionVia } {
  if (input.positionEditorId) return { editorId: input.positionEditorId, via: "position" };
  if (input.portfolioDefaultEditorId) return { editorId: input.portfolioDefaultEditorId, via: "portfolio" };
  const unique = [...new Set(input.publicationEditorIds)];
  if (unique.length === 1) return { editorId: unique[0] as string, via: "publication" };
  return { editorId: null, via: "none" };
}

export type PubRef = { id: string; code: string; name: string; slug: string; editorIds: readonly string[] };

const norm = (value: string | null | undefined) => String(value ?? "").trim().toLowerCase();

/**
 * The Publication Setup publication a portfolio belongs to, from its free-text publication (code, name or slug).
 * Exact matches only: a fuzzy match could credit an editor with somebody else's trades.
 */
export function portfolioPublication<P extends Pick<PubRef, "code" | "name" | "slug">>(publication: string | null | undefined, publications: readonly P[]): P | null {
  const wanted = norm(publication);
  if (!wanted) return null;
  return publications.find((p) => norm(p.code) === wanted) ?? publications.find((p) => norm(p.name) === wanted || norm(p.slug) === wanted) ?? null;
}

export type SummaryPortfolio = { id: string; name: string; publication: string; defaultEditorId: string | null };
export type SummaryPosition = StatPosition & { portfolioId: string; editorId: string | null };

export type UnassignedNote = { portfolioId: string; portfolioName: string; count: number };

export type EditorPubSummary = {
  /** Publication id, or `portfolio:<id>` for a portfolio whose publication is not in Publication Setup. */
  key: string;
  publication: PubRef | null;
  /** Shown when there is no publication: the portfolio's own publication text or name. */
  label: string;
  portfolios: { id: string; name: string }[];
  /** True when the publication has more than one editor, so only this editor's positions are counted. */
  shared: boolean;
  stats: PortfolioStats;
  /** Open positions of this editor whose gain uses a stored or recorded price. */
  staleCount: number;
  /** Positions in this publication's portfolios that nobody is credited with (shared publications only). */
  unassigned: UnassignedNote[];
};

/** Every position with its resolved editor. */
export function attributePositions<T extends { portfolioId: string; editorId: string | null }>(
  positions: readonly T[],
  portfolios: readonly SummaryPortfolio[],
  publications: readonly PubRef[],
): (T & { creditedEditorId: string | null; via: AttributionVia })[] {
  const byId = new Map(portfolios.map((p) => [p.id, p]));
  const pubOf = new Map(portfolios.map((p) => [p.id, portfolioPublication(p.publication, publications)]));
  return positions.map((position) => {
    const portfolio = byId.get(position.portfolioId);
    const pub = pubOf.get(position.portfolioId) ?? null;
    const { editorId, via } = attributeEditor({
      positionEditorId: position.editorId,
      portfolioDefaultEditorId: portfolio?.defaultEditorId ?? null,
      publicationEditorIds: pub?.editorIds ?? [],
    });
    return { ...position, creditedEditorId: editorId, via };
  });
}

/**
 * One summary per publication for one editor, computed only from the positions credited to that editor.
 * A publication gets a card when the editor writes for it and it has a portfolio, or when any of its
 * portfolios holds a position credited to the editor.
 */
export function editorTrackSummaries(input: {
  editorId: string;
  /** Publications the editor writes for (Publication Setup links), in display order. */
  editorPublicationIds: readonly string[];
  portfolios: readonly SummaryPortfolio[];
  publications: readonly PubRef[];
  positions: readonly SummaryPosition[];
}): EditorPubSummary[] {
  const attributed = attributePositions(input.positions, input.portfolios, input.publications);
  const groups = new Map<string, { publication: PubRef | null; label: string; portfolios: SummaryPortfolio[] }>();
  for (const portfolio of input.portfolios) {
    const pub = portfolioPublication(portfolio.publication, input.publications);
    const key = pub ? pub.id : `portfolio:${portfolio.id}`;
    const group = groups.get(key) ?? { publication: pub, label: pub ? pub.name : portfolio.publication || portfolio.name, portfolios: [] };
    group.portfolios.push(portfolio);
    groups.set(key, group);
  }
  const writesFor = new Set(input.editorPublicationIds);
  const order = (key: string) => {
    const index = input.editorPublicationIds.indexOf(key);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const out: EditorPubSummary[] = [];
  for (const [key, group] of groups) {
    const ids = new Set(group.portfolios.map((p) => p.id));
    const inGroup = attributed.filter((p) => ids.has(p.portfolioId));
    const mine = inGroup.filter((p) => p.creditedEditorId === input.editorId);
    if (!mine.length && !(group.publication && writesFor.has(group.publication.id))) continue;
    const shared = new Set(group.publication?.editorIds ?? []).size > 1;
    const unassigned = shared
      ? group.portfolios
          .map((p) => ({ portfolioId: p.id, portfolioName: p.name, count: inGroup.filter((x) => x.portfolioId === p.id && x.creditedEditorId == null).length }))
          .filter((n) => n.count > 0)
      : [];
    out.push({
      key,
      publication: group.publication,
      label: group.label,
      portfolios: group.portfolios.map((p) => ({ id: p.id, name: p.name })),
      shared,
      stats: computeStats(mine),
      staleCount: mine.filter((p) => p.status === "OPEN" && p.stale).length,
      unassigned,
    });
  }
  return out.sort((a, b) => order(a.key) - order(b.key) || a.label.localeCompare(b.label));
}

/** Aggregate stats per credited editor for one portfolio's positions (for the weekly Brain note). */
export function statsByEditor(
  positions: readonly (StatPosition & { creditedEditorId: string | null })[],
  editorNames: ReadonlyMap<string, string>,
): { name: string; positions: StatPosition[] }[] {
  const groups = new Map<string, StatPosition[]>();
  for (const p of positions) {
    if (!p.creditedEditorId || !editorNames.has(p.creditedEditorId)) continue;
    groups.set(p.creditedEditorId, [...(groups.get(p.creditedEditorId) ?? []), p]);
  }
  return [...groups].map(([id, list]) => ({ name: editorNames.get(id) as string, positions: list })).sort((a, b) => a.name.localeCompare(b.name));
}

// ----------------------------------------------------------------------------- archive experts

export type ExpertRef = { id: string; name: string; editorId: string | null };
export type EditorRef = { id: string; name: string };

/**
 * The archive expert who is this editor: the one linked to them, else an unlinked expert with the same name
 * when the name is unique among the brand's editors and among its unlinked experts. Null when none.
 */
export function expertForEditor(experts: readonly ExpertRef[], editor: EditorRef, editors: readonly EditorRef[]): ExpertRef | null {
  const linked = experts.find((e) => e.editorId === editor.id);
  if (linked) return linked;
  const name = norm(editor.name);
  if (!name || editors.filter((e) => norm(e.name) === name).length !== 1) return null;
  const candidates = experts.filter((e) => !e.editorId && norm(e.name) === name);
  return candidates.length === 1 ? (candidates[0] as ExpertRef) : null;
}

/** The editor an expert's name points at, for linking a new or unlinked expert. Null when ambiguous or taken. */
export function editorForExpertName(name: string, editors: readonly EditorRef[], experts: readonly ExpertRef[]): EditorRef | null {
  const wanted = norm(name);
  if (!wanted) return null;
  const matches = editors.filter((e) => norm(e.name) === wanted);
  if (matches.length !== 1) return null;
  const editor = matches[0] as EditorRef;
  if (experts.some((e) => e.editorId === editor.id)) return null;
  if (experts.filter((e) => !e.editorId && norm(e.name) === wanted).length > 1) return null;
  return editor;
}
