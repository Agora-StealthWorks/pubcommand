import { tenantDb } from "@pubcommand/db";
import { isHexColor, isHttpUrl } from "../../../../../modules/miniblog/site";
import { zonedLocalToUtc } from "../../../../../modules/miniblog/time";

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
  const raw = text(formData, key, 20);
  const value = Number(raw);
  if (!Number.isFinite(value) || raw === "") return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
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

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/**
 * Store an uploaded logo in Postgres. Mini-Blog logos have always lived in
 * `funnel_assets` (owner = the site id), so existing logos keep working. SVG is
 * refused: it would be served from the org host and can carry script.
 */
export async function storeLogo(organizationId: string, siteId: string, file: FormDataEntryValue | null): Promise<{ id: string } | { error: string } | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  if (!IMAGE_TYPES.has(file.type) && file.type !== "image/svg+xml") return { error: "Logos must be PNG, JPG, WebP, GIF or SVG." };
  if (file.size > MAX_IMAGE_BYTES) return { error: "Images must be 3 MB or smaller." };
  return tenantDb(organizationId).funnelAsset.create({
    data: {
      organizationId,
      ownerId: siteId,
      kind: "logo",
      filename: file.name.slice(0, 200) || "logo.png",
      mimeType: file.type,
      size: file.size,
      data: new Uint8Array(await file.arrayBuffer()),
    },
    select: { id: true },
  });
}
