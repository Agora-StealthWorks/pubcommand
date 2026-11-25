import { PASSWORD_MIN_LENGTH } from "@pubcommand/core";
import { Button, Card, Input, Label } from "@pubcommand/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/brand";
import { checkPasswordReset } from "@/lib/auth";

export const dynamic = "force-dynamic";
// The token is in the address: never send it on to another site.
export const metadata: Metadata = { title: "Choose a new password", referrer: "no-referrer", robots: { index: false } };

/** Opened from the "Reset your PubCommand password" email. Checking the link does not use it up. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const query = await searchParams;
  const token = query.token ?? "";
  const account = token ? await checkPasswordReset(token) : null;

  return (
    <main data-surface="reset-password" className="mx-auto flex w-full flex-1 max-w-md flex-col justify-center px-4 py-12 sm:px-6 sm:py-16">
      <Link href="/" className="self-start" aria-label="PubCommand home">
        <BrandLogo className="h-9 w-auto" />
      </Link>
      <h1 className="mt-4 text-3xl font-semibold">Choose a new password</h1>
      {account ? (
        <>
          {query.error ? <p className="mt-4 text-sm text-[#912018]">{query.error}</p> : null}
          <Card className="mt-6 p-5">
            <form action="/api/auth/password-reset/confirm" method="post" className="space-y-3">
              <input type="hidden" name="token" value={token} />
              <p className="pc-break text-sm text-muted">For {account.email}</p>
              {/* Lets password managers save the new password against the right account. */}
              <input type="email" name="username" value={account.email} autoComplete="username" readOnly hidden />
              <Label htmlFor="new-password">New password</Label>
              <Input id="new-password" name="newPassword" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required />
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input id="confirm-password" name="confirmPassword" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required />
              <p className="text-xs text-muted">At least {PASSWORD_MIN_LENGTH} characters. You will be signed out on your other devices.</p>
              <Button type="submit" className="w-full">Save password and log in</Button>
            </form>
          </Card>
        </>
      ) : (
        <Card className="mt-6 p-5">
          <p className="text-sm">This reset link is invalid or has expired. Links work once and last 30 minutes.</p>
          <Link href="/login?forgot=1" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-accent">
            Ask for a new link
          </Link>
        </Card>
      )}
    </main>
  );
}
