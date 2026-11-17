import { Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { closePosition, deletePosition } from "@/features/trackrecord/actions";
import { trackAccess } from "@/features/trackrecord/context";
import { PositionForm } from "@/features/trackrecord/position-form";
import { FillsPanel } from "@/features/trackrecord/fills-panel";
import { positionEditorPicker } from "@/features/trackrecord/editor-profile";
import { getPortfolio, positionViews } from "@/features/trackrecord/server";
import { GainText, PriceNote, iso } from "@/features/trackrecord/ui";
import { formatPct, formatPrice } from "../../../../../../../../../../../modules/performance/gain";

export default async function PositionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; portfolioId: string; positionId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { slug, portfolioId, positionId } = await params;
  const query = await searchParams;
  const access = await trackAccess("performance.write", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const portfolio = await getPortfolio(access.scope, portfolioId);
  if (!portfolio || !/^[0-9a-f-]{36}$/i.test(positionId)) notFound();
  const [position] = await positionViews(access.scope.organizationId, { id: positionId, portfolioId: portfolio.id, brandId: access.scope.brandId }, { refresh: true });
  if (!position) notFound();
  const editors = await positionEditorPicker(access.scope, portfolio, position.editorId);
  const gain = position.gain;
  const multiLeg = position.legs.length > 1;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-3xl space-y-4">
      <Link href={`/performance/${portfolio.id}`} className="text-sm text-accent">
        ← {portfolio.name}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="break-words text-xl font-semibold">
            {position.symbol} <span className="text-sm font-normal text-muted">{position.direction === "SHORT" ? "Short" : "Long"} · {position.status === "CLOSED" ? "Closed" : "Open"}</span>
          </h2>
          {position.name ? <p className="text-sm text-muted">{position.name}</p> : null}
        </div>
        <div className="text-right">
          <GainText pct={gain.pct} className="text-2xl" />
          <PriceNote gain={gain} />
        </div>
      </div>
      <Flash error={query.error} notice={query.notice} />
      <dl className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-white p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">Entry</dt>
          <dd className="tabular-nums">
            {formatPrice(position.entryPrice)} · {iso(position.entryDate)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{position.status === "CLOSED" ? "Exit" : "Current"}</dt>
          <dd className="tabular-nums">{formatPrice(gain.current)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Best since entry</dt>
          <dd className="tabular-nums">{gain.peak ? `${formatPrice(gain.peak.price)} (${formatPct(gain.peak.pct)})` : "Not checked yet"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Splits</dt>
          <dd>{gain.splitNote ?? (position.splitSource === "unknown" ? "Entry does not match the market; check it" : "None found")}</dd>
        </div>
      </dl>
      <FillsPanel view={position} portfolioId={portfolio.id} today={today} />
      {position.status !== "CLOSED" && !multiLeg ? (
        <form action={closePosition} className="grid gap-3 rounded-xl border border-line bg-white p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <input type="hidden" name="portfolioId" value={portfolio.id} />
          <input type="hidden" name="positionId" value={position.id} />
          <div>
            <Label htmlFor="close-date">Exit date</Label>
            <Input id="close-date" name="exitDate" type="date" defaultValue={today} max={today} required />
          </div>
          <div>
            <Label htmlFor="close-price">Exit price</Label>
            <Input id="close-price" name="exitPrice" inputMode="decimal" required />
          </div>
          <Button type="submit">{position.fills.length ? "Close what is open" : "Close position"}</Button>
        </form>
      ) : null}
      <h3 className="text-sm font-semibold">Edit</h3>
      {position.fills.length ? <p className="text-xs text-muted">Entry, exit and status follow the fills above; edit the fills to change them.</p> : null}
      <PositionForm portfolioId={portfolio.id} position={position} editors={editors} />
      <form action={deletePosition} className="rounded-xl border border-[#fecdca] bg-white p-4">
        <input type="hidden" name="portfolioId" value={portfolio.id} />
        <input type="hidden" name="positionId" value={position.id} />
        <p className="mb-2 text-sm text-muted">Delete only a recommendation entered by mistake. A real losing trade stays in the internal record.</p>
        <Button type="submit" variant="danger">
          Delete recommendation
        </Button>
      </form>
    </div>
  );
}
