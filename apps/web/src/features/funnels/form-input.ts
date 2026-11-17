import { tenantDb } from "@pubcommand/db";
import { isHexColor, isHttpUrl } from "../../../../../modules/funnels/checks";
import { zonedLocalToUtc } from "../../../../../modules/funnels/time";

/** Small readers for FormData in server actions. Everything is trimmed and length-capped. */
export function text(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

export function optional(formData: FormData, key: string, max = 300): string | null {
  return text(formData, key, max) || null;
}

export function bool(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === "on" || value === "true" || value === "1";
}

export function int(formData: FormData, key: string, fallback: number, min: number, max: number): number {
  const value = Number(text(formData, key, 20));
  if (!Number.isFinite(value) || text(formData, key, 20) === "") return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function optionalInt(formData: FormData, key: string, min: number, max: number): number | null {
  const raw = text(formData, key, 20);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : null;
}

export function url(formData: FormData, key: string): string | null {
  const value = text(formData, key, 1000);
  return isHttpUrl(value) ? value : null;
}

export function color(formData: FormData, key: string, fallback: string): string {
  const value = text(formData, key, 7);
  return isHexColor(value) ? value.toLowerCase() : fallback;
}

/** A datetime-local value typed in the org time zone, stored as UTC. */
export function zoned(formData: FormData, key: string, timeZone: string): Date | null {
  return zonedLocalToUtc(text(formData, key, 20), timeZone);
}

export function pickOne<T extends string>(formData: FormData, key: string, allowed: readonly T[], fallback: T): T {
  const value = text(formData, key, 40);
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const ICON_TYPES = new Set(["image/x-icon", "image/vnd.microsoft.icon"]);
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/**
 * Store an uploaded image (logo or thumbnail) in Postgres. SVG is refused: it
 * would be served from the org host and can carry script.
 */
export async function storeImage(organizationId: string, ownerId: string, kind: "logo" | "thumb" | "favicon", file: FormDataEntryValue | null): Promise<{ id: string } | { error: string } | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  const icon = kind === "favicon" && ICON_TYPES.has(file.type);
  if (!IMAGE_TYPES.has(file.type) && !icon) return { error: kind === "favicon" ? "Favicons must be PNG, ICO, JPG, WebP or GIF." : "Images must be PNG, JPG, WebP or GIF." };
  if (kind === "favicon" && file.size > 512 * 1024) return { error: "Favicons must be 512 KB or smaller." };
  if (file.size > MAX_IMAGE_BYTES) return { error: "Images must be 3 MB or smaller." };
  const asset = await tenantDb(organizationId).funnelAsset.create({
    data: {
      organizationId,
      ownerId,
      kind,
      filename: file.name.slice(0, 200) || `${kind}.png`,
      mimeType: file.type,
      size: file.size,
      data: new Uint8Array(await file.arrayBuffer()),
    },
    select: { id: true },
  });
  return asset;
}
