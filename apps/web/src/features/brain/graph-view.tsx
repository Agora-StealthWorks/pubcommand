"use client";

import { useMemo, useRef, useState } from "react";

export type GraphViewNode = { id: string; title: string; folder: string | null; degree: number; x: number; y: number; group: number };
export type GraphViewEdge = { source: string; target: string };

const PALETTE = ["#2563eb", "#0d9488", "#c2410c", "#7c3aed", "#be123c", "#4d7c0f", "#0369a1", "#a16207", "#475569", "#db2777"];

/**
 * The graph drawing: an SVG the server already laid out (modules/knowledge/graph.ts).
 * The client only pans, zooms, highlights a node's neighbours and opens notes.
 */
export function GraphView({
  nodes,
  edges,
  groups,
  width,
  height,
  hrefBase,
}: {
  nodes: GraphViewNode[];
  edges: GraphViewEdge[];
  groups: string[];
  width: number;
  height: number;
  hrefBase: string;
}) {
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [active, setActive] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (!map.has(edge.source)) map.set(edge.source, new Set());
      if (!map.has(edge.target)) map.set(edge.target, new Set());
      map.get(edge.source)!.add(edge.target);
      map.get(edge.target)!.add(edge.source);
    }
    return map;
  }, [edges]);
  const near = active ? neighbours.get(active) ?? new Set<string>() : null;
  const zoom = (factor: number) => setView((v) => ({ ...v, k: Math.min(6, Math.max(0.4, v.k * factor)) }));
  const radius = (degree: number) => Math.min(12, 3 + Math.sqrt(degree) * 1.6);
  const labelled = new Set(
    [...nodes]
      .sort((a, b) => b.degree - a.degree)
      .slice(0, view.k > 1.6 ? 80 : 25)
      .map((node) => node.id),
  );
  const activeNode = active ? byId.get(active) : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" onClick={() => zoom(1.3)} className="min-h-9 rounded-md border border-line bg-white px-3 font-semibold" aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoom(1 / 1.3)} className="min-h-9 rounded-md border border-line bg-white px-3 font-semibold" aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={() => setView({ x: 0, y: 0, k: 1 })} className="min-h-9 rounded-md border border-line bg-white px-3">
          Reset
        </button>
        <span className="min-w-0 truncate text-muted">{activeNode ? `${activeNode.title} · ${activeNode.degree} links (click again to open)` : "Tap a dot to see its links; tap again to open the note. Drag to move."}</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-white">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="block h-[60vh] min-h-[320px] w-full touch-none select-none"
          role="img"
          aria-label={`Graph of ${nodes.length} notes and ${edges.length} links`}
          onWheel={(event) => zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1)}
          onPointerDown={(event) => {
            drag.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y, moved: false };
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start) return;
            const box = event.currentTarget.getBoundingClientRect();
            const scale = width / box.width / view.k;
            const dx = (event.clientX - start.x) * scale;
            const dy = (event.clientY - start.y) * scale;
            if (Math.abs(dx) + Math.abs(dy) > 3) start.moved = true;
            setView((v) => ({ ...v, x: start.vx + dx, y: start.vy + dy }));
          }}
          onPointerUp={() => {
            if (drag.current && !drag.current.moved) setActive(null);
            drag.current = null;
          }}
          onPointerLeave={() => {
            drag.current = null;
          }}
        >
          <g transform={`translate(${width / 2} ${height / 2}) scale(${view.k}) translate(${-width / 2 + view.x} ${-height / 2 + view.y})`}>
            {edges.map((edge) => {
              const a = byId.get(edge.source);
              const b = byId.get(edge.target);
              if (!a || !b) return null;
              const lit = active && (edge.source === active || edge.target === active);
              return (
                <line
                  key={`${edge.source}-${edge.target}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={lit ? "#1d4ed8" : "#cbd5e1"}
                  strokeOpacity={active && !lit ? 0.25 : 0.8}
                  strokeWidth={(lit ? 1.6 : 0.8) / view.k}
                />
              );
            })}
            {nodes.map((node) => {
              const dim = near && node.id !== active && !near.has(node.id);
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x} ${node.y})`}
                  className="cursor-pointer"
                  onPointerUp={(event) => {
                    if (drag.current?.moved) return;
                    event.stopPropagation();
                    drag.current = null;
                    if (active === node.id) window.location.href = `${hrefBase}/${node.id}`;
                    else setActive(node.id);
                  }}
                >
                  <title>{node.title}</title>
                  <circle r={radius(node.degree) / Math.sqrt(view.k)} fill={PALETTE[node.group % PALETTE.length]} fillOpacity={dim ? 0.2 : 0.9} stroke="#fff" strokeWidth={1 / view.k} />
                  {labelled.has(node.id) || node.id === active || near?.has(node.id) ? (
                    <text
                      x={(radius(node.degree) + 3) / Math.sqrt(view.k)}
                      y={3 / view.k}
                      fontSize={11 / view.k}
                      fill={dim ? "#94a3b8" : "#0f172a"}
                      style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3 / view.k }}
                    >
                      {node.title.length > 40 ? `${node.title.slice(0, 38)}…` : node.title}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Colours by top folder">
        {groups.map((group, index) => (
          <li key={group} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: PALETTE[index % PALETTE.length] }} aria-hidden />
            {group}
          </li>
        ))}
      </ul>
    </div>
  );
}
