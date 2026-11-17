import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Track record", robots: { index: false, follow: false } };

/** Public, token-gated track record pages: no org shell, no sign-in. The link page adds its own frame; widgets have none. */
export default function PublicTrackRecordRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
