import { NextResponse, type NextRequest } from "next/server";
import { cleanHeartbeat, orgIdForSlug, recordHeartbeat } from "@/features/usage/record";
import { readSession } from "@/lib/auth";
import { currentRequest } from "@/lib/request";

export const dynamic = "force-dynamic";

/**
 * The in-app usage heartbeat (features/usage/beacon.tsx): page views, active seconds and
 * bytes transferred. `active: false` beats (no input since the last one) do not count as
 * activity, so an idle tab still signs out after the person's idle timeout. 401 tells the
 * page the session ended so it can reload to the sign-in page.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const active = Boolean(body && typeof body === "object" && (body as { active?: unknown }).active === true);
  const auth = await readSession({ touch: active });
  if (!auth.user) return NextResponse.json({ signedOut: true }, { status: 401 });
  const beat = cleanHeartbeat(body);
  if (!beat) return new NextResponse(null, { status: 400 });
  const here = await currentRequest();
  let site: string | null = null;
  let orgId: string | null = null;
  if (here.site.kind === "org" && !here.customDomain) {
    orgId = await orgIdForSlug(here.site.slug);
    site = orgId;
  } else if (here.site.kind === "admin" || here.site.kind === "app") {
    site = here.site.kind;
  }
  if (!site) return new NextResponse(null, { status: 204 });
  try {
    await recordHeartbeat({ userId: auth.user.id, site, orgId, beat: active ? beat : { ...beat, activeSeconds: 0 } });
  } catch (error) {
    console.warn("[usage] heartbeat not recorded", error instanceof Error ? error.message : error);
  }
  return new NextResponse(null, { status: 204 });
}
