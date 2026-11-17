import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Track record", robots: { index: false, follow: false } };

/** Public, token-gated track record pages: no org shell, no sign-in. */
export default function PublicTrackRecordLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-canvas px-4 py-8">
      <div className="mx-auto max-w-4xl">{children}</div>
    </main>
  );
}
