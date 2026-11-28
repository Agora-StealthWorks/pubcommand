import { decodeHtmlBytes, guardedFetch, isHtmlContentType } from "../../../../../modules/intel/index";
import type { FetchPage } from "../../../../../modules/ispy/index";
import { fetchOnce, resolveHost } from "../intel/net";

const PAGE_LIMITS = { maxBytes: 3 * 1024 * 1024, timeoutMs: 20_000, maxRedirects: 10 };

/**
 * One SSRF-guarded page fetch for the promo resolver. Every hop is checked; the
 * destination URL is kept even on a 403/404 (a gated or expired link still tells us
 * where it lands), and only HTML bodies are returned.
 */
export const fetchPage: FetchPage = async (url) => {
  const res = await guardedFetch(url, { fetchOnce, resolve: resolveHost }, PAGE_LIMITS);
  if (!res.ok) return { finalUrl: res.finalUrl ?? url, status: res.status ?? 0, html: null, hops: 0, error: res.reason };
  const hops = res.redirects.length;
  if (res.status >= 400 || !isHtmlContentType(res.contentType)) return { finalUrl: res.finalUrl, status: res.status, html: null, hops };
  return { finalUrl: res.finalUrl, status: res.status, html: decodeHtmlBytes(res.body, res.contentType), hops };
};

/** A transcript page's text (or null). */
export async function fetchText(url: string): Promise<string | null> {
  const page = await fetchPage(url);
  return page.html;
}
