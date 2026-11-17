import { tenantDb } from "@pubcommand/db";
import { smsConsentText } from "../../../../../modules/funnels/sms";
import { UUID_RE } from "./data";

type Db = ReturnType<typeof tenantDb>;
export type SmsFormRow = NonNullable<Awaited<ReturnType<Db["funnelSmsForm"]["findFirst"]>>>;

/** An SMS form id only if this funnel owns that form. */
export async function ownSmsFormId(organizationId: string, funnelId: string, wanted: string | null | undefined): Promise<string | null> {
  if (!wanted || !UUID_RE.test(wanted)) return null;
  const form = await tenantDb(organizationId).funnelSmsForm.findFirst({ where: { id: wanted, funnelId }, select: { id: true } });
  return form?.id ?? null;
}

export async function listSmsForms(organizationId: string, funnelId: string): Promise<SmsFormRow[]> {
  return tenantDb(organizationId).funnelSmsForm.findMany({ where: { funnelId }, orderBy: { createdAt: "asc" } });
}

/** The exact consent text this form shows (and stores with each opt-in). */
export function formConsent(form: SmsFormRow): string {
  return smsConsentText(form);
}
