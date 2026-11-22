import { normalizeEmail, MAGIC_LINK_TTL_MS } from "@pubcommand/auth";
import { passwordResetEmail } from "@pubcommand/core";
import { appendPlatformAudit } from "@pubcommand/db";
import { NextResponse } from "next/server";
import { issuePasswordReset } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { exposeMagicLinkOnPage } from "@/lib/mail";
import { allowResetRequest } from "@/lib/password-throttle";

/**
 * "Forgot your password?" for PubCommand users. Works whether or not email sign-in is on.
 * Always answers with the same message, so it never tells whether an account exists.
 */
export async function POST(request: Request) {
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost:3000").split(",")[0]!.trim();
  const origin = `${proto}://${host}`;
  const form = await request.formData();
  const email = normalizeEmail(String(form.get("email") ?? "")).slice(0, 320);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
  const dest = new URL("/login", origin);
  dest.searchParams.set("forgot", "sent");

  if (email.includes("@") && allowResetRequest(email, ip)) {
    const issued = await issuePasswordReset(email);
    if (issued) {
      const link = `${origin}/reset-password?token=${issued.token}`;
      const message = passwordResetEmail({ link, logoUrl: `${origin}/brand/logo-light.png`, minutes: MAGIC_LINK_TTL_MS.password_reset / 60_000 });
      const result = await sendEmail({ to: issued.email, ...message });
      if (result.status === "logged") console.info("[password-reset] email not sent (RESEND_API_KEY unset)");
      if (result.status === "failed") console.error(`[password-reset] email failed: ${result.reason}`);
      await appendPlatformAudit({
        actorId: issued.userId,
        action: "account.password.reset_requested",
        targetType: "user",
        targetId: issued.userId,
        metadata: { delivery: result.status },
      });
      if (exposeMagicLinkOnPage()) dest.searchParams.set("devLink", link);
    }
  }
  return NextResponse.redirect(dest, 303);
}
