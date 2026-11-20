import { buildSiteUrl } from "@pubcommand/core";
import { redirect } from "next/navigation";
import { readSession, rootDomain } from "@/lib/auth";
import { currentRequest } from "@/lib/request";
import LoginPage from "./login/page";

/** The home page is the login. Signed-in people go straight to their workspaces. */
export default async function HomePage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string; devLink?: string; next?: string }> }) {
  const { user } = await readSession();
  if (user) {
    const request = await currentRequest();
    redirect(buildSiteUrl({ rootDomain: rootDomain(), requestHost: request.host, site: { kind: "app" }, pathname: "/" }));
  }
  return <LoginPage searchParams={searchParams} />;
}
