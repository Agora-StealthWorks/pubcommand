/**
 * The branching engine. Pure, and imported VERBATIM by the public renderer
 * (browser) and the submit route (server), so what a respondent was shown
 * and what the server requires can never disagree.
 *
 * Two mechanisms:
 *  1. Visibility: a field is shown or hidden from EARLIER answers.
 *  2. Skip logic: after a page, jump FORWARD to a later page or to submit.
 *
 * Both only ever look backwards/forwards respectively, so one forward pass
 * over the pages settles the whole form: no loops, no fixed point.
 *
 * A field that is hidden, or sits on a page the path skipped, is never
 * required and its answer is dropped. The server recomputes all of this from
 * the raw answers; nothing the browser claims about what was hidden is read.
 */
import { capturesAnswer, checkAnswer, fieldSpec, isDisplayed, isEmptyValue } from "./fields";
import type { AnswerMap, EndRule, Ending, FieldDef, FormLayout, LogicOp, LogicRule, SkipRule } from "./types";

export const LOGIC_OPS: { op: LogicOp; label: string; needsValue: boolean }[] = [
  { op: "equals", label: "is", needsValue: true },
  { op: "not_equals", label: "is not", needsValue: true },
  { op: "contains", label: "includes", needsValue: true },
  { op: "not_contains", label: "does not include", needsValue: true },
  { op: "answered", label: "is answered", needsValue: false },
  { op: "empty", label: "is empty", needsValue: false },
  { op: "gt", label: ">", needsValue: true },
  { op: "gte", label: "≥", needsValue: true },
  { op: "lt", label: "<", needsValue: true },
  { op: "lte", label: "≤", needsValue: true },
];

const OPS = new Set(LOGIC_OPS.map((item) => item.op));
export const SUBMIT_TARGET = "submit";

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === "boolean" || typeof b === "boolean") return String(a) === String(b);
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null) return na === nb;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

export function evaluateRule(rule: LogicRule, answers: AnswerMap): boolean {
  const actual = answers[rule.fieldId];
  const target = rule.value;
  switch (rule.op) {
    case "answered":
      return !isEmptyValue(actual);
    case "empty":
      return isEmptyValue(actual);
    case "equals":
      return Array.isArray(actual) ? actual.length === 1 && same(actual[0], target) : same(actual, target);
    case "not_equals":
      return !evaluateRule({ ...rule, op: "equals" }, answers);
    case "contains":
      if (Array.isArray(actual)) return actual.some((item) => same(item, target));
      if (typeof actual === "string" && target !== null && target !== undefined) {
        return actual.toLowerCase().includes(String(target).toLowerCase());
      }
      return false;
    case "not_contains":
      return !evaluateRule({ ...rule, op: "contains" }, answers);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = toNumber(actual);
      const b = toNumber(target);
      if (a === null || b === null) return false;
      if (rule.op === "gt") return a > b;
      if (rule.op === "gte") return a >= b;
      if (rule.op === "lt") return a < b;
      return a <= b;
    }
    default:
      return false;
  }
}

export function fieldVisible(field: FieldDef, answers: AnswerMap): boolean {
  const visibility = field.visibility;
  if (!visibility || !Array.isArray(visibility.rules) || visibility.rules.length === 0) return true;
  const results = visibility.rules.map((rule) => evaluateRule(rule, answers));
  const matched = visibility.match === "any" ? results.some(Boolean) : results.every(Boolean);
  return visibility.action === "show" ? matched : !matched;
}

export type Page = { id: string; index: number; fieldIds: string[] };

/**
 * Split fields into pages.
 * - paginated: one question per page. Statements ride along with the next
 *   question, and "group with next" keeps a contact block on one page.
 * - single: everything on one page, split only at page breaks.
 * Hidden (UTM) fields and page breaks are never on a page.
 * A page's id is the id of its first field, so skip targets survive reordering.
 */
export function buildPages(fields: readonly FieldDef[], layout: FormLayout): Page[] {
  const pages: Page[] = [];
  let current: string[] = [];
  let hasQuestion = false;
  let glue = false;
  const flush = () => {
    if (current.length) pages.push({ id: current[0]!, index: pages.length, fieldIds: current });
    current = [];
    hasQuestion = false;
  };
  for (const field of fields) {
    if (field.type === "page_break") {
      flush();
      glue = false;
      continue;
    }
    if (!isDisplayed(field.type)) continue;
    if (layout === "paginated" && hasQuestion && !glue) flush();
    current.push(field.id);
    if (capturesAnswer(field.type)) hasQuestion = true;
    glue = field.groupWithNext;
  }
  flush();
  return pages;
}

export type FormState = {
  pages: Page[];
  /** Page indexes the respondent will pass through, in order, given these answers. */
  path: number[];
  /** Fields shown on pages on the path. */
  visibleIds: Set<string>;
  /** Answers with hidden/skipped fields removed. Hidden (UTM) fields are kept. */
  effective: AnswerMap;
};

/**
 * Walk the form forward from page 0 with these answers. Visibility only looks
 * at answers already collected on the walk, skip logic only jumps forward, so
 * a crafted rule pointing at a later field or an earlier page has no effect.
 */
export function resolveForm(fields: readonly FieldDef[], layout: FormLayout, answers: AnswerMap): FormState {
  const pages = buildPages(fields, layout);
  const byId = new Map(fields.map((field) => [field.id, field]));
  const effective: AnswerMap = {};
  for (const field of fields) {
    if (field.type === "hidden" && answers[field.id] !== undefined) effective[field.id] = answers[field.id];
  }
  const visibleIds = new Set<string>();
  const path: number[] = [];
  let index = 0;
  while (index < pages.length) {
    const page = pages[index]!;
    const shown = page.fieldIds.filter((id) => {
      const field = byId.get(id);
      return field ? fieldVisible(field, effective) : false;
    });
    if (shown.length > 0) {
      path.push(index);
      for (const id of shown) {
        visibleIds.add(id);
        if (answers[id] !== undefined && capturesAnswer(byId.get(id)!.type)) effective[id] = answers[id];
      }
    }
    let next = index + 1;
    if (shown.length > 0) {
      const jump = firstSkip(shown.map((id) => byId.get(id)!), effective, pages, index);
      if (jump === SUBMIT_TARGET) break;
      if (typeof jump === "number") next = jump;
    }
    index = next;
  }
  return { pages, path, visibleIds, effective };
}

function firstSkip(fields: FieldDef[], answers: AnswerMap, pages: Page[], fromIndex: number): number | typeof SUBMIT_TARGET | null {
  for (const field of fields) {
    for (const rule of Array.isArray(field.skipLogic?.rules) ? field.skipLogic.rules : []) {
      if (!evaluateRule(rule, answers)) continue;
      if (rule.goTo === SUBMIT_TARGET) return SUBMIT_TARGET;
      const target = pages.findIndex((page) => page.id === rule.goTo);
      if (target > fromIndex) return target;
    }
  }
  return null;
}

/** Errors for the visible fields on one page (the renderer's Continue check). */
export function pageErrors(fields: readonly FieldDef[], state: FormState, pageIndex: number, answers: AnswerMap): Record<string, string> {
  const errors: Record<string, string> = {};
  const page = state.pages[pageIndex];
  if (!page) return errors;
  const byId = new Map(fields.map((field) => [field.id, field]));
  for (const id of page.fieldIds) {
    const field = byId.get(id);
    if (!field || !state.visibleIds.has(id)) continue;
    const { error } = checkAnswer(field, answers[id]);
    if (error) errors[id] = error;
  }
  return errors;
}

/** The page after `pageIndex` on the path, or null when it is the last one. */
export function nextOnPath(state: FormState, pageIndex: number): number | null {
  const position = state.path.indexOf(pageIndex);
  if (position < 0) return state.path.find((index) => index > pageIndex) ?? null;
  return state.path[position + 1] ?? null;
}

export function previousOnPath(state: FormState, pageIndex: number): number | null {
  const position = state.path.indexOf(pageIndex);
  if (position <= 0) return null;
  return state.path[position - 1] ?? null;
}

export type SubmissionCheck = {
  ok: boolean;
  /** What gets stored: only answers to fields on the path, coerced to their stored shape. */
  answers: AnswerMap;
  errors: Record<string, string>;
};

/**
 * The server's verdict on a submission. Recomputes visibility and the path
 * from the raw answers; anything the browser says about hidden fields is
 * ignored. Every visible required field must be answered, every answer must
 * pass its field's check, and answers to hidden or unknown fields are dropped.
 */
export function checkSubmission(fields: readonly FieldDef[], layout: FormLayout, raw: AnswerMap): SubmissionCheck {
  const coerced: AnswerMap = {};
  for (const field of fields) {
    const spec = fieldSpec(field.type);
    if (!spec?.captures || !(field.id in raw)) continue;
    const value = raw[field.id] === null || raw[field.id] === undefined ? undefined : spec.coerce(raw[field.id], field.config);
    coerced[field.id] = value === undefined ? raw[field.id] : value;
  }
  const state = resolveForm(fields, layout, coerced);
  const answers: AnswerMap = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (!capturesAnswer(field.type)) continue;
    const onPath = field.type === "hidden" || state.visibleIds.has(field.id);
    if (!onPath) continue;
    const { value, error } = checkAnswer(field, raw[field.id]);
    if (error && field.type !== "hidden") errors[field.id] = error;
    if (!error && value !== undefined) answers[field.id] = value;
  }
  return { ok: Object.keys(errors).length === 0, answers, errors };
}

/** Problems with the branching set-up, for the builder and the publish check. */
export function logicProblems(fields: readonly FieldDef[], layout: FormLayout): string[] {
  const problems: string[] = [];
  const position = new Map(fields.map((field, index) => [field.id, index]));
  const pages = buildPages(fields, layout);
  const pageOf = new Map<string, number>();
  for (const page of pages) for (const id of page.fieldIds) pageOf.set(id, page.index);
  const name = (field: FieldDef) => `“${field.label || fieldSpec(field.type)?.label || "Untitled"}”`;
  const checkRule = (field: FieldDef, rule: LogicRule, what: string) => {
    const source = fields[position.get(rule.fieldId) ?? -1];
    if (!source) return problems.push(`${name(field)}: a ${what} rule points at a question that no longer exists.`);
    if ((position.get(rule.fieldId) ?? 0) > (position.get(field.id) ?? 0) || (what === "show/hide" && rule.fieldId === field.id)) {
      problems.push(`${name(field)}: a ${what} rule uses ${name(source)}, which comes later. Rules can only use earlier questions.`);
    }
    if (!fieldSpec(source.type)?.logicUsable) problems.push(`${name(field)}: ${name(source)} cannot be used in a rule.`);
    if (!OPS.has(rule.op)) problems.push(`${name(field)}: a ${what} rule has an unknown condition.`);
    return 0;
  };
  for (const field of fields) {
    for (const rule of Array.isArray(field.visibility?.rules) ? field.visibility.rules : []) checkRule(field, rule, "show/hide");
    for (const rule of Array.isArray(field.skipLogic?.rules) ? field.skipLogic.rules : []) {
      checkRule(field, rule, "skip");
      if (rule.goTo === SUBMIT_TARGET) continue;
      const target = pages.findIndex((page) => page.id === rule.goTo);
      const from = pageOf.get(field.id) ?? -1;
      if (target < 0) problems.push(`${name(field)}: a skip rule jumps to a page that no longer exists.`);
      else if (target <= from) problems.push(`${name(field)}: a skip rule jumps backwards. Skips can only go forward.`);
    }
  }
  return [...new Set(problems)];
}

/** Pages a skip rule on `field` may jump to (strictly later pages), with a readable name. */
export function skipTargets(fields: readonly FieldDef[], layout: FormLayout, fieldId: string): { id: string; label: string }[] {
  const pages = buildPages(fields, layout);
  const from = pages.findIndex((page) => page.fieldIds.includes(fieldId));
  const byId = new Map(fields.map((field) => [field.id, field]));
  return pages
    .filter((page) => page.index > from)
    .map((page) => ({ id: page.id, label: `Page ${page.index + 1}: ${byId.get(page.id)?.label || "Untitled"}`.slice(0, 80) }));
}

/** Earlier questions a rule on `fieldId` may test. */
export function ruleSources(fields: readonly FieldDef[], fieldId: string, includeSelf = false): FieldDef[] {
  const index = fields.findIndex((field) => field.id === fieldId);
  const end = includeSelf ? index + 1 : index;
  return fields.slice(0, Math.max(0, end)).filter((field) => fieldSpec(field.type)?.logicUsable);
}

/** Starting value for a new rule, matched to the source question so the select shows what is stored. */
export function defaultRuleValue(source: FieldDef | undefined): string | number | boolean {
  if (!source) return "";
  if (source.type === "yes_no" || source.type === "consent") return true;
  const first = source.config.choices?.[0];
  if (first) return first.id;
  if (source.type === "rating" || source.type === "scale") return source.config.max ?? 5;
  if (source.type === "nps") return 9;
  if (source.type === "number" || source.type === "currency") return 0;
  if (source.type === "slider") return source.config.min ?? 0;
  return "";
}

/** Drop rules that point at missing fields; keep skip rules typed. Used when saving. */
export function cleanLogic(fields: readonly FieldDef[]): FieldDef[] {
  const ids = new Set(fields.map((field) => field.id));
  const cleanRule = (rule: LogicRule): LogicRule | null => {
    if (!rule || typeof rule.fieldId !== "string" || !ids.has(rule.fieldId) || !OPS.has(rule.op)) return null;
    const value = rule.value;
    const typed = typeof value === "string" ? value.slice(0, 300) : typeof value === "number" || typeof value === "boolean" ? value : null;
    return { fieldId: rule.fieldId, op: rule.op, value: typed };
  };
  return fields.map((field) => {
    const visibilityRules = (Array.isArray(field.visibility?.rules) ? field.visibility.rules : []).map(cleanRule).filter((rule): rule is LogicRule => rule !== null).slice(0, 20);
    const skipRules = (Array.isArray(field.skipLogic?.rules) ? field.skipLogic.rules : [])
      .map((rule) => {
        const base = cleanRule(rule);
        return base && typeof rule.goTo === "string" ? ({ ...base, goTo: rule.goTo.slice(0, 60) } as SkipRule) : null;
      })
      .filter((rule): rule is SkipRule => rule !== null)
      .slice(0, 20);
    return {
      ...field,
      visibility: visibilityRules.length
        ? { action: field.visibility?.action === "hide" ? "hide" : "show", match: field.visibility?.match === "any" ? "any" : "all", rules: visibilityRules }
        : null,
      skipLogic: skipRules.length ? { rules: skipRules } : null,
    };
  });
}

export function progressPercent(position: number, total: number): number {
  if (total <= 1) return position >= total ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((position / total) * 100)));
}

// End-of-form rules ----------------------------------------------------------

export const MAX_END_RULES = 20;

function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Where a respondent goes after submitting. Evaluated on the SERVER against
 * the answers it stored (hidden and skipped questions already dropped by
 * checkSubmission), so a crafted POST can neither pick an ending by claiming
 * an answer to a question it never reached nor supply a URL: every URL comes
 * from the author's saved rules. First matching rule wins; otherwise the
 * form's own thank-you and redirect apply.
 */
export function resolveEnding(
  fields: readonly FieldDef[],
  storedAnswers: AnswerMap,
  endRules: readonly EndRule[],
  fallback: { title: string; message: string; redirectUrl: string | null },
): Ending {
  const usable = new Set(fields.filter((field) => fieldSpec(field.type)?.logicUsable).map((field) => field.id));
  for (const rule of endRules) {
    if (!rule || !Array.isArray(rule.rules) || rule.rules.length === 0) continue;
    if (!rule.rules.every((item) => usable.has(item.fieldId))) continue;
    const results = rule.rules.map((item) => evaluateRule(item, storedAnswers));
    const matched = rule.match === "any" ? results.some(Boolean) : results.every(Boolean);
    if (!matched) continue;
    if (rule.action === "redirect") {
      if (!isWebUrl(rule.url)) continue;
      return { title: rule.title || fallback.title, message: rule.message || fallback.message, redirectUrl: rule.url, ruleId: rule.id };
    }
    return { title: rule.title || fallback.title, message: rule.message, redirectUrl: null, ruleId: rule.id };
  }
  return { title: fallback.title, message: fallback.message, redirectUrl: fallback.redirectUrl && isWebUrl(fallback.redirectUrl) ? fallback.redirectUrl : null, ruleId: null };
}

/** Sanitize end rules from the builder: known questions, known ops, web URLs only. */
export function cleanEndRules(fields: readonly FieldDef[], raw: unknown): EndRule[] {
  const usable = new Set(fields.filter((field) => fieldSpec(field.type)?.logicUsable).map((field) => field.id));
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const list = Array.isArray(raw) ? raw : [];
  const out: EndRule[] = [];
  for (const item of list.slice(0, MAX_END_RULES)) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const rules = (Array.isArray(source.rules) ? source.rules : [])
      .map((rule) => rule as LogicRule)
      .filter((rule) => rule && typeof rule.fieldId === "string" && usable.has(rule.fieldId) && OPS.has(rule.op))
      .map((rule) => ({
        fieldId: rule.fieldId,
        op: rule.op,
        value: typeof rule.value === "string" ? rule.value.slice(0, 300) : typeof rule.value === "number" || typeof rule.value === "boolean" ? rule.value : null,
      }))
      .slice(0, 10);
    if (!rules.length) continue;
    const action = source.action === "redirect" ? "redirect" : "message";
    const url = text(source.url, 500);
    out.push({
      id: text(source.id, 40) || `end${out.length + 1}`,
      match: source.match === "any" ? "any" : "all",
      rules,
      action,
      url: action === "redirect" && isWebUrl(url) ? url : "",
      title: text(source.title, 200),
      message: text(source.message, 3000),
    });
  }
  return out;
}

/** Problems with the end rules, for the builder and the publish check. */
export function endRuleProblems(fields: readonly FieldDef[], endRules: readonly EndRule[]): string[] {
  const problems: string[] = [];
  const byId = new Map(fields.map((field) => [field.id, field]));
  endRules.forEach((rule, index) => {
    const name = `Ending rule ${index + 1}`;
    if (!rule.rules.length) problems.push(`${name} has no conditions.`);
    for (const item of rule.rules) {
      const source = byId.get(item.fieldId);
      if (!source) problems.push(`${name} uses a question that no longer exists.`);
      else if (!fieldSpec(source.type)?.logicUsable) problems.push(`${name} uses a question that cannot be tested.`);
    }
    if (rule.action === "redirect" && !isWebUrl(rule.url)) problems.push(`${name} needs a full web address starting with https://`);
    if (rule.action === "message" && !rule.title && !rule.message) problems.push(`${name} needs a thank-you title or message.`);
  });
  return [...new Set(problems)];
}
