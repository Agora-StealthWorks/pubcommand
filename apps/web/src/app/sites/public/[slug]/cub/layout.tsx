import type { Metadata } from "next";
import { CUB_COLLECTOR_ENABLED } from "../../../../../../../../modules/editorial/features";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "CUB review", robots: { index: false, follow: false } };

/** Public, token-gated CUB pages: no org shell, no sign-in. */
export default function PublicCubLayout({ children }: { children: React.ReactNode }) {
  if (!CUB_COLLECTOR_ENABLED) notFound();
  return (
    <main className="min-h-screen bg-canvas px-4 py-8">
      <div className="mx-auto max-w-2xl">{children}</div>
      <p className="mt-10 text-center text-xs text-muted">Private review link. Please do not share it.</p>
    </main>
  );
}
