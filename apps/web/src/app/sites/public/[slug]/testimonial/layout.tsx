import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Share your story", robots: { index: false, follow: false } };

/** Public testimonial capture form: no org shell, no sign-in. */
export default function PublicTestimonialLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-canvas px-4 py-8">
      <div className="mx-auto max-w-xl">{children}</div>
    </main>
  );
}
