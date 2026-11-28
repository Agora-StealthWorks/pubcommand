import type { Prisma } from "@pubcommand/db";
import { decryptToken, encryptToken, isSlackWebhookUrl } from "../../../../../modules/intel/index";
import { authSecret } from "../intel/gmail";
import { ispyDb } from "./db";

export type IspySettings = {
  slackWebhookEnc: string | null;
  digestEmails: string[];
  dailyDigest: boolean;
  weeklyTrends: boolean;
  silenceDays: number;
  /** Signing secret of the MachineMail webhook ISpy registered (encrypted). */
  machineMailWebhookSecretEnc: string | null;
};

const DEFAULTS: IspySettings = { slackWebhookEnc: null, digestEmails: [], dailyDigest: true, weeklyTrends: true, silenceDays: 7, machineMailWebhookSecretEnc: null };
const KEY = "settings";

export async function readIspySettings(): Promise<IspySettings> {
  const row = await ispyDb((tx) => tx.ispySetting.findUnique({ where: { key: KEY } }));
  return { ...DEFAULTS, ...((row?.value as Partial<IspySettings> | undefined) ?? {}) };
}

export async function writeIspySettings(patch: Partial<IspySettings>): Promise<void> {
  const next = { ...(await readIspySettings()), ...patch };
  await ispyDb((tx) => tx.ispySetting.upsert({ where: { key: KEY }, create: { key: KEY, value: next as unknown as Prisma.InputJsonValue }, update: { value: next as unknown as Prisma.InputJsonValue } }));
}

export function sealSecret(value: string): string {
  return encryptToken(value, authSecret());
}

export function openSecret(value: string | null): string | null {
  if (!value) return null;
  try {
    return decryptToken(value, authSecret());
  } catch {
    return null;
  }
}

export { isSlackWebhookUrl };
