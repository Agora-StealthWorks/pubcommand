import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { viewportCheckEnabled } from "@/lib/viewport";
import { ViewportSurface } from "@/viewport/surfaces";

export const dynamic = "force-dynamic";

const SHARE_URL =
  "https://northstar.pubcommand.com/charts?share=viewport-check-token-abcdefghijklmnopqrstuvwxyz0123456789";

async function viewportShare() {
  "use server";
  return { url: SHARE_URL };
}

export default async function ViewportPage({ params }: { params: Promise<{ path?: string[] }> }) {
  await headers();
  if (!viewportCheckEnabled()) notFound();
  const path = (await params).path ?? [];
  const surface = await ViewportSurface({ route: path.join("/"), publishShare: viewportShare });
  if (!surface) notFound();
  return surface;
}
