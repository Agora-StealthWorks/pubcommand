/** Shared bits of the OAuth endpoints for AI agent connectors (see features/agents/oauth.ts). */

export const OAUTH_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
  // Connectors call these from browsers and servers alike.
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

export function oauthJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: OAUTH_HEADERS });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: OAUTH_HEADERS });
}

/** Form (application/x-www-form-urlencoded, the standard) or JSON body as URLSearchParams. */
export async function readForm(request: Request): Promise<URLSearchParams> {
  const text = (await request.text()).slice(0, 20_000);
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      return new URLSearchParams(Object.entries(body).filter(([, value]) => typeof value === "string") as [string, string][]);
    } catch {
      return new URLSearchParams();
    }
  }
  return new URLSearchParams(text);
}
