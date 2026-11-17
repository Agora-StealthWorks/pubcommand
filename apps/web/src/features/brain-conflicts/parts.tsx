import { Badge } from "@pubcommand/ui";
import Link from "next/link";
import { factLabel } from "../../../../../modules/knowledge/conflicts";
import type { Names } from "../main-brain/parts";
import { RESOLUTION_LABELS, type ConflictRow } from "./queries";

export function kindLabel(kind: string): string {
  return kind === "editor" ? "Editor" : "Publication";
}

export function placeText(names: Names, organizationId: string, brandId: string): string {
  return [names.orgs.get(organizationId)?.name ?? "Deleted organization", names.brands.get(brandId)?.name ?? "Deleted brand"].join(" · ");
}

export function ConflictStatusBadge({ status, resolution }: { status: string; resolution: string | null }) {
  if (status === "OPEN" && resolution === "setup-to-fix") return <Badge tone="warn">Waiting on Setup</Badge>;
  if (status === "OPEN") return <Badge tone="danger">Open</Badge>;
  if (status === "DISMISSED") return <Badge tone="neutral">Dismissed</Badge>;
  return <Badge tone="ok">{resolution === "cleared" ? "Cleared" : "Resolved"}</Badge>;
}

export function LayerBadge({ layer, confidence }: { layer: string; confidence: number }) {
  return (
    <Badge tone={layer === "ai" ? "accent" : "neutral"}>
      {layer === "ai" ? "AI" : "Rule"} · {Math.round(confidence * 100)}%
    </Badge>
  );
}

export function resolutionText(resolution: string | null): string | null {
  return resolution ? (RESOLUTION_LABELS[resolution] ?? resolution) : null;
}

/** One conflict as a card: the Setup fact next to what the note says. */
export function ConflictCard({ row, names, showEntity = true }: { row: ConflictRow; names: Names; showEntity?: boolean }) {
  return (
    <li className="min-w-0">
      <Link href={`/brain/conflicts/${row.id}`} className="block rounded-xl border border-line bg-white p-4 hover:border-accent">
        <span className="flex flex-wrap items-center gap-2">
          {showEntity ? <span className="min-w-0 break-words text-sm font-semibold text-ink">{row.check.entityName}</span> : null}
          {showEntity ? <Badge tone="neutral">{kindLabel(row.entityKind)}</Badge> : null}
          <span className="text-sm font-semibold text-ink">{factLabel(row.factKey)}</span>
          <ConflictStatusBadge status={row.status} resolution={row.resolution} />
          <LayerBadge layer={row.layer} confidence={row.confidence} />
        </span>
        <span className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <span className="min-w-0 rounded-md bg-[#ecfdf3] px-3 py-2">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[#067647]">Publication Setup</span>
            <span className="block break-words">{row.factValue}</span>
          </span>
          <span className="min-w-0 rounded-md bg-[#fef3f2] px-3 py-2">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[#b42318]">Brain says</span>
            <span className="block break-words">{row.noteSays}</span>
          </span>
        </span>
        <span className="mt-2 block break-words text-sm text-muted">“{row.quote.length > 220 ? `${row.quote.slice(0, 220)}…` : row.quote}”</span>
        <span className="mt-1 block break-words text-xs text-muted">
          {[`Note: ${row.noteTitle}`, showEntity ? placeText(names, row.entityOrganizationId, row.entityBrandId) : null, resolutionText(row.resolution)].filter(Boolean).join(" · ")}
        </span>
      </Link>
    </li>
  );
}

export function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  const inner = (
    <>
      <p className="text-xl font-semibold tabular-nums">{value.toLocaleString()}</p>
      <p className="text-xs text-muted">{label}</p>
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-lg border border-line bg-white px-3 py-2 hover:border-accent">
      {inner}
    </Link>
  ) : (
    <div className="rounded-lg border border-line bg-white px-3 py-2">{inner}</div>
  );
}
