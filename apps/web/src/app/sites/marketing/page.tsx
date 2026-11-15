import Link from "next/link";

export default function MarketingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-accent">One Nation Financial</p>
      <h1 className="mt-3 max-w-2xl text-5xl font-semibold tracking-tight text-ink">PubCommand</h1>
      <p className="mt-4 max-w-xl text-lg text-muted">
        One login for every organization, brand, and workspace. Phase 1 is the foundation: tenancy, permissions, and the shell.
      </p>
      <div className="mt-8">
        <Link href="/login" className="inline-flex h-10 items-center rounded-md border border-accent bg-accent px-3.5 text-sm font-semibold text-white">
          Log in
        </Link>
      </div>
    </main>
  );
}
