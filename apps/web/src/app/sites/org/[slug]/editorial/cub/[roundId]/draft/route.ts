import { tenantDb } from "@pubcommand/db";
import { calendarPage, UUID } from "@/features/calendar/context";
import { fileResponse } from "@/features/calendar/cub";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; roundId: string }> }) {
  const { slug, roundId } = await params;
  const ctx = await calendarPage(slug);
  if (!ctx || !UUID.test(roundId)) return new Response("Not found", { status: 404 });
  const round = await tenantDb(ctx.resolved.id).calendarCubRound.findFirst({ where: { id: roundId, brandId: ctx.brand.id }, select: { draftData: true, draftMime: true, draftFilename: true } });
  if (!round) return new Response("Not found", { status: 404 });
  return fileResponse(round.draftData, round.draftMime, round.draftFilename);
}
