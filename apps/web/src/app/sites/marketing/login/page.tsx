import { Button, Card, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { BrandLogo } from "@/components/brand";
import { emailLoginEnabled, exposeMagicLinkOnPage } from "@/lib/mail";
import { currentRequest } from "@/lib/request";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; devLink?: string; next?: string; forgot?: string }>;
}) {
  const query = await searchParams;
  const request = await currentRequest();
  const local = request.host.includes("localhost") || request.host.startsWith("127.");
  const origin = `${local ? "http" : "https"}://${request.host}`;
  const expose = exposeMagicLinkOnPage();
  const emailLogin = emailLoginEnabled();
  const devLink = expose && query.devLink?.startsWith(`${origin}/`) ? query.devLink : null;
  // Keep the local ?org= / ?site= so links stay on the same site on a bare localhost host.
  const keep = new URLSearchParams();
  const search = new URLSearchParams(request.search.replace(/^\?/, ""));
  for (const key of ["org", "site"]) if (search.get(key)) keep.set(key, search.get(key)!);
  const withQuery = (extra: Record<string, string>) => {
    const params = new URLSearchParams(keep);
    for (const [key, value] of Object.entries(extra)) params.set(key, value);
    const text = params.toString();
    return `/login${text ? `?${text}` : ""}`;
  };
  const forgot = query.forgot === "1";

  return (
    <main data-surface="login" className="mx-auto flex w-full flex-1 max-w-md flex-col justify-center px-4 py-12 sm:px-6 sm:py-16">
      <Link href="/" className="self-start" aria-label="PubCommand home">
        <BrandLogo className="h-9 w-auto" />
      </Link>
      <h1 className="mt-4 text-3xl font-semibold">{forgot ? "Reset your password" : "Log in"}</h1>
      {query.sent ? <p className="mt-4 text-sm text-[#067647]">If that account exists, a sign-in link is ready.</p> : null}
      {query.forgot === "sent" ? (
        <p className="mt-4 text-sm text-[#067647]" role="status">
          If that account exists, we&apos;ve emailed a reset link. It works once and expires in 30 minutes.
        </p>
      ) : null}
      {query.error ? <p className="mt-4 text-sm text-[#912018]">{query.error}</p> : null}
      {devLink ? (
        <p className="pc-break mt-4 rounded-md border border-line bg-white p-3 text-sm">
          Development link: <a className="text-accent underline" href={devLink}>{devLink}</a>
        </p>
      ) : null}
      {forgot ? (
        <Card className="mt-6 p-5">
          <form action="/api/auth/password-reset" method="post" className="space-y-3">
            <p className="text-sm text-muted">Enter the email you log in with. We&apos;ll email you a link to choose a new password.</p>
            <Label htmlFor="reset-email">Email</Label>
            <Input id="reset-email" name="email" type="email" autoComplete="email" required />
            <Button type="submit" className="w-full">Email me a reset link</Button>
          </form>
          <Link href={withQuery(query.next ? { next: query.next } : {})} className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-accent">
            Back to log in
          </Link>
        </Card>
      ) : (
        <Card className="mt-6 p-5">
          {emailLogin ? (
            <form action="/api/auth/magic-link" method="post" className="mb-6 space-y-3 border-b border-line pb-6">
              <input type="hidden" name="next" value={query.next ?? ""} />
              <Label htmlFor="magic-email">Email</Label>
              <Input id="magic-email" name="email" type="email" autoComplete="email" required />
              <Button type="submit" variant="secondary" className="w-full">Email me a link</Button>
            </form>
          ) : null}
          <form action="/api/auth/login" method="post" className="space-y-3">
            <input type="hidden" name="next" value={query.next ?? ""} />
            <Label htmlFor="password-email">Email</Label>
            <Input id="password-email" name="email" type="email" autoComplete="username" required />
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
            <Button type="submit" className="w-full">Log in</Button>
          </form>
          <Link href={withQuery({ forgot: "1" })} className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-accent">
            Forgot your password?
          </Link>
        </Card>
      )}
    </main>
  );
}
