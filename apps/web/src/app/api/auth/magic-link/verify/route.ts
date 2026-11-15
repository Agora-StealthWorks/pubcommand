import { NextResponse } from "next/server";
import { establishSession, loginDestination, verifyMagicLink } from "@/lib/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const next = url.searchParams.get("next");
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost:3000").split(",")[0]!.trim();
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${host}`;
  const consumed = await verifyMagicLink(token);
  if (!consumed) return NextResponse.redirect(new URL("/login?error=That sign-in link is invalid or expired.", origin));
  const { staff } = await establishSession(consumed.userId);
  return NextResponse.redirect(loginDestination({ staff: Boolean(staff), next, requestHost: host }));
}
