/**
 * Gmail connection, built on Google's documented OAuth 2.0 and Gmail REST v1 APIs.
 * Read-only scope. `fetch` is injected so the sync is tested with fixtures.
 *
 * - OAuth: https://developers.google.com/identity/protocols/oauth2/web-server
 * - Messages: GET /gmail/v1/users/me/messages (list), /messages/{id}?format=raw
 * - Incremental: GET /gmail/v1/users/me/history?startHistoryId=… (404 → too old, list again)
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** The callback path. It is served on the app host so one redirect URL covers every organization. */
export const GMAIL_CALLBACK_PATH = "/api/intel/gmail/callback";

export type GoogleEnv = { clientId: string; clientSecret: string };

export function googleEnv(env: Record<string, string | undefined>): GoogleEnv | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function buildAuthUrl(input: { clientId: string; redirectUri: string; state: string; loginHint?: string }): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    // Always ask, so Google returns a refresh token even on a reconnect.
    prompt: "consent",
    include_granted_scopes: "false",
    state: input.state,
  });
  if (input.loginHint) params.set("login_hint", input.loginHint);
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// ── Signed OAuth state ──────────────────────────────────────────────────────

export type OAuthState = { organizationId: string; brandId: string; userId: string; orgSlug: string; returnTo: string; exp: number; nonce: string };

const STATE_TTL_MS = 15 * 60 * 1000;

function hmac(secret: string, payload: string): Buffer {
  return createHmac("sha256", `intel-gmail-state:${secret}`).update(payload).digest();
}

export function signState(state: Omit<OAuthState, "exp" | "nonce">, secret: string, now = Date.now()): string {
  const full: OAuthState = { ...state, exp: now + STATE_TTL_MS, nonce: randomBytes(9).toString("base64url") };
  const payload = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${payload}.${hmac(secret, payload).toString("base64url")}`;
}

export function verifyState(token: string, secret: string, now = Date.now()): OAuthState | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = hmac(secret, payload);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    if (typeof state.exp !== "number" || state.exp < now) return null;
    if (![state.organizationId, state.brandId, state.userId, state.orgSlug].every((value) => typeof value === "string" && value)) return null;
    if (typeof state.returnTo !== "string" || !state.returnTo.startsWith("/ispy")) state.returnTo = "/ispy/gmail";
    return state;
  } catch {
    return null;
  }
}

// ── Token encryption (AES-256-GCM, key derived from AUTH_SECRET) ────────────

function tokenKey(secret: string): Buffer {
  return createHash("sha256").update(`intel-gmail-token:${secret}`).digest();
}

export function encryptToken(value: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(secret), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function decryptToken(payload: string, secret: string): string {
  const [version, iv, tag, body] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("The stored Gmail token is unreadable. Reconnect the inbox.");
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

// ── REST client ─────────────────────────────────────────────────────────────

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export class GmailApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GmailApiError";
  }
}

export type TokenSet = { accessToken: string; refreshToken: string | null; expiresAt: Date };

async function readError(response: { status: number; text(): Promise<string> }): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: string | { message?: string }; error_description?: string };
    if (typeof body.error === "string") return body.error_description ? `${body.error}: ${body.error_description}` : body.error;
    if (body.error?.message) return body.error.message;
  } catch {
    // not JSON
  }
  return text.slice(0, 200) || `HTTP ${response.status}`;
}

async function postForm(fetchImpl: FetchLike, url: string, form: Record<string, string>) {
  return fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
}

function tokenSet(body: { access_token?: string; refresh_token?: string; expires_in?: number }, now: number): TokenSet {
  if (!body.access_token) throw new GmailApiError("Google returned no access token.", 500);
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? null, expiresAt: new Date(now + Math.max(60, body.expires_in ?? 3600) * 1000) };
}

export async function exchangeCode(fetchImpl: FetchLike, env: GoogleEnv, input: { code: string; redirectUri: string }, now = Date.now()): Promise<TokenSet> {
  const response = await postForm(fetchImpl, GOOGLE_TOKEN_URL, {
    code: input.code,
    client_id: env.clientId,
    client_secret: env.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });
  if (!response.ok) throw new GmailApiError(`Google refused the sign-in: ${await readError(response)}`, response.status);
  return tokenSet((await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }, now);
}

export async function refreshAccessToken(fetchImpl: FetchLike, env: GoogleEnv, refreshToken: string, now = Date.now()): Promise<TokenSet> {
  const response = await postForm(fetchImpl, GOOGLE_TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: env.clientId,
    client_secret: env.clientSecret,
    grant_type: "refresh_token",
  });
  if (!response.ok) {
    const reason = await readError(response);
    throw new GmailApiError(
      /invalid_grant/.test(reason) ? "Google revoked access to this inbox. Reconnect it." : `Could not refresh the Gmail token: ${reason}`,
      response.status,
    );
  }
  const tokens = tokenSet((await response.json()) as { access_token?: string; expires_in?: number }, now);
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}

export async function revokeToken(fetchImpl: FetchLike, token: string): Promise<void> {
  await postForm(fetchImpl, GOOGLE_REVOKE_URL, { token }).catch(() => undefined);
}

export type GmailRawMessage = { id: string; raw: Uint8Array; labelIds: string[]; internalDate: Date | null };

export function gmailClient(fetchImpl: FetchLike, accessToken: string) {
  async function get<T>(path: string): Promise<T> {
    const response = await fetchImpl(`${GMAIL_API}${path}`, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } });
    if (!response.ok) throw new GmailApiError(`Gmail API: ${await readError(response)}`, response.status);
    return (await response.json()) as T;
  }
  return {
    profile: () => get<{ emailAddress: string; historyId: string }>("/profile"),
    async listMessageIds(query: string, max: number): Promise<string[]> {
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({ maxResults: String(Math.min(100, max - ids.length)) });
        if (query) params.set("q", query);
        if (pageToken) params.set("pageToken", pageToken);
        const page = await get<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?${params.toString()}`);
        for (const message of page.messages ?? []) ids.push(message.id);
        pageToken = page.nextPageToken;
      } while (pageToken && ids.length < max);
      return ids;
    },
    /** New message ids since `startHistoryId`, or null when Gmail no longer has that history. */
    async history(startHistoryId: string, max: number): Promise<{ ids: string[]; historyId: string } | null> {
      const ids: string[] = [];
      let pageToken: string | undefined;
      let latest = startHistoryId;
      try {
        do {
          const params = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded", maxResults: "500" });
          if (pageToken) params.set("pageToken", pageToken);
          const page = await get<{ history?: { messagesAdded?: { message?: { id?: string; labelIds?: string[] } }[] }[]; historyId?: string; nextPageToken?: string }>(
            `/history?${params.toString()}`,
          );
          for (const entry of page.history ?? []) {
            for (const added of entry.messagesAdded ?? []) {
              const id = added.message?.id;
              // Skip drafts and our own sent mail.
              const labels = added.message?.labelIds ?? [];
              if (id && !labels.includes("DRAFT") && !labels.includes("SENT") && !ids.includes(id)) ids.push(id);
            }
          }
          if (page.historyId) latest = page.historyId;
          pageToken = page.nextPageToken;
        } while (pageToken && ids.length < max);
      } catch (error) {
        if (error instanceof GmailApiError && error.status === 404) return null;
        throw error;
      }
      return { ids: ids.slice(0, max), historyId: latest };
    },
    async rawMessage(id: string): Promise<GmailRawMessage> {
      const message = await get<{ id: string; raw?: string; labelIds?: string[]; internalDate?: string }>(`/messages/${encodeURIComponent(id)}?format=raw`);
      if (!message.raw) throw new GmailApiError("Gmail returned an empty message.", 500);
      const internal = Number(message.internalDate);
      return {
        id: message.id,
        raw: new Uint8Array(Buffer.from(message.raw, "base64url")),
        labelIds: message.labelIds ?? [],
        internalDate: Number.isFinite(internal) && internal > 0 ? new Date(internal) : null,
      };
    },
  };
}

export type GmailClient = ReturnType<typeof gmailClient>;

/** The first sync looks back this far. */
export const FIRST_SYNC_QUERY_WINDOW = "newer_than:30d";
const SKIP_OWN_MAIL = "-in:sent -in:drafts";

/**
 * Which messages to fetch this run.
 * - No filter and a stored historyId: the history API returns only what arrived since.
 * - With a filter (history cannot search) or after a previous run: list mail matching
 *   the filter received since the last run (less an hour of overlap; ids already
 *   stored are skipped by the caller).
 * - First run, or history expired: list the last 30 days.
 * Returns the historyId to store for next time.
 */
export async function planSync(
  client: GmailClient,
  input: { historyId: string | null; query: string | null; lastSyncAt: Date | null; max: number },
): Promise<{ ids: string[]; historyId: string; mode: "history" | "since" | "initial" }> {
  const filter = input.query?.trim() ?? "";
  if (input.historyId && !filter) {
    const changes = await client.history(input.historyId, input.max);
    if (changes) return { ...changes, mode: "history" };
  }
  const profile = await client.profile();
  if (input.historyId && input.lastSyncAt) {
    const after = Math.floor(input.lastSyncAt.getTime() / 1000) - 3600;
    const ids = await client.listMessageIds([filter, `after:${after}`, SKIP_OWN_MAIL].filter(Boolean).join(" "), input.max);
    return { ids, historyId: profile.historyId, mode: "since" };
  }
  const ids = await client.listMessageIds([filter, FIRST_SYNC_QUERY_WINDOW, SKIP_OWN_MAIL].filter(Boolean).join(" "), input.max);
  return { ids, historyId: profile.historyId, mode: "initial" };
}

/** Gmail labels → the tab or folder the email landed in. */
export function placementFromLabels(labels: readonly string[]): string | null {
  if (labels.includes("SPAM")) return "SPAM";
  if (labels.includes("CATEGORY_PROMOTIONS")) return "PROMOTIONS";
  if (labels.includes("CATEGORY_UPDATES")) return "UPDATES";
  if (labels.includes("CATEGORY_SOCIAL")) return "SOCIAL";
  if (labels.includes("CATEGORY_FORUMS")) return "FORUMS";
  if (labels.includes("INBOX")) return "PRIMARY";
  return null;
}

/** Gmail Takeout mbox files carry labels in X-Gmail-Labels. */
export function placementFromTakeoutLabels(header: string | undefined): string | null {
  if (!header) return null;
  const labels = header.split(",").map((label) => label.trim().toLowerCase());
  if (labels.includes("spam")) return "SPAM";
  if (labels.includes("category promotions") || labels.includes("promotions")) return "PROMOTIONS";
  if (labels.includes("category updates") || labels.includes("updates")) return "UPDATES";
  if (labels.includes("category social") || labels.includes("social")) return "SOCIAL";
  if (labels.includes("inbox")) return "PRIMARY";
  return null;
}
