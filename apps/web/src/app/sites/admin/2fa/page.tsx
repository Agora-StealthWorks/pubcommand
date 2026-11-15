import { Button, Input, Label } from "@pubcommand/ui";
import { decryptTotpSecret, otpauthUrl } from "@pubcommand/auth";
import { redirect } from "next/navigation";
import { Flash } from "@/components/ui";
import { readSession, readStaff, secret } from "@/lib/auth";

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams;
  const auth = await readSession();
  if (!auth.user) redirect("/login");
  const staff = await readStaff(auth.user.id);
  if (!staff) {
    return <main className="mx-auto max-w-lg px-6 py-20"><h1 className="text-2xl font-semibold">Platform staff only</h1></main>;
  }
  const enrolled = Boolean(staff.totpConfirmedAt);
  const revealed = !enrolled && staff.totpSecretCipher ? decryptTotpSecret(staff.totpSecretCipher, secret()) : null;
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold">Staff two-factor authentication</h1>
      <p className="mt-2 text-sm text-muted">
        The console stays closed until this authenticator is confirmed for the current session. Pending enrollment is not access.
      </p>
      <Flash error={query.error} />
      {!staff.totpSecretCipher ? (
        <form action="/api/auth/totp" method="post" className="mt-6">
          <input type="hidden" name="action" value="generate" />
          <Button type="submit">Generate authenticator secret</Button>
        </form>
      ) : null}
      {revealed ? (
        <div className="mt-6 rounded-lg border border-line bg-white p-4 text-sm">
          <p className="font-semibold">Add this secret to an authenticator app</p>
          <p className="mt-2 break-all font-mono">{revealed}</p>
          <p className="mt-2 break-all text-muted">{otpauthUrl(auth.user.email, revealed)}</p>
        </div>
      ) : null}
      {staff.totpSecretCipher ? (
        <form action="/api/auth/totp" method="post" className="mt-6 space-y-3 rounded-lg border border-line bg-white p-4">
          <input type="hidden" name="action" value="confirm" />
          <Label htmlFor="code">{enrolled ? "Enter the current code" : "Enter the code to finish enrollment"}</Label>
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
          <Button type="submit">Verify</Button>
        </form>
      ) : null}
      <form action="/api/auth/logout" method="post" className="mt-6">
        <button className="text-sm font-semibold text-accent">Log out</button>
      </form>
    </main>
  );
}
