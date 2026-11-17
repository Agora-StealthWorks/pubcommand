import { MarketError, type FetchLike } from "./types";

export const defaultFetch: FetchLike = (url, init) => fetch(url, { ...init, cache: "no-store" } as RequestInit);

/** GET with a timeout. Network failures (blocked host, DNS, timeout) become MarketError("unavailable"). */
export async function get(fetcher: FetchLike, url: string, provider: string, headers?: Record<string, string>, timeoutMs = 20_000) {
  try {
    return await fetcher(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "could not be reached";
    throw new MarketError("unavailable", `${provider} ${reason} from this server.`);
  }
}

export async function failure(provider: string, status: number, body: string, label: string): Promise<MarketError> {
  if (status === 401) return new MarketError("unconfigured", `${provider} rejected the API key.`);
  if (status === 403) return new MarketError("not_entitled", `${provider}: our plan does not include ${label}.`);
  if (status === 404) return new MarketError("not_found", `${provider} has no data for ${label}.`);
  if (status === 429) return new MarketError("unavailable", `${provider} rate limit reached. Try again in a minute.`);
  if (status >= 500) return new MarketError("unavailable", `${provider} is having trouble (${status}).`);
  return new MarketError("bad_request", `${provider} ${status}: ${body.slice(0, 160)}`);
}
