import { parseSystemEmailOverrides, type SystemEmailCopy, type SystemEmailKey, type SystemEmailOverrides } from "@pubcommand/core";
import { rawPrisma } from "@pubcommand/db";

/** platform_settings key holding staff edits to PubCommand's system email copy (Admin → Emails). */
export const SYSTEM_EMAIL_COPY_KEY = "system_email_copy";

/**
 * The saved edits. Never throws: if the database can't be read, sends fall back to the
 * default copy rather than failing a sign-in or password reset.
 */
export async function loadSystemEmailOverrides(): Promise<SystemEmailOverrides> {
  try {
    const row = await rawPrisma().platformSetting.findUnique({ where: { key: SYSTEM_EMAIL_COPY_KEY } });
    return parseSystemEmailOverrides(row?.value);
  } catch (error) {
    console.error(`[system-emails] could not load edited copy, using defaults: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

/** Saves one email's copy, or removes its edits (back to the default) when `copy` is null. */
export async function saveSystemEmailCopy(input: { key: SystemEmailKey; copy: SystemEmailCopy | null; actorId: string }): Promise<void> {
  const current = await loadSystemEmailOverrides();
  const next: SystemEmailOverrides = { ...current };
  if (input.copy) next[input.key] = input.copy;
  else delete next[input.key];
  await rawPrisma().platformSetting.upsert({
    where: { key: SYSTEM_EMAIL_COPY_KEY },
    create: { key: SYSTEM_EMAIL_COPY_KEY, value: next, updatedById: input.actorId },
    update: { value: next, updatedById: input.actorId },
  });
}
