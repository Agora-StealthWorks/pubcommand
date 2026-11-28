/**
 * Sender and deliverability facts read from an email's own headers, whatever the
 * provider (Gmail, MachineMail, an upload). Provider-specific extras (spam score…)
 * are merged in by the provider adapter. Pure.
 */
export type SenderFacts = {
  espName: string | null;
  campaignId: string | null;
  listIdHeader: string | null;
  authResults: { spf: string | null; dkim: string | null; dmarc: string | null } | null;
  sendingIp: string | null;
};

const ESP_SIGNATURES: [RegExp, string][] = [
  [/sparkpost|messagesystems|msys/i, "SparkPost"],
  [/sendgrid/i, "SendGrid"],
  [/mailchimp|mcsv\.net|mcdlv\.net|mandrill/i, "Mailchimp"],
  [/amazonses|amazon ses/i, "Amazon SES"],
  [/exacttarget|salesforce|sfmc/i, "Salesforce Marketing Cloud"],
  [/iterable/i, "Iterable"],
  [/klaviyo/i, "Klaviyo"],
  [/beehiiv/i, "beehiiv"],
  [/substack/i, "Substack"],
  [/hubspot/i, "HubSpot"],
  [/infusionsoft|keap/i, "Keap"],
  [/activecampaign|acems/i, "ActiveCampaign"],
  [/maropost/i, "Maropost"],
  [/sailthru/i, "Sailthru"],
  [/postmark/i, "Postmark"],
  [/mailgun/i, "Mailgun"],
  [/omeda/i, "Omeda"],
  [/whatcounts/i, "WhatCounts"],
  [/cheetah|experian/i, "Cheetah Digital"],
  [/ongage/i, "Ongage"],
  [/emarsys/i, "Emarsys"],
];

const CAMPAIGN_HEADERS = ["x-campaign", "x-campaign-id", "x-campaignid", "x-mc-campaign", "x-mailgun-campaign-id", "x-sfmc-stack", "x-job", "x-jobid", "x-mailer-campaign", "x-sg-eid", "x-ses-configuration-set", "x-emarsys-campaign", "x-iterable-campaign-id"];

function authValue(results: string, method: string): string | null {
  const m = results.match(new RegExp(`\\b${method}\\s*=\\s*([a-z]+)`, "i"));
  return m ? m[1]!.toLowerCase() : null;
}

export function senderFacts(headers: Record<string, string>): SenderFacts {
  const h = (name: string) => headers[name.toLowerCase()] ?? null;
  const haystack = [h("x-mailer"), h("x-sender"), h("return-path"), h("received"), h("dkim-signature"), h("feedback-id"), h("x-feedback-id"), h("list-unsubscribe"), h("message-id")].filter(Boolean).join(" ");
  const esp = ESP_SIGNATURES.find(([re]) => re.test(haystack))?.[1] ?? null;
  const campaign = CAMPAIGN_HEADERS.map((name) => h(name)).find((v) => v && v.trim()) ?? h("feedback-id")?.split(":")[0] ?? null;
  const listId = h("list-id")?.match(/<([^>]+)>/)?.[1] ?? h("list-id") ?? null;
  const results = h("authentication-results") ?? h("arc-authentication-results");
  const auth = results ? { spf: authValue(results, "spf"), dkim: authValue(results, "dkim"), dmarc: authValue(results, "dmarc") } : null;
  const ip = (h("x-originating-ip") ?? h("received-spf") ?? h("received") ?? "").match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/)?.[1] ?? null;
  return {
    espName: esp,
    campaignId: campaign ? campaign.trim().slice(0, 200) : null,
    listIdHeader: listId ? listId.trim().slice(0, 300) : null,
    authResults: auth,
    sendingIp: ip,
  };
}

/** The first few lines of the email, used by "masthead" routing conditions. */
export function mastheadText(text: string, mastheads: readonly string[]): string {
  return [mastheads.join(" | "), text.split("\n").slice(0, 6).join(" ")].filter(Boolean).join(" | ").slice(0, 1000);
}
