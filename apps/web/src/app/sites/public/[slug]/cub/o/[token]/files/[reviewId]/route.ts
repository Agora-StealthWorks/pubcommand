import { tenantDb } from "@pubcommand/db";
import { UUID } from "@/features/calendar/context";
import { fileResponse, roundByToken } from "@/features/calendar/cub";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; token: string; reviewId: string }> }) {
  const { slug, token, reviewId } = await params;
  const found = UUID.test(reviewId) ? await roundByToken(slug, "owner", token) : null;
  if (!found) return new Response("Not found", { status: 404 });
  const review = await tenantDb(found.organization.id).calendarCubReview.findFirst({ where: { id: reviewId, roundId: found.round.id }, select: { data: true, mimeType: true, filename: true, reviewerName: true } });
  if (!review) return new Response("Not found", { status: 404 });
  return fileResponse(review.data, review.mimeType, `${review.reviewerName} - ${review.filename}`);
}
