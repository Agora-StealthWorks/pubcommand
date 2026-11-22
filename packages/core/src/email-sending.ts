/**
 * Who an organization's email (website member emails) comes from, and through which Resend key.
 * Pure: callers load the senders and pass them in.
 *
 * - Sender fields resolve one by one: publication sender → brand sender → organization default.
 * - The key is the organization's own Resend key. Without one, PubCommand's key is used, and then
 *   the From address must be PubCommand's verified address (EMAIL_FROM) with the brand's name
 *   as the display name; the brand's address becomes the Reply-to.
 */

export type SenderFields = { fromName?: string | null; fromAddress?: string | null; replyTo?: string | null };

export type EmailRoute =
  | { kind: "org"; apiKey: string; from: string; replyTo: string | null }
  | { kind: "platform"; apiKey: string; from: string; replyTo: string | null }
  | { kind: "none"; from: string; replyTo: string | null };

const EMAIL = /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[^\s@<>"(),;:]+$/;

export function isEmailAddress(value: string | null | undefined): value is string {
  return Boolean(value && value.length <= 254 && EMAIL.test(value));
}

function clean(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

/** The address inside "Name <addr>" or a bare "addr". */
export function addressOf(from: string): string {
  return (/<([^<>\s]+@[^<>\s]+)>/.exec(from)?.[1] ?? from).trim();
}

/** "Display Name" <addr>, with characters that would break the header removed. */
export function formatFrom(name: string | null | undefined, address: string): string {
  const display = (name ?? "").replace(/["\\<>\r\n]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return display ? `"${display}" <${address}>` : address;
}

/** Field by field: the first non-empty value of publication, brand, organization. */
export function resolveSender(layers: { publication?: SenderFields | null; brand?: SenderFields | null; organization?: SenderFields | null }): {
  fromName: string | null;
  fromAddress: string | null;
  replyTo: string | null;
} {
  const order = [layers.publication, layers.brand, layers.organization];
  const pick = (key: keyof SenderFields, valid: (v: string) => boolean = () => true) => {
    for (const layer of order) {
      const value = clean(layer?.[key]);
      if (value && valid(value)) return value;
    }
    return null;
  };
  return { fromName: pick("fromName"), fromAddress: pick("fromAddress", isEmailAddress), replyTo: pick("replyTo", isEmailAddress) };
}

/**
 * The key and From header for one email. `displayName` is used when no sender name is set
 * (the site's or brand's name). `platformFrom` is PubCommand's EMAIL_FROM.
 */
export function chooseEmailRoute(input: {
  orgApiKey: string | null;
  platformApiKey: string | null;
  platformFrom: string;
  sender: { fromName: string | null; fromAddress: string | null; replyTo: string | null };
  displayName: string;
}): EmailRoute {
  const name = input.sender.fromName ?? input.displayName;
  const orgKey = clean(input.orgApiKey);
  const platformKey = clean(input.platformApiKey);
  const platformAddress = addressOf(input.platformFrom);
  if (orgKey) {
    // Their own Resend account: their verified address. Without one, Resend will refuse PubCommand's domain,
    // so the platform address is still the best guess and the send reports the error.
    return { kind: "org", apiKey: orgKey, from: formatFrom(name, input.sender.fromAddress ?? platformAddress), replyTo: input.sender.replyTo };
  }
  const replyTo = input.sender.replyTo ?? input.sender.fromAddress;
  const from = formatFrom(name, platformAddress);
  if (platformKey) return { kind: "platform", apiKey: platformKey, from, replyTo };
  return { kind: "none", from, replyTo };
}
