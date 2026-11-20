import { tenantDb } from "@pubcommand/db";
import { calendarPage, UUID } from "@/features/calendar/context";
import { roundZip } from "@/features/calendar/cub";
import { CUB_COLLECTOR_ENABLED } from "../../../../../../../../../../../modules/editorial/features";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; roundId: string }> }) {
  if (!CUB_COLLECTOR_ENABLED) return new Response("Not found", { status: 404 });
  const { slug, roundId } = await params;
  const ctx = await calendarPage(slug);
  if (!ctx || !UUID.test(roundId)) return new Response("Not found", { status: 404 });
  const round = await tenantDb(ctx.resolved.id).calendarCubRound.findFirst({ where: { id: roundId, brandId: ctx.brand.id }, select: { id: true, promoName: true } });
  if (!round) return new Response("Not found", { status: 404 });
  return roundZip(ctx.resolved.id, round);
}
