import { excerptBody } from "./excerpt";

export type EmailInsights = {
  excerpt: string;
  /** TODO: extract rates, products, and competitor mentions from the body. */
  insights: readonly [];
};

// TODO: Replace this stub with an email extractor. Do not fetch remote images or links.
export function extractEmailInsights(body: string): EmailInsights {
  return { excerpt: excerptBody(body), insights: [] };
}
