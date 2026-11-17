import { Prisma, tenantDb } from "@pubcommand/db";
import {
  LANDING_MAX_BYTES,
  LANDING_REUSE_MS,
  LANDING_TIMEOUT_MS,
  checkUrlShape,
  decodeHtmlBytes,
  isHtmlContentType,
  parseLandingHtml,
  type EmailLink,
} from "../../../../../modules/intel/index";
import { fetchPublic } from "./net";

export type LandingRow = {
  id: string;
  url: string;
  finalUrl: string | null;
  status: string;
  title: string | null;
  description: string | null;
  headings: string[];
  text: string;
  links: EmailLink[];
  error: string | null;
  fetchedAt: Date;
};

const SELECT = { id: true, url: true, finalUrl: true, status: true, title: true, description: true, headings: true, text: true, links: true, error: true, fetchedAt: true } as const;

function asRow(row: Omit<LandingRow, "links"> & { links: unknown }): LandingRow {
  return { ...row, links: Array.isArray(row.links) ? (row.links as EmailLink[]) : [] };
}

export async function loadLanding(organizationId: string, id: string | null): Promise<LandingRow | null> {
  if (!id) return null;
  const row = await tenantDb(organizationId).intelLandingPage.findFirst({ where: { id }, select: SELECT });
  return row ? asRow(row) : null;
}

/** Store (or refresh) one landing page row for a brand, keyed by the requested URL. */
async function saveLanding(organizationId: string, brandId: string, url: string, data: Omit<Prisma.IntelLandingPageUncheckedCreateInput, "organizationId" | "brandId" | "url">): Promise<string> {
  const db = tenantDb(organizationId);
  const existing = await db.intelLandingPage.findFirst({ where: { brandId, url }, select: { id: true } });
  if (existing) {
    await db.intelLandingPage.updateMany({ where: { id: existing.id }, data });
    return existing.id;
  }
  try {
    return (await db.intelLandingPage.create({ data: { organizationId, brandId, url, ...data }, select: { id: true } })).id;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    const row = await db.intelLandingPage.findFirst({ where: { brandId, url }, select: { id: true } });
    await db.intelLandingPage.updateMany({ where: { id: row!.id }, data });
    return row!.id;
  }
}

/**
 * Fetch a landing page (text only) through the SSRF guard and store it.
 * A page fetched in the last week is reused unless `force` is set. Never throws.
 */
export async function captureLanding(input: { organizationId: string; brandId: string; url: string; force?: boolean }): Promise<LandingRow | null> {
  const shape = checkUrlShape(input.url);
  if (!shape.ok) return null;
  const url = shape.url.toString().slice(0, 2000);
  const db = tenantDb(input.organizationId);
  if (!input.force) {
    const recent = await db.intelLandingPage.findFirst({ where: { brandId: input.brandId, url, status: "OK", fetchedAt: { gt: new Date(Date.now() - LANDING_REUSE_MS) } }, select: SELECT });
    if (recent) return asRow(recent);
  }
  let data: Omit<Prisma.IntelLandingPageUncheckedCreateInput, "organizationId" | "brandId" | "url">;
  try {
    const result = await fetchPublic(url, { maxBytes: LANDING_MAX_BYTES, timeoutMs: LANDING_TIMEOUT_MS });
    if (!result.ok) {
      data = { status: "FAILED", error: result.reason.slice(0, 500), finalUrl: result.finalUrl ?? null, httpStatus: result.status ?? null, fetchedAt: new Date() };
    } else if (result.status >= 400) {
      data = { status: "FAILED", error: `The page answered ${result.status}.`, finalUrl: result.finalUrl, httpStatus: result.status, fetchedAt: new Date() };
    } else if (!isHtmlContentType(result.contentType)) {
      data = { status: "FAILED", error: `Not a web page (${result.contentType.split(";")[0]}).`, finalUrl: result.finalUrl, httpStatus: result.status, fetchedAt: new Date() };
    } else {
      data = landingData(decodeHtmlBytes(result.body, result.contentType), result.finalUrl, result.status, result.truncated);
    }
  } catch (error) {
    data = { status: "FAILED", error: (error instanceof Error ? error.message : "The page could not be fetched.").slice(0, 500), fetchedAt: new Date() };
  }
  const id = await saveLanding(input.organizationId, input.brandId, url, data);
  return loadLanding(input.organizationId, id);
}

function landingData(html: string, finalUrl: string, httpStatus: number | null, truncated: boolean) {
  const page = parseLandingHtml(html, finalUrl);
  return {
    status: "OK",
    error: truncated ? "The page was larger than 3 MB; only the start was read." : null,
    finalUrl,
    httpStatus,
    title: page.title,
    description: page.description,
    headings: page.headings,
    text: page.text,
    links: page.links as unknown as Prisma.InputJsonValue,
    fetchedAt: new Date(),
  };
}

/** Store a page we already fetched (the video capture reads the page to find its player). */
export async function storeLandingHtml(input: { organizationId: string; brandId: string; url: string; finalUrl: string; html: string }): Promise<LandingRow | null> {
  const shape = checkUrlShape(input.url);
  if (!shape.ok) return null;
  const id = await saveLanding(input.organizationId, input.brandId, shape.url.toString().slice(0, 2000), landingData(input.html, input.finalUrl, 200, false));
  return loadLanding(input.organizationId, id);
}

/** Fetch an email's landing page and link it. Returns the row, or null when there is no landing URL. */
export async function captureEmailLanding(input: { organizationId: string; brandId: string; emailId: string; force?: boolean }): Promise<LandingRow | null> {
  const db = tenantDb(input.organizationId);
  const email = await db.intelEmail.findFirst({ where: { id: input.emailId, brandId: input.brandId, deletedAt: null }, select: { id: true, landingUrl: true, extraction: true } });
  const extracted = (email?.extraction as { landingUrl?: string | null } | null)?.landingUrl ?? null;
  const url = extracted ?? email?.landingUrl ?? null;
  if (!email || !url) return null;
  const row = await captureLanding({ organizationId: input.organizationId, brandId: input.brandId, url, force: input.force });
  if (row) await db.intelEmail.updateMany({ where: { id: email.id }, data: { landingPageId: row.id } });
  return row;
}
