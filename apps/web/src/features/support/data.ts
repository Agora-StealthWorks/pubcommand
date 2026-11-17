import { tenantDb } from "@pubcommand/db";

/** The brand's Support Knowledge settings row, created on first use. */
export async function ensureSettings(organizationId: string, brandId: string) {
  const db = tenantDb(organizationId);
  const existing = await db.supportSettings.findFirst({ where: { brandId } });
  if (existing) return existing;
  try {
    return await db.supportSettings.create({ data: { organizationId, brandId } });
  } catch {
    // A parallel request created it first.
    const row = await db.supportSettings.findFirst({ where: { brandId } });
    if (!row) throw new Error("Could not create Support Knowledge settings.");
    return row;
  }
}

export async function recordCounts(organizationId: string, brandId: string) {
  const db = tenantDb(organizationId);
  const [published, draft, archived, gaps, proposals] = await Promise.all([
    db.supportRecord.count({ where: { brandId, status: "published" } }),
    db.supportRecord.count({ where: { brandId, status: "draft" } }),
    db.supportRecord.count({ where: { brandId, status: "archived" } }),
    db.supportGap.count({ where: { brandId, status: "open" } }),
    db.supportProposal.count({ where: { brandId, status: "pending" } }),
  ]);
  return { published, draft, archived, gaps, proposals };
}

export function fmtDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}
