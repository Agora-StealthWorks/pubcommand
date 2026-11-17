import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Research outline", robots: { index: false, follow: false } };

/** Public, token-gated research pages: no org shell, no sign-in, read-only. */
export default function PublicResearchLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-canvas px-4 py-8">
      <div className="mx-auto max-w-4xl">{children}</div>
      <p className="mt-10 text-center text-xs text-muted">Read-only research shared by link.</p>
    </main>
  );
}
