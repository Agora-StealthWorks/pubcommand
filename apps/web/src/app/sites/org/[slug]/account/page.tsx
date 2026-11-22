import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@pubcommand/core";
import { rawPrisma } from "@pubcommand/db";
import { Button, Input, Label } from "@pubcommand/ui";
import { notFound } from "next/navigation";
import { Flash, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/org";
import { changeMyPassword, updateMyName } from "@/server/account-actions";

/** Your account: every signed-in person can change their own name and password here. */
export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; notice?: string; welcome?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  if (ctx.impersonatingHere) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Your account" />
        <p className="rounded-xl border border-line bg-white p-4 text-sm text-muted">
          You are viewing this organization as someone else. Stop viewing as them to change your own account.
        </p>
      </div>
    );
  }
  const user = await rawPrisma().user.findUnique({
    where: { id: ctx.auth.user.id },
    select: { email: true, name: true, passwordHash: true },
  });
  if (!user) notFound();
  const hasPassword = Boolean(user.passwordHash);
  const otherSessions = await rawPrisma().session.count({ where: { userId: ctx.auth.user.id, id: { not: ctx.auth.session.id } } });
  return (
    <div className="max-w-xl space-y-4">
      <PageHeader title="Your account" description={user.email} />
      <Flash error={query.error} notice={query.notice} />
      {!hasPassword ? (
        <p className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
          {query.welcome ? "Welcome! " : ""}You do not have a password yet. Set one below so you can log in with your email and password next time.
        </p>
      ) : null}

      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{hasPassword ? "Change password" : "Set a password"}</h2>
        <form action={changeMyPassword} className="mt-3 space-y-3">
          {/* Lets password managers attach the new password to the right account. */}
          <input type="email" name="username" autoComplete="username" defaultValue={user.email} hidden readOnly />
          {hasPassword ? (
            <div>
              <Label htmlFor="current-password">Current password</Label>
              <Input id="current-password" name="currentPassword" type="password" autoComplete="current-password" required className="mt-1" />
            </div>
          ) : null}
          <div>
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              required
              className="mt-1"
            />
            <p className="mt-1 text-xs text-muted">At least {PASSWORD_MIN_LENGTH} characters.</p>
          </div>
          <div>
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              required
              className="mt-1"
            />
          </div>
          <p className="text-sm text-muted">
            {hasPassword ? "Changing it signs you out on your other devices. You stay signed in here." : "You stay signed in here."}
            {otherSessions > 0 ? ` You are signed in on ${otherSessions} other device${otherSessions === 1 ? "" : "s"}.` : ""}
          </p>
          <Button type="submit" className="w-full sm:w-auto">
            {hasPassword ? "Change password" : "Set password"}
          </Button>
        </form>
      </section>

      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Name</h2>
        <form action={updateMyName} className="mt-3 space-y-3">
          <div>
            <Label htmlFor="display-name">Display name</Label>
            <Input id="display-name" name="name" defaultValue={user.name ?? ""} maxLength={80} autoComplete="name" className="mt-1" />
            <p className="mt-1 text-xs text-muted">Shown to your team. Your email cannot be changed here.</p>
          </div>
          <Button type="submit" variant="secondary" className="w-full sm:w-auto">
            Save name
          </Button>
        </form>
      </section>
    </div>
  );
}
