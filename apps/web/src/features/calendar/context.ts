import { can } from "@pubcommand/core";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";

export type CalendarPermission = "editorial.read" | "editorial.write";

/** Context for a server action or route: entitled, permitted, with a brand. Redirects otherwise. */
export async function calendarAction(permission: CalendarPermission, back = "/editorial") {
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/");
  const ctx = await getOrgContext(request.site.slug);
  if (ctx.kind !== "ok") redirect("/");
  if (!ctx.subject.entitledModuleIds.includes("editorial") || !can(ctx.subject, permission, ctx.scope)) {
    redirect(withMessage(back, "error", "You do not have permission."));
  }
  if (!ctx.brand) redirect(withMessage(back, "error", "Add a brand in Settings first."));
  return { ...ctx, brand: ctx.brand, actorId: ctx.auth.user.id };
}

export type CalendarCtx = Awaited<ReturnType<typeof calendarAction>>;

/** For pages and route handlers: null when the viewer may not read the calendar. */
export async function calendarPage(slug: string) {
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok" || !ctx.brand) return null;
  if (!ctx.subject.entitledModuleIds.includes("editorial") || !can(ctx.subject, "editorial.read", ctx.scope)) return null;
  return { ...ctx, brand: ctx.brand, canWrite: can(ctx.subject, "editorial.write", ctx.scope) };
}

export function withMessage(path: string, key: "error" | "notice", message: string): string {
  // Keep a #fragment at the end, where browsers read it (not inside the query).
  const hashAt = path.indexOf("#");
  const base = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const hash = hashAt >= 0 ? path.slice(hashAt) : "";
  return `${base}${base.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}${hash}`;
}

export function field(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

export function optional(formData: FormData, key: string, max = 300): string | null {
  return field(formData, key, max) || null;
}

export function list(formData: FormData, key: string, max = 1000): string[] {
  const values = formData.getAll(key).map((v) => String(v));
  const joined = values.length > 1 ? values : String(values[0] ?? "").split(/[,\n]/);
  return [...new Set(joined.map((v) => v.trim().slice(0, 120)).filter(Boolean))].slice(0, 40).filter((v) => v.length <= max);
}

export function int(formData: FormData, key: string): number | null {
  const raw = field(formData, key, 20).replace(/[,\s]/g, "");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export function money(formData: FormData, key: string): number | null {
  const raw = field(formData, key, 20).replace(/[$,\s]/g, "");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export function url(formData: FormData, key: string): string | null {
  const raw = field(formData, key, 1000);
  if (!raw) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function time(formData: FormData, key: string): string | null {
  const raw = field(formData, key, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : null;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
