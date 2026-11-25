import { normalizeEmail, verifyPassword } from "@pubcommand/auth";
import { safeNextUrl } from "@pubcommand/core";
import { rawPrisma } from "@pubcommand/db";
import { NextResponse } from "next/server";
import { establishSession, loginDestination, rootDomain } from "@/lib/auth";

export async function POST(request: Request) {
  const form = await request.formData();
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const password = String(form.get("password") ?? "");
  const next = safeNextUrl(String(form.get("next") ?? ""), rootDomain());
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost:3000").split(",")[0]!.trim();
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${host}`;
  const user = await rawPrisma().user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  const valid = Boolean(user?.passwordHash) && (await verifyPassword(password, user?.passwordHash ?? ""));
  if (!user || !valid) {
    const dest = new URL("/login", origin);
    dest.searchParams.set("error", "Email or password is wrong, or this account has no password yet.");
    return NextResponse.redirect(dest, 303);
  }
  if (user.disabledAt) {
    const dest = new URL("/login", origin);
    dest.searchParams.set("error", "This account is disabled.");
    return NextResponse.redirect(dest, 303);
  }
  const { staff } = await establishSession(user.id, "password");
  // `next` may be a path on this host ("/settings"): resolve it here, since redirects need a full URL.
  return NextResponse.redirect(new URL(loginDestination({ staff: Boolean(staff), next, requestHost: host }), origin), 303);
}
