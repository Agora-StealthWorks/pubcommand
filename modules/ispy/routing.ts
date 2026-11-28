/**
 * Routing rules: which list an email belongs to. Staff can see and edit every rule.
 * Conditions are AND-ed; the first enabled rule (lowest priority number) that matches
 * wins. Pure: the caller loads the rules and the email's facts.
 */

export const CONDITION_FIELDS = [
  "fromAddress",
  "fromDomain",
  "fromName",
  "subject",
  "masthead",
  "listIdHeader",
  "header",
  "body",
  "inbox",
  "campaignId",
] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const CONDITION_FIELD_LABELS: Record<ConditionField, string> = {
  fromAddress: "From address",
  fromDomain: "From domain",
  fromName: "From name",
  subject: "Subject",
  masthead: "Masthead / first lines",
  listIdHeader: "List-Id header",
  header: "Any header",
  body: "Body",
  inbox: "Arrived at inbox",
  campaignId: "Campaign ID",
};

export const CONDITION_OPS = ["equals", "contains", "startsWith", "matches"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];
export const CONDITION_OP_LABELS: Record<ConditionOp, string> = { equals: "is", contains: "contains", startsWith: "starts with", matches: "matches (regex)" };

export type RuleCondition = { field: ConditionField; op: ConditionOp; value: string; header?: string };
export type RuleAction = "ROUTE" | "AFFILIATE" | "IGNORE";

export type RoutingRule = {
  id: string;
  priority: number;
  enabled: boolean;
  conditions: RuleCondition[];
  action: RuleAction;
  listId: string | null;
  publisherId: string | null;
  publicationId: string | null;
};

/** The facts about one email that rules look at. */
export type RoutingFacts = {
  fromAddress: string;
  fromName: string | null;
  subject: string;
  masthead: string;
  listIdHeader: string | null;
  headers: Record<string, string>;
  body: string;
  inboxAddress: string | null;
  campaignId: string | null;
};

export function parseConditions(value: unknown): RuleCondition[] {
  if (!Array.isArray(value)) return [];
  const out: RuleCondition[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    if (!(CONDITION_FIELDS as readonly string[]).includes(String(c.field))) continue;
    if (!(CONDITION_OPS as readonly string[]).includes(String(c.op))) continue;
    const v = typeof c.value === "string" ? c.value.trim() : "";
    if (!v) continue;
    out.push({ field: c.field as ConditionField, op: c.op as ConditionOp, value: v.slice(0, 500), header: typeof c.header === "string" ? c.header.toLowerCase().slice(0, 80) : undefined });
  }
  return out;
}

/** A regex value is checked before it is saved; a bad one never matches. */
export function regexError(value: string): string | null {
  if (value.length > 300) return "The pattern is too long (300 characters at most).";
  try {
    new RegExp(value, "i");
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "That is not a valid pattern.";
  }
}

function fieldValues(facts: RoutingFacts, c: RuleCondition): string[] {
  switch (c.field) {
    case "fromAddress":
      return [facts.fromAddress];
    case "fromDomain":
      return [facts.fromAddress.split("@")[1] ?? ""];
    case "fromName":
      return [facts.fromName ?? ""];
    case "subject":
      return [facts.subject];
    case "masthead":
      return [facts.masthead];
    case "listIdHeader":
      return [facts.listIdHeader ?? ""];
    case "header":
      return c.header ? [facts.headers[c.header] ?? ""] : Object.values(facts.headers);
    case "body":
      return [facts.body.slice(0, 20_000)];
    case "inbox":
      return [facts.inboxAddress ?? ""];
    case "campaignId":
      return [facts.campaignId ?? ""];
  }
}

export function conditionMatches(facts: RoutingFacts, c: RuleCondition): boolean {
  const want = c.value.toLowerCase();
  return fieldValues(facts, c).some((raw) => {
    const have = raw.toLowerCase();
    if (!have) return false;
    switch (c.op) {
      case "equals":
        return c.field === "fromDomain" ? have === want || have.endsWith(`.${want}`) : have === want;
      case "contains":
        return have.includes(want);
      case "startsWith":
        return have.startsWith(want);
      case "matches":
        if (regexError(c.value)) return false;
        return new RegExp(c.value, "i").test(raw);
    }
  });
}

export function ruleMatches(facts: RoutingFacts, rule: Pick<RoutingRule, "conditions" | "enabled">): boolean {
  return rule.enabled && rule.conditions.length > 0 && rule.conditions.every((c) => conditionMatches(facts, c));
}

/** The first matching rule by priority (then by id for a stable order). */
export function firstMatchingRule<T extends RoutingRule>(facts: RoutingFacts, rules: readonly T[]): T | null {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  return ordered.find((rule) => ruleMatches(facts, rule)) ?? null;
}

/** "From address is alerts@x.com AND Subject starts with [VIP]" */
export function describeConditions(conditions: readonly RuleCondition[]): string {
  if (!conditions.length) return "(no conditions)";
  return conditions
    .map((c) => `${c.field === "header" && c.header ? `Header ${c.header}` : CONDITION_FIELD_LABELS[c.field]} ${CONDITION_OP_LABELS[c.op]} “${c.value}”`)
    .join(" AND ");
}

/** What a rule change would do to recent mail: the preview behind "Test on last 200". */
export function previewRule<T extends { id: string; listId: string | null; facts: RoutingFacts }>(
  rule: Pick<RoutingRule, "conditions" | "listId" | "action">,
  emails: readonly T[],
): { matched: T[]; wouldMove: T[] } {
  const matched = emails.filter((e) => ruleMatches(e.facts, { ...rule, enabled: true }));
  const wouldMove = rule.action === "ROUTE" ? matched.filter((e) => e.listId !== rule.listId) : matched;
  return { matched, wouldMove };
}
