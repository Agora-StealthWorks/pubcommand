import { normalizeEmail } from "@pubcommand/auth";
import { safeNextUrl } from "@pubcommand/core";
import { NextResponse } from "next/server";
import { rootDomain, sendMagicLink } from "@/lib/auth";
import { deliverMagicLink, emailLoginEnabled, exposeMagicLinkOnPage, magicLinkUrl } from "@/lib/mail";
import { loadSystemEmailOverrides } from "@/features/system-emails/store";

function originOf(request: Request) {
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost:3000").split(",")[0]!.trim();
  return { origin: `${proto}://${host}`, host };
}

export async function POST(request: Request) {
  if (!emailLoginEnabled()) {
    const dest = new URL("/login", originOf(request).origin);
    dest.searchParams.set("error", "Email sign-in is turned off. Log in with your password.");
    return NextResponse.redirect(dest, 303);
  }
  const form = await request.formData();
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const next = safeNextUrl(String(form.get("next") ?? ""), rootDomain());
  const { origin, host } = originOf(request);
  const issued = await sendMagicLink(email);
  const link = issued ? magicLinkUrl(origin, issued.token) : null;
  if (link) await deliverMagicLink({ to: email, url: link, kind: "login", overrides: await loadSystemEmailOverrides() });
  const dest = new URL("/login", origin);
  dest.searchParams.set("sent", "1");
  if (next) dest.searchParams.set("next", next);
  if (link && exposeMagicLinkOnPage()) dest.searchParams.set("devLink", link);
  void host;
  return NextResponse.redirect(dest, 303);
}
