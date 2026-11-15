import { NextResponse } from "next/server";
import { logoutCurrent, rootDomain } from "@/lib/auth";
import { buildSiteUrl } from "@pubcommand/core";

export async function POST(request: Request) {
  await logoutCurrent();
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost:3000").split(",")[0]!.trim();
  return NextResponse.redirect(buildSiteUrl({ rootDomain: rootDomain(), requestHost: host, site: { kind: "marketing" }, pathname: "/" }));
}
