export const RESERVED_SLUGS = [
  "www",
  "app",
  "admin",
  "api",
  "platform",
  "mail",
  "status",
  "docs",
  "help",
  "billing",
  "auth",
  "static",
  "cdn",
] as const;

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export type SlugValidation = { ok: true; slug: string } | { ok: false; reason: "invalid" | "reserved" };

export function validateSlug(input: string): SlugValidation {
  const slug = input.trim().toLowerCase();
  if (!SLUG_PATTERN.test(slug)) return { ok: false, reason: "invalid" };
  if ((RESERVED_SLUGS as readonly string[]).includes(slug)) return { ok: false, reason: "reserved" };
  return { ok: true, slug };
}

export function slugifyName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
