/**
 * The fields a publication, an editor and a brand's branding carry. This list is the
 * single source of truth: the forms, the validator, the Brain note and the facts JSON
 * all read it. Add or reword a field here (and a column in pubsetup.prisma) and every
 * surface picks it up. It is a fixed schema, not a user-defined field builder.
 */

export type FieldKind = "text" | "textarea" | "select" | "date" | "url" | "email" | "color" | "font" | "list" | "number" | "code" | "slug" | "pairs" | "category";

export type PairColumn = { key: string; label: string; kind?: "text" | "url"; max?: number; placeholder?: string };

export type FieldDef = {
  key: string;
  label: string;
  kind: FieldKind;
  group: string;
  required?: boolean;
  max?: number;
  rows?: number;
  options?: readonly string[];
  hint?: string;
  /** For "slug": derive from this field when left blank. */
  deriveFrom?: string;
  /** For "pairs": the columns of each row, and how many rows a form offers. */
  columns?: readonly PairColumn[];
  maxRows?: number;
  /** Left out of the Brain note and facts (layout-only values such as sort order). */
  internal?: boolean;
  /** For "select": old option names that are accepted and saved as the new name. */
  aliases?: Readonly<Record<string, string>>;
};

export type Pair = Record<string, string>;
export type FieldValue = string | number | string[] | Pair[] | null;
export type FieldValues = Record<string, FieldValue>;

export const PUBLICATION_STATUSES = ["active", "launching", "paused", "retired"] as const;
export const PUBLICATION_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  launching: "Launching",
  paused: "Paused",
  retired: "Retired",
};
export const PUBLICATION_TYPES = [
  "Free newsletter",
  "Paid newsletter",
  "Premium service",
  "Alert service",
  "Text letter (SMS)",
  "Membership",
  "Course",
  "Podcast or video",
  "Live events",
  "Other",
] as const;
export const PUBLICATION_TIERS = ["Free", "Front-end", "Mid-tier", "Back-end", "High-ticket", "Lifetime", "Bonus / complimentary"] as const;
/** Old tier names still accepted (imports, old forms) and stored as the new name. */
export const LEGACY_TIERS: Record<string, (typeof PUBLICATION_TIERS)[number]> = { "Free / lead gen": "Free" };
export const FREQUENCIES = ["Daily", "Weekdays", "Several times a week", "Weekly", "Every two weeks", "Monthly", "Quarterly", "As needed"] as const;

export const EDITOR_STATUSES = ["active", "inactive"] as const;
export const EDITOR_ROLES = ["lead", "co-editor", "contributor", "analyst", "guest"] as const;
export const EDITOR_ROLE_LABELS: Record<string, string> = {
  lead: "Lead editor",
  "co-editor": "Co-editor",
  contributor: "Contributor",
  analyst: "Analyst",
  guest: "Guest",
};

/** Email-safe and common web fonts. The CSS stack is in fontStack(). */
export const FONT_OPTIONS = [
  "Arial",
  "Helvetica",
  "Georgia",
  "Times New Roman",
  "Verdana",
  "Trebuchet MS",
  "Tahoma",
  "Garamond",
  "Courier New",
  "Inter",
  "Lato",
  "Merriweather",
  "Montserrat",
  "Open Sans",
  "Playfair Display",
  "Roboto",
  "Source Serif",
] as const;

const SERIF = new Set(["Georgia", "Times New Roman", "Garamond", "Merriweather", "Playfair Display", "Source Serif"]);

export function fontStack(font: string): string {
  if (font === "Courier New") return `"Courier New", Courier, monospace`;
  return `"${font}", ${SERIF.has(font) ? "Georgia, \"Times New Roman\", serif" : "Arial, Helvetica, sans-serif"}`;
}

export const PUBLICATION_FIELDS: readonly FieldDef[] = [
  { key: "name", label: "Name", kind: "text", group: "Basics", required: true, max: 120 },
  { key: "code", label: "Code", kind: "code", group: "Basics", required: true, max: 20, hint: "Short key, e.g. WAR. Send stats match issues on it." },
  { key: "slug", label: "URL name", kind: "slug", group: "Basics", max: 60, deriveFrom: "name", hint: "Used in links (the wiki, funnels). Leave blank to make one from the name." },
  { key: "tagline", label: "Tagline", kind: "text", group: "Basics", max: 200 },
  // Type was replaced by the brand's own categories (pub_type is kept for the internal funnel rule).
  { key: "categoryId", label: "Category", kind: "category", group: "Basics", internal: true, hint: "Websites list publications by category. Manage the list under Categories." },
  { key: "tier", label: "Tier", kind: "select", group: "Basics", options: PUBLICATION_TIERS, aliases: LEGACY_TIERS },
  { key: "frequency", label: "Frequency", kind: "select", group: "Basics", options: FREQUENCIES },
  { key: "status", label: "Status", kind: "select", group: "Basics", required: true, options: PUBLICATION_STATUSES },
  { key: "launchDate", label: "Launch date", kind: "date", group: "Basics" },
  { key: "color", label: "Calendar color", kind: "color", group: "Basics", required: true },
  { key: "sortOrder", label: "Order", kind: "number", group: "Basics", internal: true },
  { key: "description", label: "Short description", kind: "textarea", group: "Description", max: 600, rows: 2, hint: "One or two sentences. Shown in lists and pickers." },
  { key: "longDescription", label: "Long description", kind: "textarea", group: "Description", max: 8000, rows: 6 },
  { key: "positioning", label: "Positioning", kind: "textarea", group: "Description", max: 2000, rows: 3, hint: "What makes it different and why a reader picks it." },
  { key: "audience", label: "Audience", kind: "textarea", group: "Description", max: 1000, rows: 2, hint: "Who it is for, in plain words." },
  { key: "deliverables", label: "What readers get", kind: "list", group: "Description", max: 200, hint: "One per line." },
  { key: "retailPrice", label: "Retail price", kind: "text", group: "Pricing", max: 80, hint: "Annual list price, as you would write it, e.g. $7,500/yr." },
  { key: "lifetimePrice", label: "Unlimited / lifetime price", kind: "text", group: "Pricing", max: 80, hint: "e.g. $25,000 one-time." },
  { key: "salePrice", label: "Typical sale price", kind: "text", group: "Pricing", max: 80, hint: "What it usually sells for in promotions." },
  { key: "pricingNotes", label: "Pricing notes", kind: "textarea", group: "Pricing", max: 2000, rows: 2, hint: "Renewals, payment plans, who may offer what." },
  {
    key: "offers",
    label: "Price points and offers",
    kind: "pairs",
    group: "Pricing",
    maxRows: 8,
    columns: [
      { key: "label", label: "Offer", max: 120, placeholder: "Annual" },
      { key: "price", label: "Price", max: 40, placeholder: "$49" },
      { key: "term", label: "Term or note", max: 120, placeholder: "per year" },
    ],
  },
  { key: "websiteUrl", label: "Website", kind: "url", group: "Links" },
  { key: "signupUrl", label: "Sign-up / order page", kind: "url", group: "Links" },
  { key: "archiveUrl", label: "Archive", kind: "url", group: "Links" },
  {
    key: "sampleIssues",
    label: "Sample issues",
    kind: "pairs",
    group: "Links",
    maxRows: 6,
    columns: [
      { key: "title", label: "Title", max: 200 },
      { key: "url", label: "Link", kind: "url", max: 1000 },
    ],
  },
  {
    key: "faq",
    label: "Questions and answers",
    kind: "pairs",
    group: "Website",
    maxRows: 8,
    hint: "Shown on the publication's page on your website. Leave empty to hide the section.",
    columns: [
      { key: "question", label: "Question", max: 200 },
      { key: "answer", label: "Answer", max: 1500 },
    ],
  },
  { key: "voiceNotes", label: "Voice and style", kind: "textarea", group: "Voice and compliance", max: 3000, rows: 3, hint: "How it sounds. Writers and AI drafts follow this." },
  { key: "complianceNotes", label: "Compliance notes", kind: "textarea", group: "Voice and compliance", max: 3000, rows: 3, hint: "Rules on top of the brand's. One per line." },
];

export const EDITOR_FIELDS: readonly FieldDef[] = [
  { key: "name", label: "Name", kind: "text", group: "Profile", required: true, max: 120 },
  { key: "slug", label: "URL name", kind: "slug", group: "Profile", max: 60, deriveFrom: "name", hint: "Leave blank to make one from the name." },
  { key: "title", label: "Title", kind: "text", group: "Profile", max: 160, hint: "e.g. Chief Strategist" },
  { key: "status", label: "Status", kind: "select", group: "Profile", required: true, options: EDITOR_STATUSES },
  { key: "email", label: "Email", kind: "email", group: "Profile", hint: "Internal only." },
  { key: "sortOrder", label: "Order", kind: "number", group: "Profile", internal: true },
  { key: "shortBio", label: "Short bio", kind: "textarea", group: "Bio", max: 800, rows: 3 },
  { key: "longBio", label: "Long bio", kind: "textarea", group: "Bio", max: 10000, rows: 8 },
  { key: "credentials", label: "Credentials", kind: "textarea", group: "Bio", max: 2000, rows: 3, hint: "Degrees, past roles, books, awards." },
  { key: "trackRecord", label: "Track record summary", kind: "textarea", group: "Bio", max: 3000, rows: 3, hint: "In words. Numbers here are what people typed; apps never invent them." },
  { key: "specialties", label: "Specialties", kind: "list", group: "Bio", max: 120, hint: "One per line." },
  {
    key: "socialLinks",
    label: "Social and web links",
    kind: "pairs",
    group: "Links",
    maxRows: 6,
    columns: [
      { key: "label", label: "Site", max: 60, placeholder: "X" },
      { key: "url", label: "Link", kind: "url", max: 1000 },
    ],
  },
  { key: "voiceNotes", label: "Voice and style", kind: "textarea", group: "Voice", max: 3000, rows: 4, hint: "How this editor writes: tone, phrases, sign-off." },
];

/**
 * Text branding values. Logos are handled separately as bytes (two slots, see logos.ts).
 * Email branding (sender, footer, header image) was removed from the app; its columns stay.
 */
export const BRANDING_FIELDS: readonly FieldDef[] = [
  { key: "primaryColor", label: "Header color", kind: "color", group: "Colors" },
  { key: "accentColor", label: "Accent (links, buttons)", kind: "color", group: "Colors" },
  { key: "textColor", label: "Text color", kind: "color", group: "Colors" },
  { key: "backgroundColor", label: "Background", kind: "color", group: "Colors" },
  { key: "headingFont", label: "Heading font", kind: "font", group: "Fonts" },
  { key: "bodyFont", label: "Body font", kind: "font", group: "Fonts" },
  { key: "tagline", label: "Tagline", kind: "text", group: "Identity", max: 200 },
];

export function fieldGroups(defs: readonly FieldDef[]): { group: string; fields: FieldDef[] }[] {
  const groups: { group: string; fields: FieldDef[] }[] = [];
  for (const def of defs) {
    const found = groups.find((g) => g.group === def.group);
    if (found) found.fields.push(def);
    else groups.push({ group: def.group, fields: [def] });
  }
  return groups;
}

export function optionLabel(def: FieldDef, value: string): string {
  if (def.key === "status") return PUBLICATION_STATUS_LABELS[value] ?? (value === "inactive" ? "Inactive" : value.charAt(0).toUpperCase() + value.slice(1));
  return value;
}

// ── Parsing and validation ─────────────────────────────────────────────────

/** Anything FormData-shaped. */
export type FormLike = { getAll(name: string): unknown[] };

const HEX = /^#[0-9a-f]{6}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE = /^[A-Z0-9][A-Z0-9_-]{0,19}$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** The first free slug: base, base-2, base-3... */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = base || "item";
  if (!used.has(root)) return root;
  for (let n = 2; ; n += 1) {
    const candidate = `${root.slice(0, 56)}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Normalizes a URL people typed. Null when it is not an http(s) link. */
export function normalizeUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname.includes(".")) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function first(form: FormLike, name: string): string {
  const value = form.getAll(name)[0];
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

function validDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export type ParseResult = { ok: true; values: FieldValues } | { ok: false; values: FieldValues; errors: Record<string, string> };

/** Read and validate one record. Pair rows use inputs named `<key>.<row>.<column>`. */
export function parseFields(defs: readonly FieldDef[], form: FormLike): ParseResult {
  const values: FieldValues = {};
  const errors: Record<string, string> = {};
  for (const def of defs) {
    const raw = first(form, def.key);
    const max = def.max ?? (def.kind === "url" ? 1000 : 300);
    switch (def.kind) {
      case "pairs": {
        const rows: Pair[] = [];
        for (let i = 0; i < (def.maxRows ?? 6); i += 1) {
          const row: Pair = {};
          let filled = false;
          for (const column of def.columns ?? []) {
            let cell = first(form, `${def.key}.${i}.${column.key}`).slice(0, column.max ?? 300);
            if (cell) filled = true;
            if (cell && column.kind === "url") {
              const url = normalizeUrl(cell);
              if (!url) errors[def.key] = `${column.label} in row ${i + 1} is not a web link.`;
              cell = url ?? cell;
            }
            row[column.key] = cell;
          }
          if (filled) rows.push(row);
        }
        values[def.key] = rows;
        break;
      }
      case "list": {
        const items = [...new Set(raw.split("\n").map((line) => line.replace(/^[-*•]\s*/, "").trim()).filter(Boolean))];
        if (items.some((item) => item.length > max)) errors[def.key] = `Keep each line under ${max} characters.`;
        if (items.length > 40) errors[def.key] = "Up to 40 lines.";
        values[def.key] = items.slice(0, 40);
        break;
      }
      case "number": {
        if (!raw) {
          values[def.key] = 0;
          break;
        }
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > 9999) errors[def.key] = "Use a whole number from 0 to 9999.";
        values[def.key] = Number.isInteger(n) ? n : 0;
        break;
      }
      default: {
        let value: string | null = raw || null;
        if (value && value.length > max) errors[def.key] = `Keep it under ${max} characters.`;
        if (value) {
          if (def.kind === "code") {
            value = value.toUpperCase();
            if (!CODE.test(value)) errors[def.key] = "Use letters, numbers, - or _ (up to 20).";
          } else if (def.kind === "slug") {
            value = value.toLowerCase();
            if (!SLUG.test(value)) errors[def.key] = "Use lowercase letters, numbers and hyphens.";
          } else if (def.kind === "url") {
            const url = normalizeUrl(value);
            if (!url) errors[def.key] = "Enter a web link (https://…).";
            else value = url;
          } else if (def.kind === "email") {
            value = value.toLowerCase();
            if (!EMAIL.test(value)) errors[def.key] = "Enter an email address.";
          } else if (def.kind === "color") {
            value = value.toLowerCase();
            if (!HEX.test(value)) errors[def.key] = "Use a color like #1d4ed8.";
          } else if (def.kind === "date") {
            if (!validDay(value)) errors[def.key] = "Use a real date (YYYY-MM-DD).";
          } else if (def.kind === "select") {
            value = def.aliases?.[value] ?? value;
            if (!def.options?.includes(value)) errors[def.key] = "Pick one of the options.";
          } else if (def.kind === "category") {
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) errors[def.key] = "Pick one of the categories.";
          } else if (def.kind === "font") {
            if (!(FONT_OPTIONS as readonly string[]).includes(value)) errors[def.key] = "Pick one of the fonts.";
          }
        }
        values[def.key] = value;
      }
    }
  }
  for (const def of defs) {
    if (def.kind === "slug" && !values[def.key] && def.deriveFrom) {
      const from = values[def.deriveFrom];
      values[def.key] = typeof from === "string" ? slugify(from) || null : null;
    }
    if (def.required) {
      const value = values[def.key];
      const empty = value == null || value === "" || (Array.isArray(value) && value.length === 0);
      if (empty && !errors[def.key]) errors[def.key] = `${def.label} is required.`;
    }
  }
  return Object.keys(errors).length ? { ok: false, values, errors } : { ok: true, values };
}

/** One message for a redirect flash: "Code: Use letters…". */
export function firstError(defs: readonly FieldDef[], errors: Record<string, string>): string {
  const def = defs.find((d) => errors[d.key]);
  return def ? `${def.label}: ${errors[def.key]}` : "Check the form.";
}

export function asPairs(value: unknown): Pair[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "string" ? v : ""])));
}
