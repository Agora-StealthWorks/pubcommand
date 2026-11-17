/**
 * Shapes shared by the builder, the public renderer, the submit route,
 * results and exports. Pure types only.
 */

export type Choice = { id: string; label: string };

export type LogicOp =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "answered"
  | "empty"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

export type LogicRule = { fieldId: string; op: LogicOp; value?: string | number | boolean | null };

/** Show or hide a field depending on EARLIER answers. Null means always shown. */
export type Visibility = { action: "show" | "hide"; match: "all" | "any"; rules: LogicRule[] };

/** After the page holding this field, jump forward to a page or straight to submit. First match wins. */
export type SkipRule = LogicRule & { goTo: string };
export type SkipLogic = { rules: SkipRule[] };

/** Per-type settings. Each type reads only its own keys (see fields.ts). */
export type FieldConfig = {
  choices?: Choice[];
  allowOther?: boolean;
  minSelections?: number;
  maxSelections?: number;
  min?: number;
  max?: number;
  step?: number;
  leftLabel?: string;
  rightLabel?: string;
  prefix?: string;
  suffix?: string;
  minLength?: number;
  maxLength?: number;
  accept?: string[];
  maxSizeMb?: number;
  consentText?: string;
  queryParam?: string;
  defaultValue?: string;
  body?: string;
  allowTyped?: boolean;
};

export type FieldDef = {
  id: string;
  type: string;
  label: string;
  helpText: string;
  placeholder: string;
  required: boolean;
  config: FieldConfig;
  visibility: Visibility | null;
  skipLogic: SkipLogic | null;
  /** Paginated layout only: keep this field on the same page as the next one. */
  groupWithNext: boolean;
};

export type FormLayout = "paginated" | "single";

export type AnswerMap = Record<string, unknown>;

/** What the public renderer needs about a form. Never includes responses. */
export type PublicForm = {
  id: string;
  slug: string;
  title: string;
  description: string;
  layout: FormLayout;
  showProgress: boolean;
  autoAdvance: boolean;
  submitLabel: string;
  confirmTitle: string;
  confirmMessage: string;
  redirectUrl: string | null;
  disclaimer: string | null;
  fields: FieldDef[];
};

export type ResolvedTheme = {
  brandName: string;
  logoSrc: string | null;
  logoHeight: number;
  barColor: string;
  accentColor: string;
  privacyPolicyUrl: string | null;
  companyName: string;
  footerText: string;
};

/** A stored response as the pure code sees it. */
export type ResponseRecord = {
  id: string;
  status: "PARTIAL" | "COMPLETE";
  answers: AnswerMap;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  lastPageIndex: number;
  utm: Record<string, string> | null;
  spamReason: string | null;
};
