import { safeNextUrl } from "@pubcommand/core";
import { NextResponse } from "next/server";
import { rootDomain, sendMagicLink } from "@/lib/auth";

function originOf(request: Request) {
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost:3000").split(",")[0]!.trim();
  return { origin: `${proto}://${host}`, host };
}

export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  const next = safeNextUrl(String(form.get("next") ?? ""), rootDomain());
  const { origin, host } = originOf(request);
  const issued = await sendMagicLink(email);
  const expose = process.env.NODE_ENV !== "production" && process.env.AUTH_DEV_EXPOSE_LINKS === "true";
  if (issued && expose) {
    console.info(`magic link issued for development: ${origin}/api/auth/magic-link/verify?token=${issued.token}`);
  } else {
    console.info("magic link requested");
  }
  const dest = new URL("/login", origin);
  dest.searchParams.set("sent", "1");
  if (next) dest.searchParams.set("next", next);
  if (issued && expose) dest.searchParams.set("devLink", `${origin}/api/auth/magic-link/verify?token=${issued.token}`);
  void host;
  return NextResponse.redirect(dest, 303);
}
