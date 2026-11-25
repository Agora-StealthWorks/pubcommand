/**
 * One simple, clean email layout (HTML + plain text) for transactional emails:
 * a logo (or the sender's name when there is no logo), a heading, short
 * paragraphs, one button, and a small footnote. Table-based with inline styles
 * so it renders in Outlook and Gmail. Pure: no I/O.
 *
 * Use a PNG or JPEG logo by absolute URL. Many email clients block SVG.
 */

import { bodyParagraphs, fillPlaceholders, systemEmailCopy, type SystemEmailKey, type SystemEmailOverrides } from "./system-emails";

export type EmailLayoutInput = {
  /** Shown as the logo's alt text, and as text when there is no logo. */
  senderName: string;
  /** Absolute https (or local http) URL of a PNG/JPEG logo. */
  logoUrl?: string | null;
  heading: string;
  /** Plain text. Each one becomes a paragraph. */
  paragraphs: string[];
  button: { label: string; url: string; color?: string | null };
  /** Small grey text under the button (plain text). */
  footnote?: string | null;
  /**
   * A brand's look (e.g. a website's theme). Without it the email is the plain white card.
   * headerBackground: a colour band behind the logo / wordmark; headerText: wordmark colour;
   * pageBackground: around the card; buttonText: text on the button.
   */
  look?: { headerBackground?: string | null; headerText?: string | null; pageBackground?: string | null; buttonText?: string | null; accentBar?: string | null } | null;
  /** Lines under the card (plain text): who it's from, how to reach them. */
  footer?: string[] | null;
  /**
   * A skinny bar across the card directly under the header, with a logo centred in it
   * (PubCommand's system emails: black, with the white Agora StealthWorks logo). Without an image
   * the alt text is shown in small capitals.
   */
  headerBar?: { background: string; imageUrl?: string | null; alt: string; textColor?: string | null } | null;
  /** Centre the logo / wordmark in a white masthead (with a rule under it when ruleColor is set), instead of top-left. */
  masthead?: { ruleColor?: string | null } | null;
};

const DEFAULT_BUTTON = "#7C3AED";

/** Escapes text for HTML text and attribute values. */
export function escapeEmailHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function safeColor(value: string | null | undefined, fallback = DEFAULT_BUTTON): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function renderEmailLayout(input: EmailLayoutInput): { html: string; text: string } {
  const name = escapeEmailHtml(input.senderName);
  const logo = safeUrl(input.logoUrl);
  const href = safeUrl(input.button.url) ?? "#";
  const color = safeColor(input.button.color);
  const look = input.look ?? null;
  const band = look?.headerBackground ? safeColor(look.headerBackground, "#101828") : null;
  const wordmarkColor = safeColor(look?.headerText, band ? "#ffffff" : "#101828");
  const pageBg = safeColor(look?.pageBackground, "#f5f6f8");
  const buttonText = safeColor(look?.buttonText, "#ffffff");
  const accent = look?.accentBar ? safeColor(look.accentBar) : null;
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const header = logo
    ? `<img src="${escapeEmailHtml(logo)}" alt="${name}" height="36" style="display:${input.masthead ? "inline-block" : "block"};height:36px;width:auto;max-width:220px;border:0;outline:none;text-decoration:none">`
    : band
      ? `<span style="font-size:20px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${wordmarkColor}">${name}</span>`
      : `<span style="font-size:18px;font-weight:700;color:${wordmarkColor}">${name}</span>`;
  const headerBar = input.headerBar ?? null;
  const headerBarImage = safeUrl(headerBar?.imageUrl);
  const headerBarRow = headerBar
    ? `<tr><td align="center" style="padding:9px 16px;background:${safeColor(headerBar.background, "#000000")};line-height:0;font-size:0">${
        headerBarImage
          ? `<img src="${escapeEmailHtml(headerBarImage)}" alt="${escapeEmailHtml(headerBar.alt)}" height="18" style="display:inline-block;height:18px;width:auto;max-width:200px;border:0;outline:none;text-decoration:none">`
          : `<span style="font-size:11px;line-height:18px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${safeColor(headerBar.textColor, "#ffffff")}">${escapeEmailHtml(headerBar.alt)}</span>`
      }</td></tr>`
    : "";
  // The first row of the card carries its rounded top corners.
  const roundTop = (first: boolean) => (first ? "border-radius:12px 12px 0 0;" : "");
  const accentRow = accent ? `<tr><td style="height:6px;line-height:6px;font-size:0;background:${accent};${roundTop(true)}">&nbsp;</td></tr>` : "";
  const firstHeader = !accent;
  const masthead = input.masthead ?? null;
  const mastheadRule = masthead?.ruleColor ? `border-bottom:3px solid ${safeColor(masthead.ruleColor, "#e4e7ec")};` : "";
  const headerRow = masthead
    ? `${accentRow}<tr><td align="center" style="padding:24px 32px 22px;${band ? `background:${band};` : ""}${mastheadRule}${roundTop(firstHeader)}">${header}</td></tr>${headerBarRow}`
    : band
      ? `${accentRow}<tr><td style="padding:22px 32px;background:${band};${roundTop(firstHeader)}">${header}</td></tr>${headerBarRow}`
      : `${accentRow}<tr><td style="padding:28px 32px ${headerBar ? "24px" : "0"}">${header}</td></tr>${headerBarRow}`;
  const footerHtml = input.footer?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px"><tr><td align="center" style="padding:16px 32px 0;font-family:${font};font-size:12px;line-height:18px;color:#667085">${input.footer.map((line) => escapeEmailHtml(line)).join("<br>")}</td></tr></table>`
    : "";
  const paragraphs = input.paragraphs
    .map((text) => `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#344054">${escapeEmailHtml(text)}</p>`)
    .join("");
  const footnote = input.footnote
    ? `<p style="margin:24px 0 0;font-size:13px;line-height:20px;color:#667085">${escapeEmailHtml(input.footnote)}</p>`
    : "";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeEmailHtml(input.heading)}</title></head>
<body style="margin:0;padding:0;background:${pageBg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${pageBg}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border:1px solid #e4e7ec;border-radius:12px;font-family:${font}">
${headerRow}
<tr><td style="padding:${masthead ? "28px" : "24px"} 32px 32px">
<h1 style="margin:0 0 16px;font-size:20px;line-height:28px;font-weight:600;color:#101828">${escapeEmailHtml(input.heading)}</h1>
${paragraphs}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0"><tr><td style="border-radius:8px;background:${color}">
<a href="${escapeEmailHtml(href)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:${buttonText};text-decoration:none;border-radius:8px">${escapeEmailHtml(input.button.label)}</a>
</td></tr></table>
<p style="margin:20px 0 0;font-size:13px;line-height:20px;color:#667085">If the button does not work, copy this link into your browser:<br><a href="${escapeEmailHtml(href)}" style="color:#475467;word-break:break-all">${escapeEmailHtml(href)}</a></p>
${footnote}
</td></tr>
</table>
${footerHtml}
</td></tr>
</table>
</body></html>`;
  const text = [
    input.heading,
    "",
    ...input.paragraphs.flatMap((p) => [p, ""]),
    `${input.button.label}: ${input.button.url}`,
    ...(input.footnote ? ["", input.footnote] : []),
    "",
    `— ${input.senderName}`,
    ...(input.footer?.length ? ["", ...input.footer] : []),
  ].join("\n");
  return { html, text };
}

// PubCommand's own system emails ------------------------------------------------

/** PubCommand brand colours (apps/web/public/brand): violet mark, deep indigo wordmark. */
export const PUBCOMMAND_EMAIL_BRAND = { violet: "#7C3AED", indigo: "#1E1B4B", lilac: "#F5F3FF" } as const;

/** Who owns PubCommand, named in the top bar and footer of its system emails. */
export const PUBCOMMAND_OWNER = "Agora StealthWorks";

/**
 * PubCommand's branded template for system emails sent from PubCommand itself
 * (password reset, invites, sign-in links), never an organization's own mail:
 * the PubCommand masthead (logo centred on white), a skinny black bar under it with the
 * white "By Agora StealthWorks" logo, a violet button on a lilac page, and a
 * PubCommand footer. `origin` is the site the link points at; the logos are served from it.
 */
export function pubcommandSystemEmail(input: {
  origin: string | null;
  subject: string;
  heading: string;
  paragraphs: string[];
  button: { label: string; url: string };
  footnote?: string | null;
}): { subject: string; html: string; text: string } {
  const base = input.origin ? input.origin.replace(/\/+$/, "") : null;
  const body = renderEmailLayout({
    senderName: "PubCommand",
    logoUrl: base ? `${base}/brand/logo-light.png` : null,
    heading: input.heading,
    paragraphs: input.paragraphs,
    button: { ...input.button, color: PUBCOMMAND_EMAIL_BRAND.violet },
    footnote: input.footnote ?? null,
    look: { pageBackground: PUBCOMMAND_EMAIL_BRAND.lilac, headerText: PUBCOMMAND_EMAIL_BRAND.indigo },
    headerBar: { background: "#000000", imageUrl: base ? `${base}/brand/agora-stealthworks-white.png` : null, alt: `By ${PUBCOMMAND_OWNER}` },
    masthead: {},
    footer: [`PubCommand by ${PUBCOMMAND_OWNER} · pubcommand.com`, "This is an account email from PubCommand. You get it because of an action on your PubCommand account."],
  });
  return { subject: input.subject, ...body };
}

/**
 * One system email with its current copy (defaults merged with staff edits) and placeholders
 * filled. Used for real sends and for the console's preview, so the two always match.
 */
export function renderSystemEmail(
  key: SystemEmailKey,
  input: { link: string; origin: string | null; values?: Record<string, string>; overrides?: SystemEmailOverrides | null },
): { subject: string; html: string; text: string } {
  const copy = systemEmailCopy(key, input.overrides);
  const values = input.values ?? {};
  const fill = (text: string) => fillPlaceholders(text, values);
  const footnote = fill(copy.footnote).trim();
  return pubcommandSystemEmail({
    origin: input.origin,
    subject: fill(copy.subject).trim(),
    heading: fill(copy.heading).trim(),
    paragraphs: bodyParagraphs(fill(copy.body)),
    button: { label: fill(copy.buttonLabel).trim(), url: input.link },
    footnote: footnote || null,
  });
}

function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** The "Reset your PubCommand password" email for PubCommand users (staff and organization users). */
export function passwordResetEmail(input: {
  link: string;
  logoUrl?: string | null;
  origin?: string | null;
  minutes: number;
  overrides?: SystemEmailOverrides | null;
}): { subject: string; html: string; text: string } {
  const origin = input.origin ?? originOf(input.logoUrl ?? input.link);
  return renderSystemEmail("password_reset", { link: input.link, origin, values: { minutes: String(input.minutes) }, overrides: input.overrides });
}

/** The invite email: someone added this person to an organization (or to PubCommand staff). */
export function inviteEmail(input: { link: string; origin: string | null; organizationName?: string | null; overrides?: SystemEmailOverrides | null }): {
  subject: string;
  html: string;
  text: string;
} {
  const org = input.organizationName?.trim() || null;
  return org
    ? renderSystemEmail("invite_organization", { link: input.link, origin: input.origin, values: { organization: org }, overrides: input.overrides })
    : renderSystemEmail("invite_staff", { link: input.link, origin: input.origin, overrides: input.overrides });
}

/** The "Email me a link" sign-in email. */
export function signInLinkEmail(input: { link: string; origin: string | null; overrides?: SystemEmailOverrides | null }): { subject: string; html: string; text: string } {
  return renderSystemEmail("sign_in", { link: input.link, origin: input.origin, overrides: input.overrides });
}
