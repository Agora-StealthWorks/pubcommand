/**
 * The field registry: the ONE place a field type is defined.
 *
 * The builder palette, the inspector, the public renderer, the submit
 * validator, the exports and the analytics all read FIELD_TYPES. To add a
 * type, add it here and every surface picks it up.
 */
import type { Choice, FieldConfig, FieldDef } from "./types";

export type FieldCategory = "Contact" | "Text" | "Choice" | "Scale" | "Number & date" | "Upload" | "Special" | "Layout";

/** How results summarise a type. "none" types never store an answer. */
export type AnalyticsKind = "choice" | "multi" | "numeric" | "bool" | "text" | "date" | "file" | "none";

export type InspectorOption =
  | "placeholder"
  | "choices"
  | "allowOther"
  | "selections"
  | "range"
  | "scaleLabels"
  | "affixes"
  | "length"
  | "accept"
  | "consentText"
  | "queryParam"
  | "body"
  | "allowTyped";

export type FieldTypeSpec = {
  type: string;
  label: string;
  category: FieldCategory;
  hint: string;
  /** Collects personal data: the form shows the contact-data disclaimer. */
  pii: boolean;
  /** Stores an answer. Layout types do not. */
  captures: boolean;
  /** Can be tested by a branching rule. */
  logicUsable: boolean;
  analytics: AnalyticsKind;
  /** Which inspector controls this type shows. */
  inspector: InspectorOption[];
  defaultLabel: string;
  defaultConfig: () => FieldConfig;
  /**
   * Turn an untrusted value (from a POST or the browser) into the stored
   * shape, or undefined when it has the wrong shape. Never throws.
   */
  coerce: (raw: unknown, config: FieldConfig) => unknown;
  /** Validate a non-empty coerced value. Returns an error message or null. */
  validate: (value: unknown, config: FieldConfig) => string | null;
  /** Plain text for exports and tables. */
  toText: (value: unknown, config: FieldConfig) => string;
};

const TEXT_MAX = 500;
const LONG_TEXT_MAX = 10000;
export const OTHER_PREFIX = "other:";

let counter = 0;
/** Short id for a new choice. Not security-sensitive. */
export function newChoiceId(): string {
  counter = (counter + 1) % 1_000_000;
  return `c${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function choices(...labels: string[]): Choice[] {
  return labels.map((label) => ({ id: newChoiceId(), label }));
}

function asString(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return undefined;
}

function asNumber(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === "string" && raw.trim() !== "") {
    const value = Number(raw.trim().replace(/,/g, ""));
    return Number.isFinite(value) ? value : undefined;
  }
  return undefined;
}

function asBool(raw: unknown): boolean | undefined {
  if (typeof raw === "boolean") return raw;
  if (raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "false" || raw === "no") return false;
  return undefined;
}

function lengthError(value: string, config: FieldConfig, hardMax: number): string | null {
  const max = Math.min(config.maxLength ?? hardMax, hardMax);
  if (value.length > max) return `Keep this under ${max} characters.`;
  if (config.minLength && value.length < config.minLength) return `Enter at least ${config.minLength} characters.`;
  return null;
}

function choiceLabel(id: string, config: FieldConfig): string {
  if (id.startsWith(OTHER_PREFIX)) return `Other: ${id.slice(OTHER_PREFIX.length)}`;
  return config.choices?.find((choice) => choice.id === id)?.label ?? id;
}

function validChoice(id: string, config: FieldConfig): boolean {
  if (id.startsWith(OTHER_PREFIX)) return Boolean(config.allowOther) && id.length > OTHER_PREFIX.length && id.length <= 300;
  return Boolean(config.choices?.some((choice) => choice.id === id));
}

function rangeOf(config: FieldConfig, fallbackMin: number, fallbackMax: number) {
  const min = Number.isFinite(config.min) ? Number(config.min) : fallbackMin;
  const max = Number.isFinite(config.max) ? Number(config.max) : fallbackMax;
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

export type AddressValue = { line1: string; line2: string; city: string; region: string; postal: string; country: string };
export const ADDRESS_PARTS: { key: keyof AddressValue; label: string }[] = [
  { key: "line1", label: "Street address" },
  { key: "line2", label: "Apt, suite (optional)" },
  { key: "city", label: "City" },
  { key: "region", label: "State / region" },
  { key: "postal", label: "Postal code" },
  { key: "country", label: "Country" },
];

/** An uploaded file as stored on the answer. `pending` is the browser's placeholder before the server stores it. */
export type FileValue = { fileId?: string; filename: string; size: number; mimeType: string };
/** A signature: a drawn PNG (stored as a file) and/or a typed name. */
export type SignatureValue = { fileId?: string; dataUrl?: string; typedName?: string; signedAt?: string };

export const SIGNATURE_MAX_DATA_URL = 400_000;

const textType = (
  type: string,
  label: string,
  category: FieldCategory,
  hint: string,
  pii: boolean,
  defaultLabel: string,
  check: (value: string) => string | null,
  hardMax = TEXT_MAX,
): FieldTypeSpec => ({
  type,
  label,
  category,
  hint,
  pii,
  captures: true,
  logicUsable: true,
  analytics: "text",
  inspector: ["placeholder", "length"],
  defaultLabel,
  defaultConfig: () => ({}),
  coerce: (raw) => asString(raw),
  validate: (value, config) => lengthError(String(value), config, hardMax) ?? check(String(value)),
  toText: (value) => (typeof value === "string" ? value : ""),
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const singleChoice = (type: string, label: string, hint: string): FieldTypeSpec => ({
  type,
  label,
  category: "Choice",
  hint,
  pii: false,
  captures: true,
  logicUsable: true,
  analytics: "choice",
  inspector: ["choices", "allowOther"],
  defaultLabel: "Pick one",
  defaultConfig: () => ({ choices: choices("Option 1", "Option 2", "Option 3") }),
  coerce: (raw) => asString(raw),
  validate: (value, config) => (validChoice(String(value), config) ? null : "Pick one of the options."),
  toText: (value, config) => (typeof value === "string" ? choiceLabel(value, config) : ""),
});

const scaleType = (
  type: string,
  label: string,
  hint: string,
  defaultLabel: string,
  range: (config: FieldConfig) => { min: number; max: number },
  defaultConfig: () => FieldConfig,
  inspector: InspectorOption[],
): FieldTypeSpec => ({
  type,
  label,
  category: "Scale",
  hint,
  pii: false,
  captures: true,
  logicUsable: true,
  analytics: "numeric",
  inspector,
  defaultLabel,
  defaultConfig,
  coerce: (raw) => asNumber(raw),
  validate: (value, config) => {
    const { min, max } = range(config);
    const n = Number(value);
    return Number.isInteger(n) && n >= min && n <= max ? null : `Choose a value from ${min} to ${max}.`;
  },
  toText: (value) => (typeof value === "number" ? String(value) : ""),
});

export const FIELD_TYPES: readonly FieldTypeSpec[] = [
  // Contact
  textType("name", "Name", "Contact", "Full name", true, "Your name", () => null),
  textType("email", "Email", "Contact", "Checked email address", true, "Email address", (value) =>
    EMAIL_RE.test(value) ? null : "Enter a valid email address.",
  ),
  textType("phone", "Phone", "Contact", "Phone number", true, "Phone number", (value) => {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15 && /^[+\d\s().-]+$/.test(value) ? null : "Enter a valid phone number.";
  }),
  {
    type: "address",
    label: "Address",
    category: "Contact",
    hint: "Street, city, region, postal code",
    pii: true,
    captures: true,
    logicUsable: false,
    analytics: "text",
    inspector: [],
    defaultLabel: "Mailing address",
    defaultConfig: () => ({}),
    coerce: (raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
      const source = raw as Record<string, unknown>;
      const value = {} as AddressValue;
      for (const part of ADDRESS_PARTS) value[part.key] = (asString(source[part.key]) ?? "").slice(0, 200);
      return value;
    },
    validate: (value) => {
      const address = value as AddressValue;
      return address.line1 && address.city && address.postal ? null : "Enter the street, city and postal code.";
    },
    toText: (value) => {
      if (!value || typeof value !== "object") return "";
      const address = value as AddressValue;
      return [address.line1, address.line2, address.city, address.region, address.postal, address.country].filter(Boolean).join(", ");
    },
  },
  textType("website", "Website", "Contact", "A web address", false, "Website", (value) =>
    /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(value) ? null : "Enter a full web address starting with https://",
  ),

  // Text
  textType("short_text", "Short answer", "Text", "One line of text", false, "Short answer", () => null),
  {
    ...textType("long_text", "Long answer", "Text", "A paragraph", false, "Tell us more", () => null, LONG_TEXT_MAX),
  },

  // Choice
  singleChoice("single_choice", "Multiple choice", "Pick one (radio buttons)"),
  singleChoice("dropdown", "Dropdown", "Pick one from a list"),
  {
    type: "multi_choice",
    label: "Checkboxes",
    category: "Choice",
    hint: "Pick any number",
    pii: false,
    captures: true,
    logicUsable: true,
    analytics: "multi",
    inspector: ["choices", "allowOther", "selections"],
    defaultLabel: "Pick all that apply",
    defaultConfig: () => ({ choices: choices("Option 1", "Option 2", "Option 3") }),
    coerce: (raw) => {
      const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : undefined;
      if (!list) return undefined;
      const values = list.map(asString).filter((item): item is string => Boolean(item));
      return [...new Set(values)];
    },
    validate: (value, config) => {
      const list = value as string[];
      if (!list.every((id) => validChoice(id, config))) return "Pick from the options shown.";
      if (config.minSelections && list.length < config.minSelections) return `Pick at least ${config.minSelections}.`;
      if (config.maxSelections && list.length > config.maxSelections) return `Pick no more than ${config.maxSelections}.`;
      return null;
    },
    toText: (value, config) => (Array.isArray(value) ? value.map((id) => choiceLabel(String(id), config)).join("; ") : ""),
  },
  {
    type: "yes_no",
    label: "Yes / No",
    category: "Choice",
    hint: "Two buttons",
    pii: false,
    captures: true,
    logicUsable: true,
    analytics: "bool",
    inspector: [],
    defaultLabel: "Yes or no?",
    defaultConfig: () => ({}),
    coerce: (raw) => asBool(raw),
    validate: () => null,
    toText: (value) => (value === true ? "Yes" : value === false ? "No" : ""),
  },

  // Scale
  scaleType(
    "rating",
    "Rating",
    "Stars, 1 to N",
    "How would you rate it?",
    (config) => ({ min: 1, max: Math.min(10, Math.max(3, Math.round(config.max ?? 5))) }),
    () => ({ max: 5 }),
    ["range"],
  ),
  scaleType(
    "scale",
    "Linear scale",
    "Numbered scale with end labels",
    "How likely are you to…",
    (config) => {
      const { min, max } = rangeOf(config, 1, 5);
      return { min: Math.max(0, Math.round(min)), max: Math.min(10, Math.round(max)) };
    },
    () => ({ min: 1, max: 5, leftLabel: "Not at all", rightLabel: "Very" }),
    ["range", "scaleLabels"],
  ),
  scaleType(
    "nps",
    "NPS",
    "0–10 likely to recommend",
    "How likely are you to recommend us to a friend?",
    () => ({ min: 0, max: 10 }),
    () => ({ leftLabel: "Not likely", rightLabel: "Extremely likely" }),
    ["scaleLabels"],
  ),

  // Number & date
  {
    type: "number",
    label: "Number",
    category: "Number & date",
    hint: "A number, with optional prefix like $",
    pii: false,
    captures: true,
    logicUsable: true,
    analytics: "numeric",
    inspector: ["placeholder", "range", "affixes"],
    defaultLabel: "Number",
    defaultConfig: () => ({}),
    coerce: (raw) => asNumber(raw),
    validate: (value, config) => {
      const n = Number(value);
      if (Number.isFinite(config.min) && n < Number(config.min)) return `Enter ${config.min} or more.`;
      if (Number.isFinite(config.max) && n > Number(config.max)) return `Enter ${config.max} or less.`;
      return null;
    },
    toText: (value) => (typeof value === "number" ? String(value) : ""),
  },
  {
    type: "date",
    label: "Date",
    category: "Number & date",
    hint: "A calendar date",
    pii: false,
    captures: true,
    logicUsable: true,
    analytics: "date",
    inspector: [],
    defaultLabel: "Date",
    defaultConfig: () => ({}),
    coerce: (raw) => asString(raw),
    validate: (value) => {
      const text = String(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "Enter a date.";
      const date = new Date(`${text}T00:00:00Z`);
      return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? "Enter a real date." : null;
    },
    toText: (value) => (typeof value === "string" ? value : ""),
  },
  {
    type: "time",
    label: "Time",
    category: "Number & date",
    hint: "A time of day",
    pii: false,
    captures: true,
    logicUsable: false,
    analytics: "text",
    inspector: [],
    defaultLabel: "Time",
    defaultConfig: () => ({}),
    coerce: (raw) => asString(raw),
    validate: (value) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value)) ? null : "Enter a time."),
    toText: (value) => (typeof value === "string" ? value : ""),
  },

  // Upload
  {
    type: "file_upload",
    label: "File upload",
    category: "Upload",
    hint: "PDF, image or document",
    pii: true,
    captures: true,
    logicUsable: false,
    analytics: "file",
    inspector: ["accept"],
    defaultLabel: "Upload a file",
    defaultConfig: () => ({ accept: [".pdf", ".png", ".jpg", ".jpeg", ".docx"], maxSizeMb: 10 }),
    coerce: (raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
      const source = raw as Record<string, unknown>;
      const filename = asString(source.filename);
      const size = asNumber(source.size);
      if (!filename || size === undefined) return undefined;
      const value: FileValue = { filename: filename.slice(0, 200), size, mimeType: (asString(source.mimeType) ?? "application/octet-stream").slice(0, 120) };
      const fileId = asString(source.fileId);
      if (fileId) value.fileId = fileId;
      return value;
    },
    validate: (value, config) => {
      const file = value as FileValue;
      const max = Math.min(config.maxSizeMb ?? 10, 25);
      if (file.size <= 0) return "That file is empty.";
      if (file.size > max * 1024 * 1024) return `Files must be under ${max} MB.`;
      const accept = (config.accept ?? []).map((ext) => ext.toLowerCase());
      if (accept.length && !accept.some((ext) => file.filename.toLowerCase().endsWith(ext))) return `Upload one of: ${accept.join(", ")}.`;
      return null;
    },
    toText: (value) => (value && typeof value === "object" ? (value as FileValue).filename : ""),
  },

  // Special
  {
    type: "signature",
    label: "Signature",
    category: "Special",
    hint: "Draw or type a signature",
    pii: true,
    captures: true,
    logicUsable: false,
    analytics: "file",
    inspector: ["allowTyped"],
    defaultLabel: "Signature",
    defaultConfig: () => ({ allowTyped: true }),
    coerce: (raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
      const source = raw as Record<string, unknown>;
      const value: SignatureValue = {};
      const dataUrl = asString(source.dataUrl);
      const typedName = asString(source.typedName);
      const fileId = asString(source.fileId);
      if (dataUrl) value.dataUrl = dataUrl;
      if (typedName) value.typedName = typedName.slice(0, 200);
      if (fileId) value.fileId = fileId;
      const signedAt = asString(source.signedAt);
      if (signedAt) value.signedAt = signedAt;
      return value.dataUrl || value.typedName || value.fileId ? value : undefined;
    },
    validate: (value, config) => {
      const signature = value as SignatureValue;
      if (signature.dataUrl) {
        if (!signature.dataUrl.startsWith("data:image/png;base64,")) return "Draw your signature again.";
        if (signature.dataUrl.length > SIGNATURE_MAX_DATA_URL) return "That signature is too large. Clear it and sign again.";
        return null;
      }
      if (signature.fileId) return null;
      if (signature.typedName && config.allowTyped) return null;
      return "Sign in the box.";
    },
    toText: (value) => {
      if (!value || typeof value !== "object") return "";
      const signature = value as SignatureValue;
      const parts = [signature.fileId || signature.dataUrl ? "Signed" : "", signature.typedName ? `Typed: ${signature.typedName}` : ""];
      return parts.filter(Boolean).join(" · ");
    },
  },
  {
    type: "consent",
    label: "Consent",
    category: "Special",
    hint: "A checkbox the person must tick",
    pii: false,
    captures: true,
    logicUsable: true,
    analytics: "bool",
    inspector: ["consentText"],
    defaultLabel: "Consent",
    defaultConfig: () => ({ consentText: "I agree to be contacted about my request." }),
    coerce: (raw) => asBool(raw),
    validate: () => null,
    toText: (value) => (value === true ? "Agreed" : value === false ? "Not agreed" : ""),
  },
  {
    type: "hidden",
    label: "Hidden / UTM",
    category: "Special",
    hint: "Captured from the link, not shown",
    pii: false,
    captures: true,
    logicUsable: true,
    analytics: "choice",
    inspector: ["queryParam"],
    defaultLabel: "Source",
    defaultConfig: () => ({ queryParam: "source", defaultValue: "" }),
    coerce: (raw) => asString(raw)?.slice(0, TEXT_MAX),
    validate: () => null,
    toText: (value) => (typeof value === "string" ? value : ""),
  },

  // Layout
  {
    type: "statement",
    label: "Statement",
    category: "Layout",
    hint: "A heading with a short paragraph",
    pii: false,
    captures: false,
    logicUsable: false,
    analytics: "none",
    inspector: ["body"],
    defaultLabel: "A few words before the next question",
    defaultConfig: () => ({ body: "" }),
    coerce: () => undefined,
    validate: () => null,
    toText: () => "",
  },
  {
    type: "page_break",
    label: "Page break",
    category: "Layout",
    hint: "Start a new page (one-page layout)",
    pii: false,
    captures: false,
    logicUsable: false,
    analytics: "none",
    inspector: [],
    defaultLabel: "Page break",
    defaultConfig: () => ({}),
    coerce: () => undefined,
    validate: () => null,
    toText: () => "",
  },
];

const BY_TYPE = new Map(FIELD_TYPES.map((spec) => [spec.type, spec]));

export function fieldSpec(type: string): FieldTypeSpec | undefined {
  return BY_TYPE.get(type);
}

export const FIELD_CATEGORIES: readonly FieldCategory[] = ["Contact", "Text", "Choice", "Scale", "Number & date", "Upload", "Special", "Layout"];

export function paletteGroups(): { category: FieldCategory; types: FieldTypeSpec[] }[] {
  return FIELD_CATEGORIES.map((category) => ({ category, types: FIELD_TYPES.filter((spec) => spec.category === category) }));
}

export function capturesAnswer(type: string): boolean {
  return fieldSpec(type)?.captures ?? false;
}

/** Rendered as a question the respondent sees (hidden fields are captured but never shown). */
export function isDisplayed(type: string): boolean {
  return type !== "hidden" && type !== "page_break";
}

export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every((item) => isEmptyValue(item));
  }
  return false;
}

/** Make a new field of a type with its defaults. */
export function createField(type: string, id: string): FieldDef {
  const spec = fieldSpec(type);
  if (!spec) throw new Error(`Unknown field type ${type}`);
  return {
    id,
    type,
    label: spec.defaultLabel,
    helpText: "",
    placeholder: "",
    required: false,
    config: spec.defaultConfig(),
    visibility: null,
    skipLogic: null,
    groupWithNext: false,
  };
}

/**
 * Validate one answer against its field. Returns the stored value (or
 * undefined for "no answer") and an error, if any. A consent field that is
 * required must be ticked, not merely answered.
 */
export function checkAnswer(field: FieldDef, raw: unknown): { value: unknown; error: string | null } {
  const spec = fieldSpec(field.type);
  if (!spec || !spec.captures) return { value: undefined, error: null };
  const value = raw === undefined || raw === null ? undefined : spec.coerce(raw, field.config);
  if (raw !== undefined && raw !== null && !isEmptyValue(raw) && value === undefined) {
    return { value: undefined, error: "That answer is not in the right format." };
  }
  if (value === undefined || isEmptyValue(value)) {
    if (field.required) return { value: undefined, error: requiredMessage(field.type) };
    return { value: undefined, error: null };
  }
  if (field.type === "consent" && field.required && value !== true) return { value, error: requiredMessage(field.type) };
  return { value, error: spec.validate(value, field.config) };
}

function requiredMessage(type: string): string {
  if (type === "consent") return "Please tick the box to continue.";
  if (type === "signature") return "Please sign to continue.";
  if (type === "file_upload") return "Please upload a file.";
  return "This question is required.";
}

/** Plain-text value for exports. */
export function answerText(field: FieldDef, value: unknown): string {
  if (value === undefined || value === null) return "";
  return fieldSpec(field.type)?.toText(value, field.config) ?? "";
}

/** True when any displayed or captured field collects personal data. */
export function collectsPii(fields: readonly FieldDef[]): boolean {
  return fields.some((field) => fieldSpec(field.type)?.pii);
}

/**
 * Clean a field coming from the builder: known type, trimmed text, sane
 * config. Used by the save action so a crafted builder POST cannot store junk.
 */
export function sanitizeField(input: FieldDef): FieldDef | null {
  const spec = fieldSpec(input.type);
  if (!spec) return null;
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
  const source = (input.config ?? {}) as Record<string, unknown>;
  const config: FieldConfig = {};
  const allowed = new Set(spec.inspector);
  if (allowed.has("choices")) {
    const list = Array.isArray(source.choices) ? source.choices : [];
    const seen = new Set<string>();
    config.choices = list
      .map((choice) => ({ id: text((choice as Choice)?.id, 40), label: text((choice as Choice)?.label, 200) }))
      .filter((choice) => choice.id && choice.label && !seen.has(choice.id) && seen.add(choice.id))
      .slice(0, 100);
  }
  if (allowed.has("allowOther")) config.allowOther = source.allowOther === true;
  if (allowed.has("selections")) {
    config.minSelections = num(source.minSelections);
    config.maxSelections = num(source.maxSelections);
  }
  if (allowed.has("range")) {
    config.min = num(source.min);
    config.max = num(source.max);
  }
  if (allowed.has("scaleLabels")) {
    config.leftLabel = text(source.leftLabel, 60);
    config.rightLabel = text(source.rightLabel, 60);
  }
  if (allowed.has("affixes")) {
    config.prefix = text(source.prefix, 8);
    config.suffix = text(source.suffix, 12);
  }
  if (allowed.has("length")) {
    config.minLength = num(source.minLength);
    config.maxLength = num(source.maxLength);
  }
  if (allowed.has("accept")) {
    const list = Array.isArray(source.accept) ? source.accept : [];
    config.accept = list
      .map((ext) => text(ext, 10).toLowerCase())
      .filter((ext) => /^\.[a-z0-9]{1,8}$/.test(ext))
      .slice(0, 20);
    config.maxSizeMb = Math.min(25, Math.max(1, num(source.maxSizeMb) ?? 10));
  }
  if (allowed.has("consentText")) config.consentText = text(source.consentText, 500);
  if (allowed.has("queryParam")) {
    config.queryParam = text(source.queryParam, 60).replace(/[^\w-]/g, "");
    config.defaultValue = text(source.defaultValue, 200);
  }
  if (allowed.has("body")) config.body = text(source.body, 3000);
  if (allowed.has("allowTyped")) config.allowTyped = source.allowTyped !== false;
  if (spec.type === "rating") config.max = Math.min(10, Math.max(3, Math.round(num(source.max) ?? 5)));
  for (const key of Object.keys(config) as (keyof FieldConfig)[]) if (config[key] === undefined) delete config[key];
  return {
    id: input.id,
    type: input.type,
    label: text(input.label, 500),
    helpText: text(input.helpText, 1000),
    placeholder: text(input.placeholder, 120),
    required: spec.captures && input.type !== "hidden" ? input.required === true : false,
    config,
    visibility: input.visibility ?? null,
    skipLogic: input.skipLogic ?? null,
    groupWithNext: input.groupWithNext === true,
  };
}
