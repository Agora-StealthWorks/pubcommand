import { Button, Card, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { BrandLogo } from "@/components/brand";
import { emailLoginEnabled, exposeMagicLinkOnPage } from "@/lib/mail";
import { currentRequest } from "@/lib/request";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; devLink?: string; next?: string }>;
}) {
  const query = await searchParams;
  const request = await currentRequest();
  const local = request.host.includes("localhost") || request.host.startsWith("127.");
  const origin = `${local ? "http" : "https"}://${request.host}`;
  const expose = exposeMagicLinkOnPage();
  const emailLogin = emailLoginEnabled();
  const devLink = expose && query.devLink?.startsWith(`${origin}/`) ? query.devLink : null;

  return (
    <main data-surface="login" className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-12 sm:px-6 sm:py-16">
      <Link href="/" className="self-start" aria-label="PubCommand home">
        <BrandLogo className="h-9 w-auto" />
      </Link>
      <h1 className="mt-4 text-3xl font-semibold">Log in</h1>
      {query.sent ? <p className="mt-4 text-sm text-[#067647]">If that account exists, a sign-in link is ready.</p> : null}
      {query.error ? <p className="mt-4 text-sm text-[#912018]">{query.error}</p> : null}
      {devLink ? (
        <p className="pc-break mt-4 rounded-md border border-line bg-white p-3 text-sm">
          Development link: <a className="text-accent underline" href={devLink}>{devLink}</a>
        </p>
      ) : null}
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
      </Card>
    </main>
  );
}
