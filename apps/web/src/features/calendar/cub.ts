import { randomBytes } from "node:crypto";
import { resolveOrgBySlug, tenantDb } from "@pubcommand/db";
import { zipSync } from "fflate";
import { averageScores, isToken, safeFilename, zipEntryNames } from "../../../../../modules/editorial/cub";
import { currentRequest } from "@/lib/request";

export function newToken(): string {
  return randomBytes(16).toString("hex");
}

export const MAX_CUB_FILE_BYTES = 50 * 1024 * 1024;

/** Public links live on the organization's own host under /p/ (see middleware). */
export async function cubLinks(round: { reviewToken: string; ownerToken: string }) {
  const request = await currentRequest();
  return { review: `${request.origin}/p/cub/r/${round.reviewToken}`, owner: `${request.origin}/p/cub/o/${round.ownerToken}` };
}

/**
 * Find a round from a public token. The organization comes from the host the
 * link was opened on (the slug), so a token only works on its own organization.
 */
export async function roundByToken(slug: string, kind: "review" | "owner", token: string) {
  if (!isToken(token)) return null;
  const org = await resolveOrgBySlug(slug);
  if (!org || org.suspendedAt || org.redirected) return null;
  const db = tenantDb(org.id);
  const round = await db.calendarCubRound.findFirst({
    where: kind === "review" ? { reviewToken: token } : { ownerToken: token },
    select: { id: true, organizationId: true, brandId: true, promoName: true, instructions: true, draftFilename: true, draftSize: true, dueAt: true, closedAt: true, reviewToken: true, ownerToken: true, createdAt: true },
  });
  if (!round) return null;
  const brand = await db.brand.findFirst({ where: { id: round.brandId }, select: { name: true } });
  return { round, organization: org, brandName: brand?.name ?? org.name };
}

export async function roundReviews(organizationId: string, roundId: string) {
  const reviews = await tenantDb(organizationId).calendarCubReview.findMany({
    where: { roundId },
    orderBy: { submittedAt: "asc" },
    select: { id: true, reviewerName: true, filename: true, size: true, submittedAt: true, comments: true, scoreHeadline: true, scoreStory: true, scoreOffer: true, scoreOverall: true },
  });
  // Scores leave this function only as averages; rows carry names and files, never scores.
  return {
    averages: averageScores(reviews),
    reviews: reviews.map(({ scoreHeadline: _a, scoreStory: _b, scoreOffer: _c, scoreOverall: _d, ...rest }) => rest),
  };
}

export function fileResponse(data: Uint8Array, mime: string, filename: string): Response {
  return new Response(Buffer.from(data), {
    headers: {
      "content-type": mime || "application/octet-stream",
      "content-length": String(data.byteLength),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/** Every revision of a round as one zip, named "<reviewer> - <file>". Files are stored, not recompressed. */
export async function roundZip(organizationId: string, round: { id: string; promoName: string }): Promise<Response> {
  const reviews = await tenantDb(organizationId).calendarCubReview.findMany({ where: { roundId: round.id }, orderBy: { submittedAt: "asc" }, select: { reviewerName: true, filename: true, data: true } });
  const names = zipEntryNames(reviews);
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  reviews.forEach((r, i) => {
    entries[names[i]!] = [new Uint8Array(r.data), { level: 0 }];
  });
  const zip = zipSync(entries);
  return fileResponse(zip, "application/zip", `${safeFilename(round.promoName, "cub")} revisions.zip`);
}
