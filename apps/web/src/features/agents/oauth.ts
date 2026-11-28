import { platformTx, rawPrisma, tenantDb } from "@pubcommand/db";
import { CONSOLE_ORG_SLUG } from "@/lib/console-workspace";
import { issueAgentToken } from "./data";
import { ACCESS_TOKEN_TTL_SECONDS, OAUTH_CODE_TTL_SECONDS, hashToken, isAllowedRedirectUri, pkceMatches, randomValue, tokenKind } from "./tokens";

/**
 * OAuth 2.1 for the MCP server, the way MCP connectors (Claude, ChatGPT, …) expect it:
 *   1. The connector calls /api/mcp, gets 401 + resource metadata, reads
 *      /.well-known/oauth-protected-resource and /.well-known/oauth-authorization-server.
 *   2. It registers itself (dynamic client registration, public client, PKCE).
 *   3. It opens /agents/connect on the organization's host. The person signs in with their
 *      PubCommand account, picks or names the agent, and approves.
 *   4. It trades the code for an access token (1 hour) and a refresh token (60 days, rotated).
 * Every token belongs to one agent of one organization (the host's).
 */

export type OAuthError = { error: string; error_description: string };

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/agents/connect`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["pubcommand"],
    service_documentation: `${origin}/agents/help`,
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["pubcommand"],
    resource_name: "PubCommand",
  };
}

// ── Client registration (RFC 7591) ──────────────────────────────────────────

export async function registerClient(body: unknown): Promise<{ ok: true; client: Record<string, unknown> } | { ok: false; error: OAuthError }> {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const uris = input.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10 || uris.some((uri) => typeof uri !== "string" || uri.length > 500 || !isAllowedRedirectUri(uri))) {
    return { ok: false, error: { error: "invalid_redirect_uri", error_description: "redirect_uris must be 1 to 10 https addresses (http only for localhost)." } };
  }
  const method = input.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") {
    return { ok: false, error: { error: "invalid_client_metadata", error_description: "Only public clients (token_endpoint_auth_method none, with PKCE) are supported." } };
  }
  const name = typeof input.client_name === "string" && input.client_name.trim() ? input.client_name.trim().slice(0, 100) : "MCP client";
  const id = randomValue("pcoc_");
  const created = await rawPrisma().agentOauthClient.create({ data: { id, name, redirectUris: uris as string[] } });
  return {
    ok: true,
    client: {
      client_id: created.id,
      client_name: created.name,
      redirect_uris: created.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_id_issued_at: Math.floor(created.createdAt.getTime() / 1000),
    },
  };
}

// ── Authorization request ───────────────────────────────────────────────────

export type AuthorizeRequest = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
};

/**
 * Checks /agents/connect parameters. Errors about the client or the redirect address are shown
 * on the page (never redirected to an unverified address); others go back to the connector.
 */
export async function checkAuthorizeRequest(params: Record<string, string | undefined>): Promise<
  { ok: true; request: AuthorizeRequest } | { ok: false; show: string } | { ok: false; redirect: string }
> {
  const clientId = params.client_id ?? "";
  const client = clientId ? await rawPrisma().agentOauthClient.findUnique({ where: { id: clientId } }) : null;
  if (!client) return { ok: false, show: "This connection link is not valid: the app that sent you here is not registered. Start the connection again from your AI app." };
  const redirectUri = params.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) return { ok: false, show: "This connection link is not valid: its return address does not match the app's registration." };
  const state = params.state ?? null;
  const back = (error: string, description: string) => ({ ok: false as const, redirect: oauthRedirect(redirectUri, { error, error_description: description, state }) });
  if (params.response_type !== "code") return back("unsupported_response_type", "Only response_type=code is supported.");
  if (!params.code_challenge || params.code_challenge_method !== "S256") return back("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  if (!/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge)) return back("invalid_request", "code_challenge is malformed.");
  return { ok: true, request: { clientId: client.id, clientName: client.name, redirectUri, state, codeChallenge: params.code_challenge } };
}

export function oauthRedirect(redirectUri: string, values: Record<string, string | null | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) if (value) url.searchParams.set(key, value);
  return url.toString();
}

export async function issueAuthorizationCode(input: { organizationId: string; agentId: string; request: AuthorizeRequest }): Promise<string> {
  const code = randomValue("pcac_");
  await tenantDb(input.organizationId).aiAgentOauthCode.create({
    data: {
      organizationId: input.organizationId,
      agentId: input.agentId,
      clientId: input.request.clientId,
      codeHash: hashToken(code),
      redirectUri: input.request.redirectUri,
      codeChallenge: input.request.codeChallenge,
      expiresAt: new Date(Date.now() + OAUTH_CODE_TTL_SECONDS * 1000),
    },
  });
  await rawPrisma().agentOauthClient.updateMany({ where: { id: input.request.clientId }, data: { lastUsedAt: new Date() } });
  return code;
}

// ── Token endpoint ──────────────────────────────────────────────────────────

type TokenResponse = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };

async function agentUsable(organizationId: string, agentId: string): Promise<boolean> {
  const agent = await tenantDb(organizationId).aiAgent.findFirst({ where: { id: agentId } });
  return Boolean(agent && !agent.removedAt);
}

async function tokenPair(organizationId: string, agentId: string, clientId: string): Promise<TokenResponse> {
  const access = await issueAgentToken({ organizationId, agentId, kind: "access", clientId });
  const refresh = await issueAgentToken({ organizationId, agentId, kind: "refresh", clientId });
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: refresh, scope: "pubcommand" };
}

const invalidGrant = (description: string): { ok: false; error: OAuthError } => ({ ok: false, error: { error: "invalid_grant", error_description: description } });

export async function exchangeToken(organizationId: string, form: URLSearchParams): Promise<{ ok: true; tokens: TokenResponse } | { ok: false; error: OAuthError }> {
  const grant = form.get("grant_type");
  const clientId = form.get("client_id") ?? "";
  const db = tenantDb(organizationId);
  if (grant === "authorization_code") {
    const code = form.get("code") ?? "";
    const row = code ? await db.aiAgentOauthCode.findFirst({ where: { codeHash: hashToken(code) } }) : null;
    if (!row || row.expiresAt <= new Date()) return invalidGrant("The code is not valid or expired. Connect again.");
    if (row.consumedAt) {
      // A replayed code: revoke what it produced (RFC 6749 §4.1.2).
      await db.aiAgentToken.updateMany({ where: { agentId: row.agentId, clientId: row.clientId, revokedAt: null, kind: { in: ["access", "refresh"] }, createdAt: { gte: row.createdAt } }, data: { revokedAt: new Date() } });
      return invalidGrant("The code was already used.");
    }
    if (clientId && clientId !== row.clientId) return invalidGrant("The code belongs to another client.");
    const redirectUri = form.get("redirect_uri");
    if (redirectUri && redirectUri !== row.redirectUri) return invalidGrant("redirect_uri does not match.");
    if (!pkceMatches(form.get("code_verifier") ?? "", row.codeChallenge)) return invalidGrant("code_verifier does not match.");
    const claimed = await db.aiAgentOauthCode.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (claimed.count !== 1) return invalidGrant("The code was already used.");
    if (!(await agentUsable(organizationId, row.agentId))) return invalidGrant("This agent was removed.");
    return { ok: true, tokens: await tokenPair(organizationId, row.agentId, row.clientId) };
  }
  if (grant === "refresh_token") {
    const presented = form.get("refresh_token") ?? "";
    if (tokenKind(presented) !== "refresh") return invalidGrant("refresh_token is not valid.");
    const row = await db.aiAgentToken.findFirst({ where: { tokenHash: hashToken(presented), kind: "refresh" } });
    if (!row) return invalidGrant("refresh_token is not valid.");
    if (row.revokedAt) {
      // Reuse of a rotated refresh token: someone else may hold it. End this connection.
      await db.aiAgentToken.updateMany({ where: { agentId: row.agentId, clientId: row.clientId, revokedAt: null }, data: { revokedAt: new Date() } });
      return invalidGrant("refresh_token was already used. Connect again.");
    }
    if (row.expiresAt && row.expiresAt <= new Date()) return invalidGrant("refresh_token expired. Connect again.");
    if (clientId && row.clientId && clientId !== row.clientId) return invalidGrant("refresh_token belongs to another client.");
    const claimed = await db.aiAgentToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (claimed.count !== 1) return invalidGrant("refresh_token was already used.");
    if (!(await agentUsable(organizationId, row.agentId))) return invalidGrant("This agent was removed.");
    return { ok: true, tokens: await tokenPair(organizationId, row.agentId, row.clientId ?? clientId) };
  }
  return { ok: false, error: { error: "unsupported_grant_type", error_description: "Use authorization_code or refresh_token." } };
}

/** RFC 7009: revoke an access or refresh token. Always succeeds from the caller's view. */
export async function revokeToken(organizationId: string, token: string): Promise<void> {
  if (!tokenKind(token)) return;
  await tenantDb(organizationId).aiAgentToken.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
}

/**
 * On the app host (app.<root>, the one address for every organization) the organization comes
 * from the code or token being exchanged. Platform agents (console organization) are excluded.
 */
export async function organizationOfGrant(form: URLSearchParams): Promise<string | null> {
  const grant = form.get("grant_type");
  const value = grant === "authorization_code" ? form.get("code") : grant === "refresh_token" ? form.get("refresh_token") : form.get("token");
  if (!value) return null;
  const hash = hashToken(value);
  const organizationId = await platformTx(async (tx) =>
    grant === "authorization_code"
      ? (await tx.aiAgentOauthCode.findFirst({ where: { codeHash: hash }, select: { organizationId: true } }))?.organizationId
      : (await tx.aiAgentToken.findFirst({ where: { tokenHash: hash }, select: { organizationId: true } }))?.organizationId,
  );
  if (!organizationId) return null;
  const org = await rawPrisma().organization.findFirst({ where: { id: organizationId, deletedAt: null, suspendedAt: null, NOT: { slug: CONSOLE_ORG_SLUG } }, select: { id: true } });
  return org?.id ?? null;
}
