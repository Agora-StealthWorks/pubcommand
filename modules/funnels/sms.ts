/**
 * Text-letter opt-ins: phone validation and the consent record. There is no SMS
 * provider yet, so nothing here sends a message; it only captures consent the
 * way a carrier audit expects (exact text shown, when, from which page).
 */

/**
 * Normalize to E.164 ("+15551234567"). A bare 10-digit number (or 11 digits
 * starting with 1) is read as North American (+1). Anything else must carry its
 * country code with a leading +. Null when it cannot be a real number.
 */
export function normalizePhone(input: string | null | undefined, defaultCountry: "US" | null = "US"): string | null {
  const text = (input ?? "").trim();
  if (!text || text.length > 32) return null;
  if (/[^0-9+().\s-]/.test(text)) return null;
  const plus = text.startsWith("+");
  if (text.slice(1).includes("+")) return null;
  const digits = text.replace(/\D/g, "");
  let e164: string;
  if (plus) e164 = `+${digits}`;
  else if (text.startsWith("00")) e164 = `+${digits.slice(2)}`;
  else if (defaultCountry === "US" && digits.length === 10) e164 = `+1${digits}`;
  else if (defaultCountry === "US" && digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
  else return null;
  return isE164(e164) ? e164 : null;
}

/** E.164: +, country code not starting with 0, 8 to 15 digits in total. North American numbers are checked more closely. */
export function isE164(value: string): boolean {
  if (!/^\+[1-9]\d{7,14}$/.test(value)) return false;
  if (value.startsWith("+1")) {
    // NANP: +1 NXX NXX XXXX, area code and exchange cannot start with 0 or 1.
    return /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(value);
  }
  return true;
}

/** "+15551234567" -> "(555) 123-4567"; other countries unchanged. */
export function formatPhone(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : e164;
}

/** The last 4 digits, for anything shown outside the export. */
export function maskPhone(e164: string): string {
  return `•••${e164.slice(-4)}`;
}

export type ConsentSite = {
  programName: string;
  companyName: string;
  messageFrequency: string;
  helpContact: string;
  privacyUrl: string | null;
  termsUrl: string | null;
};

/**
 * The exact consent sentence shown next to the checkbox. It is stored with every
 * opt-in, so a later edit to the site never rewrites what someone agreed to.
 */
export function consentText(site: ConsentSite): string {
  const program = site.programName.trim() || "text alerts";
  const company = site.companyName.trim() || "us";
  const frequency = site.messageFrequency.trim() || "Message frequency varies";
  const parts = [
    `By checking this box, I agree to receive recurring automated marketing text messages from ${company} (${program}) at the number provided.`,
    "Consent is not a condition of any purchase.",
    `${frequency.replace(/\.$/, "")}.`,
    "Msg & data rates may apply.",
    "Reply STOP to cancel or HELP for help" + (site.helpContact.trim() ? ` (or contact ${site.helpContact.trim()})` : "") + ".",
  ];
  const links = [site.privacyUrl ? `Privacy Policy: ${site.privacyUrl}` : null, site.termsUrl ? `Terms: ${site.termsUrl}` : null].filter(Boolean);
  if (links.length) parts.push(`${links.join(". ")}.`);
  return parts.join(" ");
}

export type OptinInput = {
  phone: string;
  consentChecked: boolean;
  /** The consent text the page showed (echoed by the form). */
  shownConsent: string;
  honeypot: string;
};

export type OptinRecord = { phone: string; consentText: string };

/**
 * Validate one subscribe submission against the CURRENT consent text. A form
 * rendered before an edit (different text) is refused so the stored text is
 * always what the person actually saw.
 */
export function captureOptin(input: OptinInput, currentConsent: string): { ok: true; record: OptinRecord } | { ok: false; error: string; spam?: boolean } {
  if (input.honeypot.trim()) return { ok: false, error: "Thanks!", spam: true };
  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, error: "Enter a valid mobile number, including the area code." };
  if (!input.consentChecked) return { ok: false, error: "Check the box to agree to receive text messages." };
  if (input.shownConsent.trim() !== currentConsent.trim()) return { ok: false, error: "This page was updated. Please review the terms and try again." };
  return { ok: true, record: { phone, consentText: currentConsent } };
}

/** The compliance block shown under every subscribe form and in every site footer. */
export function complianceLines(site: ConsentSite): string[] {
  return [
    `${site.messageFrequency.trim() || "Message frequency varies"}. Msg & data rates may apply.`,
    "Text STOP to cancel at any time. Text HELP for help.",
    "Consent is not a condition of purchase.",
  ];
}

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i.test(value);
}
