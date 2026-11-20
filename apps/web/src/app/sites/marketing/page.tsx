import Link from "next/link";
import { BrandLogo } from "@/components/brand";

export default function MarketingPage() {
  return (
    <main data-surface="marketing" className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-4 py-12 sm:px-6 sm:py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-accent">One Nation Financial</p>
      <h1 className="mt-3 max-w-full">
        <BrandLogo className="h-12 w-auto sm:h-16" />
      </h1>
      <p className="mt-4 max-w-xl text-lg text-muted">
        One login for every organization, brand, and workspace. Phase 1 is the foundation: tenancy, permissions, and the shell.
      </p>
      <div className="mt-8">
        <Link href="/login" className="inline-flex min-h-11 items-center rounded-md border border-accent bg-accent px-3.5 text-sm font-semibold text-white">
          Log in
        </Link>
      </div>
    </main>
  );
}
