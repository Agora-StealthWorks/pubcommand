import { Prisma, tenantDb } from "@pubcommand/db";

export type IntelSettingsRow = {
  id: string;
  digestEnabled: boolean;
  slackWebhookEnc: string | null;
  digestEmails: string[];
  autoLanding: boolean;
  lastDigestWeek: Date | null;
  lastDigestAt: Date | null;
  lastDigestError: string | null;
};

const SELECT = { id: true, digestEnabled: true, slackWebhookEnc: true, digestEmails: true, autoLanding: true, lastDigestWeek: true, lastDigestAt: true, lastDigestError: true } as const;

const DEFAULTS: Omit<IntelSettingsRow, "id"> = { digestEnabled: false, slackWebhookEnc: null, digestEmails: [], autoLanding: true, lastDigestWeek: null, lastDigestAt: null, lastDigestError: null };

/** The brand's settings, or the defaults when nothing was saved yet (never creates a row). */
export async function readSettings(organizationId: string, brandId: string): Promise<IntelSettingsRow> {
  const row = await tenantDb(organizationId).intelSettings.findFirst({ where: { brandId }, select: SELECT });
  return row ?? { id: "", ...DEFAULTS };
}

/** Save settings for a brand, creating the row on first save. */
export async function writeSettings(organizationId: string, brandId: string, data: Partial<Omit<IntelSettingsRow, "id">>): Promise<void> {
  const db = tenantDb(organizationId);
  const updated = await db.intelSettings.updateMany({ where: { brandId }, data });
  if (updated.count) return;
  try {
    await db.intelSettings.create({ data: { organizationId, brandId, ...data } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    await db.intelSettings.updateMany({ where: { brandId }, data });
  }
}
