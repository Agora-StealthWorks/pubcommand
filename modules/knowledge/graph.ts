/**
 * Graph view: notes as nodes, [[wiki links]] as edges, laid out on the server
 * with a deterministic force-directed layout (no chart dependency, no client
 * physics). Pure and unit tested.
 */
import { linkResolver, parseWikiLinks, type LinkCandidate } from "./wikilinks";

export const GRAPH_NODE_LIMIT = 400;

export type GraphNote = LinkCandidate & { folder: string | null; body: string };

export type GraphNode = { id: string; title: string; folder: string | null; degree: number; x: number; y: number; group: number };
export type GraphEdge = { source: string; target: string };
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[]; totalNotes: number; totalLinks: number; truncated: boolean; groups: string[] };

/** Resolve every note's links against the visible notes, keep the best-connected ones, and lay them out. */
export function buildGraph(
  notes: readonly GraphNote[],
  options: { preferBrandId: string | null; limit?: number; includeOrphans?: boolean; width?: number; height?: number; /** Colour by the folder level under this one. */ within?: string | null } = { preferBrandId: null },
): Graph {
  const resolve = linkResolver(notes, options.preferBrandId);
  const edgeKeys = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const note of notes) {
    for (const link of parseWikiLinks(note.body)) {
      if (link.embed || !link.target) continue;
      const target = resolve(link.target);
      if (!target || target.id === note.id) continue;
      const [a, b] = note.id < target.id ? [note.id, target.id] : [target.id, note.id];
      const key = `${a}|${b}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ source: note.id, target: target.id });
    }
  }
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const limit = options.limit ?? GRAPH_NODE_LIMIT;
  const candidates = notes.filter((note) => options.includeOrphans || (degree.get(note.id) ?? 0) > 0);
  const kept = [...candidates]
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.title.localeCompare(b.title))
    .slice(0, limit);
  const keptIds = new Set(kept.map((note) => note.id));
  const keptEdges = edges.filter((edge) => keptIds.has(edge.source) && keptIds.has(edge.target));
  const groupOf = (folder: string | null) => groupFolder(folder, options.within ?? null);
  const groups = [...new Set(kept.map((note) => groupOf(note.folder)))].sort();
  const width = options.width ?? 1000;
  const height = options.height ?? 700;
  const positions = layout(
    kept.map((note) => note.id),
    keptEdges,
    width,
    height,
  );
  const nodes: GraphNode[] = kept.map((note) => {
    const point = positions.get(note.id) ?? { x: width / 2, y: height / 2 };
    return {
      id: note.id,
      title: note.title,
      folder: note.folder,
      degree: degree.get(note.id) ?? 0,
      x: round(point.x),
      y: round(point.y),
      group: groups.indexOf(groupOf(note.folder)),
    };
  });
  return { nodes, edges: keptEdges, totalNotes: notes.length, totalLinks: edges.length, truncated: candidates.length > kept.length, groups };
}

export function topFolder(folder: string | null): string {
  return folder?.split("/")[0] || "(top level)";
}

/** The folder level just under `within` ("Resources" + "Resources/Experts/x" -> "Experts"). */
export function groupFolder(folder: string | null, within: string | null): string {
  if (!within) return topFolder(folder);
  if (!folder || folder === within) return within.split("/").pop() ?? within;
  const rest = folder.startsWith(`${within}/`) ? folder.slice(within.length + 1) : folder;
  return rest.split("/")[0] || "(top level)";
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Small deterministic PRNG so the same notes always draw the same picture. */
function seeded(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Fruchterman–Reingold with cooling, then scaled into the box with a margin. */
export function layout(ids: readonly string[], edges: readonly GraphEdge[], width: number, height: number, iterations = 220): Map<string, { x: number; y: number }> {
  const n = ids.length;
  const result = new Map<string, { x: number; y: number }>();
  if (n === 0) return result;
  const index = new Map(ids.map((id, i) => [id, i]));
  const random = seeded(hash(ids.join("|")));
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    xs[i] = (random() - 0.5) * width;
    ys[i] = (random() - 0.5) * height;
  }
  const k = Math.sqrt((width * height) / n) * 0.9;
  const links = edges.flatMap((edge) => {
    const a = index.get(edge.source);
    const b = index.get(edge.target);
    return a === undefined || b === undefined ? [] : [[a, b] as const];
  });
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  let temperature = width / 8;
  for (let step = 0; step < iterations; step += 1) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        let x = xs[i]! - xs[j]!;
        let y = ys[i]! - ys[j]!;
        let d2 = x * x + y * y;
        if (d2 < 0.01) {
          x = 0.1 * (random() - 0.5);
          y = 0.1 * (random() - 0.5);
          d2 = x * x + y * y + 0.01;
        }
        const force = (k * k) / d2;
        dx[i]! += x * force;
        dy[i]! += y * force;
        dx[j]! -= x * force;
        dy[j]! -= y * force;
      }
    }
    for (const [a, b] of links) {
      const x = xs[a]! - xs[b]!;
      const y = ys[a]! - ys[b]!;
      const d = Math.sqrt(x * x + y * y) || 0.01;
      const force = d / k;
      dx[a]! -= x * force;
      dy[a]! -= y * force;
      dx[b]! += x * force;
      dy[b]! += y * force;
    }
    for (let i = 0; i < n; i += 1) {
      // Gentle gravity keeps disconnected clusters on screen.
      dx[i]! -= xs[i]! * 0.08 * (k / 40);
      dy[i]! -= ys[i]! * 0.08 * (k / 40);
      const d = Math.sqrt(dx[i]! * dx[i]! + dy[i]! * dy[i]!) || 1;
      const move = Math.min(d, temperature);
      xs[i]! += (dx[i]! / d) * move;
      ys[i]! += (dy[i]! / d) * move;
    }
    temperature = Math.max(temperature * 0.97, 0.5);
  }
  // Scale by the 3rd–97th percentile so a few far-off islands do not squash the rest; clamp outliers to the edge.
  const pct = (values: Float64Array, p: number) => {
    const sorted = Array.from(values).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))]!;
  };
  const lowP = n > 30 ? 0.03 : 0;
  const minX = pct(xs, lowP);
  const maxX = pct(xs, 1 - lowP);
  const minY = pct(ys, lowP);
  const maxY = pct(ys, 1 - lowP);
  const margin = 30;
  const scaleX = maxX - minX > 0 ? (width - margin * 2) / (maxX - minX) : 1;
  const scaleY = maxY - minY > 0 ? (height - margin * 2) / (maxY - minY) : 1;
  for (let i = 0; i < n; i += 1) {
    const x = maxX - minX > 0 ? margin + (xs[i]! - minX) * scaleX : width / 2;
    const y = maxY - minY > 0 ? margin + (ys[i]! - minY) * scaleY : height / 2;
    result.set(ids[i]!, { x: Math.min(width - margin / 2, Math.max(margin / 2, x)), y: Math.min(height - margin / 2, Math.max(margin / 2, y)) });
  }
  return result;
}
