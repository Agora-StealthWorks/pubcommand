import { tenantDb } from "@pubcommand/db";
import { calendarPage, UUID } from "@/features/calendar/context";
import { fileResponse } from "@/features/calendar/cub";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; roundId: string; reviewId: string }> }) {
  const { slug, roundId, reviewId } = await params;
  const ctx = await calendarPage(slug);
  if (!ctx || !UUID.test(roundId) || !UUID.test(reviewId)) return new Response("Not found", { status: 404 });
  const db = tenantDb(ctx.resolved.id);
  const round = await db.calendarCubRound.findFirst({ where: { id: roundId, brandId: ctx.brand.id }, select: { id: true } });
  const review = round ? await db.calendarCubReview.findFirst({ where: { id: reviewId, roundId: round.id }, select: { data: true, mimeType: true, filename: true, reviewerName: true } }) : null;
  if (!review) return new Response("Not found", { status: 404 });
  return fileResponse(review.data, review.mimeType, `${review.reviewerName} - ${review.filename}`);
}
