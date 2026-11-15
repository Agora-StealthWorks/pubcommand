export const BODY_EXCERPT_LIMIT = 180;

/** Collapse whitespace and keep a short excerpt. The full body is not stored. */
export function excerptBody(body: string, limit = BODY_EXCERPT_LIMIT): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, Math.max(0, limit - 1))}…`;
}
