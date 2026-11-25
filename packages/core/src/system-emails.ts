/**
 * PubCommand's own system emails (invites, sign-in links, password resets): their default copy,
 * the placeholders each one accepts, and how staff edits (Admin → Emails) are merged and checked.
 * Pure: the edits are stored by the web app (platform_settings key "system_email_copy") and passed in.
 */

export const SYSTEM_EMAIL_KEYS = ["invite_organization", "invite_staff", "sign_in", "password_reset"] as const;
export type SystemEmailKey = (typeof SYSTEM_EMAIL_KEYS)[number];

/** The editable parts of one email. `body` is plain text; a blank line starts a new paragraph. */
export type SystemEmailCopy = {
  subject: string;
  heading: string;
  body: string;
  buttonLabel: string;
  footnote: string;
};

export const SYSTEM_EMAIL_FIELDS = ["subject", "heading", "body", "buttonLabel", "footnote"] as const satisfies readonly (keyof SystemEmailCopy)[];

/** Staff edits, per email. A missing email or field means the default is used. */
export type SystemEmailOverrides = Partial<Record<SystemEmailKey, Partial<SystemEmailCopy>>>;

export type SystemEmailDefinition = {
  name: string;
  /** When PubCommand sends it. */
  when: string;
  /** Placeholders the copy may use, written {name}. */
  placeholders: Record<string, string>;
  /** Values for previews and test sends. */
  sample: Record<string, string>;
  defaults: SystemEmailCopy;
};

export const SYSTEM_EMAILS: Record<SystemEmailKey, SystemEmailDefinition> = {
  invite_organization: {
    name: "Invite to an organization",
    when: "Someone adds a person to an organization (Settings → Members, or Organizations in this console).",
    placeholders: { organization: "The organization they are joining" },
    sample: { organization: "Example Gazette" },
    defaults: {
      subject: "You're invited to {organization} on PubCommand",
      heading: "Join {organization} on PubCommand",
      body: [
        "You have been invited to {organization} on PubCommand.",
        "Use the button below to sign in. Then set a password under Your account so you can sign in with it next time.",
        "The link works once and expires soon.",
      ].join("\n\n"),
      buttonLabel: "Accept invite",
      footnote: "If you did not expect this invite, you can ignore this email.",
    },
  },
  invite_staff: {
    name: "Invite to PubCommand staff",
    when: "A super admin adds someone under Staff in this console.",
    placeholders: {},
    sample: {},
    defaults: {
      subject: "You're invited to PubCommand",
      heading: "You're invited to PubCommand",
      body: [
        "You have been invited to PubCommand.",
        "Use the button below to sign in. Then set a password under Your account so you can sign in with it next time.",
        "The link works once and expires soon.",
      ].join("\n\n"),
      buttonLabel: "Accept invite",
      footnote: "If you did not expect this invite, you can ignore this email.",
    },
  },
  sign_in: {
    name: "Sign-in link",
    when: "Someone uses \"Email me a link\" on the login page (only when email sign-in is switched on).",
    placeholders: {},
    sample: {},
    defaults: {
      subject: "Your PubCommand sign-in link",
      heading: "Sign in to PubCommand",
      body: ["Use the button below to sign in to PubCommand.", "The link works once and expires soon."].join("\n\n"),
      buttonLabel: "Sign in",
      footnote: "If you did not ask to sign in, you can ignore this email.",
    },
  },
  password_reset: {
    name: "Password reset",
    when: "Someone uses \"Forgot password\" on the login page.",
    placeholders: { minutes: "How many minutes the link stays valid" },
    sample: { minutes: "30" },
    defaults: {
      subject: "Reset your PubCommand password",
      heading: "Reset your password",
      body: [
        "Someone asked to reset the password for your PubCommand account. Use the button below to choose a new one.",
        "The link works once and expires in {minutes} minutes.",
      ].join("\n\n"),
      buttonLabel: "Choose a new password",
      footnote: "If you did not ask for this, you can ignore this email. Your password stays as it is.",
    },
  },
};

export const SYSTEM_EMAIL_LIMITS: Record<keyof SystemEmailCopy, number> = {
  subject: 150,
  heading: 150,
  body: 3000,
  buttonLabel: 40,
  footnote: 500,
};

export function isSystemEmailKey(value: unknown): value is SystemEmailKey {
  return typeof value === "string" && (SYSTEM_EMAIL_KEYS as readonly string[]).includes(value);
}

/** The copy that will be sent: each field's edit when it has one, otherwise the default. */
export function systemEmailCopy(key: SystemEmailKey, overrides?: SystemEmailOverrides | null): SystemEmailCopy {
  const defaults = SYSTEM_EMAILS[key].defaults;
  const edit = overrides?.[key] ?? {};
  const pick = (field: keyof SystemEmailCopy) => {
    const value = edit[field];
    return typeof value === "string" && (value.trim() || field === "footnote") ? value : defaults[field];
  };
  return { subject: pick("subject"), heading: pick("heading"), body: pick("body"), buttonLabel: pick("buttonLabel"), footnote: pick("footnote") };
}

/** Replaces {name} with its value. Unknown names are left as written. */
export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{([a-z_]+)\}/g, (match, name: string) => (Object.hasOwn(values, name) ? values[name]! : match));
}

/** The body split into paragraphs at blank lines; single line breaks inside a paragraph become spaces. */
export function bodyParagraphs(body: string): string[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

/** Why an edit can't be saved, or null. */
export function systemEmailCopyProblem(key: SystemEmailKey, copy: SystemEmailCopy): string | null {
  const labels: Record<keyof SystemEmailCopy, string> = { subject: "Subject", heading: "Heading", body: "Body", buttonLabel: "Button label", footnote: "Footnote" };
  for (const field of SYSTEM_EMAIL_FIELDS) {
    const value = copy[field];
    if (field !== "footnote" && !value.trim()) return `${labels[field]} can't be empty.`;
    if (value.length > SYSTEM_EMAIL_LIMITS[field]) return `${labels[field]} is too long (${SYSTEM_EMAIL_LIMITS[field]} characters at most).`;
    if (field !== "body" && /[\r\n]/.test(value)) return `${labels[field]} must be one line.`;
    const allowed = SYSTEM_EMAILS[key].placeholders;
    for (const [, name] of value.matchAll(/\{([a-z_]+)\}/g)) {
      if (!Object.hasOwn(allowed, name!)) {
        const list = Object.keys(allowed);
        return `${labels[field]} uses {${name}}, which this email doesn't have.${list.length ? ` It can use ${list.map((item) => `{${item}}`).join(", ")}.` : " It has no placeholders."}`;
      }
    }
  }
  return null;
}

/** Keeps only known emails and fields, as strings, cut to their limits. For reading stored edits. */
export function parseSystemEmailOverrides(value: unknown): SystemEmailOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: SystemEmailOverrides = {};
  for (const key of SYSTEM_EMAIL_KEYS) {
    const edit = (value as Record<string, unknown>)[key];
    if (!edit || typeof edit !== "object" || Array.isArray(edit)) continue;
    const clean: Partial<SystemEmailCopy> = {};
    for (const field of SYSTEM_EMAIL_FIELDS) {
      const text = (edit as Record<string, unknown>)[field];
      if (typeof text === "string") clean[field] = text.slice(0, SYSTEM_EMAIL_LIMITS[field]);
    }
    if (Object.keys(clean).length) result[key] = clean;
  }
  return result;
}
