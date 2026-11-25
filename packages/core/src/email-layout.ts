/**
 * One simple, clean email layout (HTML + plain text) for transactional emails:
 * a logo (or the sender's name when there is no logo), a heading, short
 * paragraphs, one button, and a small footnote. Table-based with inline styles
 * so it renders in Outlook and Gmail. Pure: no I/O.
 *
 * Use a PNG or JPEG logo by absolute URL. Many email clients block SVG.
 */

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
    ? `<img src="${escapeEmailHtml(logo)}" alt="${name}" height="36" style="display:block;height:36px;width:auto;max-width:220px;border:0;outline:none;text-decoration:none">`
    : band
      ? `<span style="font-size:20px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${wordmarkColor}">${name}</span>`
      : `<span style="font-size:18px;font-weight:700;color:${wordmarkColor}">${name}</span>`;
  const accentRow = accent ? `<tr><td style="height:6px;line-height:6px;font-size:0;background:${accent};border-radius:12px 12px 0 0">&nbsp;</td></tr>` : "";
  const headerRow = band
    ? `${accentRow}<tr><td style="padding:22px 32px;background:${band};${accent ? "" : "border-radius:12px 12px 0 0"}">${header}</td></tr>`
    : `${accentRow}<tr><td style="padding:28px 32px 0">${header}</td></tr>`;
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
<tr><td style="padding:24px 32px 32px">
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

/**
 * PubCommand's branded template for system emails sent from PubCommand itself
 * (password reset, invites, sign-in links), never an organization's own mail:
 * violet accent bar, the PubCommand logo, violet button on a lilac page, and a
 * PubCommand footer. `origin` is the site the link points at; the logo is served from it.
 */
export function pubcommandSystemEmail(input: {
  origin: string | null;
  subject: string;
  heading: string;
  paragraphs: string[];
  button: { label: string; url: string };
  footnote?: string | null;
}): { subject: string; html: string; text: string } {
  const body = renderEmailLayout({
    senderName: "PubCommand",
    logoUrl: input.origin ? `${input.origin.replace(/\/+$/, "")}/brand/logo-light.png` : null,
    heading: input.heading,
    paragraphs: input.paragraphs,
    button: { ...input.button, color: PUBCOMMAND_EMAIL_BRAND.violet },
    footnote: input.footnote ?? null,
    look: { pageBackground: PUBCOMMAND_EMAIL_BRAND.lilac, headerText: PUBCOMMAND_EMAIL_BRAND.indigo, accentBar: PUBCOMMAND_EMAIL_BRAND.violet },
    footer: ["PubCommand · pubcommand.com", "This is an account email from PubCommand. You get it because of an action on your PubCommand account."],
  });
  return { subject: input.subject, ...body };
}

/** The "Reset your PubCommand password" email for PubCommand users (staff and organization users). */
export function passwordResetEmail(input: { link: string; logoUrl?: string | null; origin?: string | null; minutes: number }): { subject: string; html: string; text: string } {
  let origin = input.origin ?? null;
  if (!origin) {
    try {
      origin = new URL(input.logoUrl ?? input.link).origin;
    } catch {
      origin = null;
    }
  }
  return pubcommandSystemEmail({
    origin,
    subject: "Reset your PubCommand password",
    heading: "Reset your password",
    paragraphs: [
      "Someone asked to reset the password for your PubCommand account. Use the button below to choose a new one.",
      `The link works once and expires in ${input.minutes} minutes.`,
    ],
    button: { label: "Choose a new password", url: input.link },
    footnote: "If you did not ask for this, you can ignore this email. Your password stays as it is.",
  });
}

/** The invite email: someone added this person to an organization (or to PubCommand staff). */
export function inviteEmail(input: { link: string; origin: string | null; organizationName?: string | null }): { subject: string; html: string; text: string } {
  const org = input.organizationName?.trim() || null;
  return pubcommandSystemEmail({
    origin: input.origin,
    subject: org ? `You're invited to ${org} on PubCommand` : "You're invited to PubCommand",
    heading: org ? `Join ${org} on PubCommand` : "You're invited to PubCommand",
    paragraphs: [
      org ? `You have been invited to ${org} on PubCommand.` : "You have been invited to PubCommand.",
      "Use the button below to sign in. Then set a password under Your account so you can sign in with it next time.",
      "The link works once and expires soon.",
    ],
    button: { label: "Accept invite", url: input.link },
    footnote: "If you did not expect this invite, you can ignore this email.",
  });
}

/** The "Email me a link" sign-in email. */
export function signInLinkEmail(input: { link: string; origin: string | null }): { subject: string; html: string; text: string } {
  return pubcommandSystemEmail({
    origin: input.origin,
    subject: "Your PubCommand sign-in link",
    heading: "Sign in to PubCommand",
    paragraphs: ["Use the button below to sign in to PubCommand.", "The link works once and expires soon."],
    button: { label: "Sign in", url: input.link },
    footnote: "If you did not ask to sign in, you can ignore this email.",
  });
}
