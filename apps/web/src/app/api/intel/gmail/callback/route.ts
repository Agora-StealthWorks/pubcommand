import { cookieDomain } from "@pubcommand/auth";
import { buildSiteUrl, can } from "@pubcommand/core";
import { loadAccessSubject, loadSuperAdminSubject } from "@pubcommand/db";
import { moduleRegistry } from "@pubcommand/modules";
import { after } from "next/server";
import { authSecret, gmailEnv, gmailRedirectUri, loadBrand, saveGmailConnection, syncGmailAccount } from "@/features/intel/gmail";
import { drainExtractions } from "@/features/intel/server";
import { readSession, readStaff, rootDomain, staffReady } from "@/lib/auth";
import { exchangeCode, gmailClient, verifyState, type FetchLike } from "../../../../../../../../modules/intel/index";

const fetchImpl: FetchLike = (url, init) => fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(30_000) });

function plain(message: string, status = 400) {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

/**
 * Google sends the browser here after consent. One URL for every organization: the
 * signed state says which organization, brand and user started the connection.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host).split(",")[0]!.trim();
  const state = verifyState(url.searchParams.get("state") ?? "", authSecret());
  if (!state) return plain("This Gmail connection link has expired or is not valid. Go back to Intel → Gmail and press Connect Gmail again.");

  const back = (flash: { error?: string; notice?: string }) => {
    const search = new URLSearchParams(flash as Record<string, string>).toString();
    return Response.redirect(buildSiteUrl({ rootDomain: rootDomain(), requestHost: host, site: { kind: "org", slug: state.orgSlug }, pathname: state.returnTo, search: `?${search}` }), 303);
  };

  const googleError = url.searchParams.get("error");
  if (googleError) return back({ error: googleError === "access_denied" ? "Gmail was not connected: access was declined." : `Google returned an error: ${googleError}` });
  const code = url.searchParams.get("code");
  if (!code) return back({ error: "Google did not return a code. Try connecting again." });

  // The person who started the connection must be the one finishing it. Locally the
  // session cookie is per-host, so only the signed state can be checked there.
  const { user, session } = await readSession();
  if (cookieDomain(rootDomain())) {
    if (!user || user.id !== state.userId) return back({ error: "Sign in as the person who started the connection, then try again." });
  }
  let subject = await loadAccessSubject(state.organizationId, state.userId, moduleRegistry.permissionModules());
  if (!subject && user?.id === state.userId) {
    const staff = await readStaff(state.userId);
    if (staff?.role === "SUPER_ADMIN" && staffReady(staff, session)) subject = await loadSuperAdminSubject(state.organizationId, state.userId, moduleRegistry.permissionModules());
  }
  const scope = { organizationId: state.organizationId, brandId: state.brandId };
  if (!subject || !subject.entitledModuleIds.includes("intel") || !can(subject, "intel.write", scope)) {
    return back({ error: "You no longer have permission to connect inboxes for Intel." });
  }
  const brand = await loadBrand(state.organizationId, state.brandId);
  if (!brand) return back({ error: "That brand no longer exists." });

  const env = gmailEnv();
  if (!env) return back({ error: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set." });
  try {
    const tokens = await exchangeCode(fetchImpl, env, { code, redirectUri: gmailRedirectUri(host) });
    const profile = await gmailClient(fetchImpl, tokens.accessToken).profile();
    const saved = await saveGmailConnection({
      organizationId: state.organizationId,
      brandId: state.brandId,
      actorId: state.userId,
      email: profile.emailAddress,
      historyId: null,
      tokens,
    });
    if ("error" in saved) return back({ error: saved.error });
    after(async () => {
      await syncGmailAccount({ organizationId: state.organizationId, accountId: saved.id, actorId: state.userId });
      await drainExtractions({ organizationId: state.organizationId, brand, actorId: state.userId });
    });
    return back({ notice: `${profile.emailAddress} connected. The first sync (last 30 days) is running.` });
  } catch (error) {
    return back({ error: error instanceof Error ? error.message : "Connecting Gmail failed." });
  }
}
