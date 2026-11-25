import { rawPrisma, resolveOrgBySlug } from "@pubcommand/db";
import { Button, Card, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand";
import { registerAction } from "@/features/registration/actions";
import { readSession } from "@/lib/auth";
import { PASSWORD_MIN_LENGTH } from "@pubcommand/core";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign up" };

/** An organization's public sign-up page: <org>.<root>/register. Off unless the org turns it on. */
export default async function RegisterPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const org = await resolveOrgBySlug(slug);
  if (!org || org.redirected) notFound();
  const [settings, auth] = await Promise.all([rawPrisma().orgSettings.findUnique({ where: { organizationId: org.id }, select: { displayName: true, registrationEnabled: true } }), readSession()]);
  const name = settings?.displayName || org.name;
  if (auth.user) {
    const member = await rawPrisma().membership.findFirst({ where: { organizationId: org.id, userId: auth.user.id, status: "ACTIVE" }, select: { id: true } });
    if (member) redirect("/");
  }
  const open = Boolean(settings?.registrationEnabled) && !org.suspendedAt;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-12 sm:px-6 sm:py-16">
      <BrandLogo className="h-9 w-auto self-start" />
      <h1 className="mt-4 text-3xl font-semibold">Join {name}</h1>
      {!open ? (
        <Card className="mt-6 p-5">
          <p className="text-sm">{name} is not taking sign-ups right now. Ask them for an invite.</p>
          <Link href="/login" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-accent">
            Log in instead
          </Link>
        </Card>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">Create your account to start using {name} on PubCommand.</p>
          {query.error ? (
            <p className="mt-4 text-sm text-[#912018]" role="alert">
              {query.error}
            </p>
          ) : null}
          <Card className="mt-6 p-5">
            <form action={registerAction} className="space-y-3">
              <Label htmlFor="reg-name">Your name</Label>
              <Input id="reg-name" name="name" autoComplete="name" maxLength={120} required />
              <Label htmlFor="reg-email">Email</Label>
              <Input id="reg-email" name="email" type="email" autoComplete="email" required />
              <Label htmlFor="reg-password">Password</Label>
              <Input id="reg-password" name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required />
              <Label htmlFor="reg-confirm">Confirm password</Label>
              <Input id="reg-confirm" name="confirm" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} />
              <p className="text-xs text-muted">Already have a PubCommand account? Use its email and password to join {name}; you can leave Confirm blank.</p>
              <Button type="submit" className="w-full">
                Create account
              </Button>
            </form>
            <Link href="/login" className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-accent">
              Already a member? Log in
            </Link>
          </Card>
        </>
      )}
    </main>
  );
}
