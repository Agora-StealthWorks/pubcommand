import { rawPrisma } from "@pubcommand/db";
import type { AppCardSettings } from "@/lib/apps";

/** Card artwork staff may upload. SVG is not accepted: uploads are served as-is. */
export const APP_CARD_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const APP_CARD_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Staff settings for every app card (Admin → App cards), without the image bytes. Never throws:
 * if the table can't be read, dashboards fall back to the built-in cards.
 */
export async function loadAppCardSettings(): Promise<AppCardSettings> {
  try {
    const rows = await rawPrisma().appCard.findMany({
      select: { moduleId: true, name: true, onDashboard: true, position: true, imageMime: true, updatedAt: true },
    });
    return Object.fromEntries(
      rows.map((row) => [
        row.moduleId,
        { name: row.name, onDashboard: row.onDashboard, position: row.position, imageVersion: row.imageMime ? row.updatedAt.getTime() : null },
      ]),
    );
  } catch (error) {
    console.error(`[app-cards] could not load card settings, using defaults: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

export async function saveAppCard(input: {
  moduleId: string;
  actorId: string;
  data: { name?: string | null; onDashboard?: boolean | null; position?: number | null; imageMime?: string | null; imageData?: Uint8Array | null };
}): Promise<void> {
  const { imageData, ...fields } = input.data;
  const bytes = imageData === undefined ? {} : { imageData: imageData ? new Uint8Array(imageData) : null };
  await rawPrisma().appCard.upsert({
    where: { moduleId: input.moduleId },
    create: { moduleId: input.moduleId, ...fields, ...bytes, updatedById: input.actorId },
    update: { ...fields, ...bytes, updatedById: input.actorId },
  });
}

/** Writes every listed app's position (0, 1, 2… in the given order) in one transaction. */
export async function saveAppCardOrder(input: { moduleIds: string[]; actorId: string }): Promise<void> {
  await rawPrisma().$transaction(
    input.moduleIds.map((moduleId, position) =>
      rawPrisma().appCard.upsert({
        where: { moduleId },
        create: { moduleId, position, updatedById: input.actorId },
        update: { position, updatedById: input.actorId },
      }),
    ),
  );
}

export async function readAppCardImage(moduleId: string): Promise<{ mime: string; data: Uint8Array } | null> {
  const row = await rawPrisma().appCard.findUnique({ where: { moduleId }, select: { imageMime: true, imageData: true } });
  return row?.imageMime && row.imageData ? { mime: row.imageMime, data: row.imageData } : null;
}

/** The image type from the file's first bytes (not its name or the browser's claim), or null. */
export function sniffCardImage(bytes: Uint8Array): (typeof APP_CARD_IMAGE_TYPES)[number] | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
