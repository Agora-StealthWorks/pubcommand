import type { RuleCondition } from "../../../../../modules/ispy/index";

/** Form helpers shared by the ISpy console actions and pages. */

export function text(formData: FormData, name: string, max = 500): string {
  return String(formData.get(name) ?? "").trim().slice(0, max);
}

export function optional(formData: FormData, name: string, max = 500): string | null {
  const value = text(formData, name, max);
  return value ? value : null;
}

/** "a, b\nc" → ["a","b","c"] (lower-cased when asked). */
export function list(formData: FormData, name: string, options: { lower?: boolean; max?: number } = {}): string[] {
  const raw = String(formData.get(name) ?? "");
  const items = raw
    .split(/[\n,]+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => (options.lower ? v.toLowerCase() : v));
  return [...new Set(items)].slice(0, options.max ?? 200);
}

export function checked(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === "on" || value === "true" || value === "1";
}

export function uuidOrNull(value: unknown): string | null {
  const v = String(value ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
}

/** Read the console's condition rows (cond_field_i / cond_op_i / cond_value_i) back from a form. */
export function readConditionRows(formData: FormData | URLSearchParams, prefix = "cond"): RuleCondition[] {
  const out: RuleCondition[] = [];
  for (let i = 0; i < 6; i += 1) {
    const field = String(formData.get(`${prefix}_field_${i}`) ?? "");
    const op = String(formData.get(`${prefix}_op_${i}`) ?? "");
    let value = String(formData.get(`${prefix}_value_${i}`) ?? "").trim();
    if (!value) continue;
    let header: string | undefined;
    if (field === "header") {
      const m = value.match(/^([A-Za-z0-9-]+)\s*:\s*(.+)$/);
      if (m) {
        header = m[1]!.toLowerCase();
        value = m[2]!.trim();
      }
    }
    out.push({ field: field as RuleCondition["field"], op: op as RuleCondition["op"], value, ...(header ? { header } : {}) });
  }
  return out;
}

/** A safe console path to return to (only /ispy…). */
export function backPath(formData: FormData, fallback = "/ispy"): string {
  const back = String(formData.get("back") ?? "");
  return back.startsWith("/ispy") && !back.startsWith("//") ? back : fallback;
}
