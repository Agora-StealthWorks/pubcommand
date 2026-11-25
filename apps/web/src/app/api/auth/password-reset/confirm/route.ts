import { hashPassword } from "@pubcommand/auth";
import { newPasswordProblem } from "@pubcommand/core";
import { resolveSite } from "@pubcommand/core";
import { rawPrisma, resetForgottenPassword } from "@pubcommand/db";
import { NextResponse } from "next/server";
import { checkPasswordReset, consumePasswordReset, establishSession, loginDestination, rootDomain, staffTwoFactorRequired } from "@/lib/auth";

const INVALID = "That reset link is invalid or has expired. Ask for a new one.";

/** "Choose a new password": uses up the reset link, sets the password, signs out everywhere else, signs in here. */
export async function POST(request: Request) {
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost:3000").split(",")[0]!.trim();
  const origin = `${proto}://${host}`;
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const password = String(form.get("newPassword") ?? "");
  const confirm = String(form.get("confirmPassword") ?? "");

  const invalid = () => {
    const dest = new URL("/login", origin);
    dest.searchParams.set("forgot", "1");
    dest.searchParams.set("error", INVALID);
    return NextResponse.redirect(dest, 303);
  };

  // Check the token first, without using it, so a typo in the new password does not burn the link.
  if (!(await checkPasswordReset(token))) return invalid();
  const problem = newPasswordProblem(password, confirm);
  if (problem) {
    const dest = new URL("/reset-password", origin);
    dest.searchParams.set("token", token);
    dest.searchParams.set("error", problem);
    return NextResponse.redirect(dest, 303);
  }
  const consumed = await consumePasswordReset(token);
  if (!consumed) return invalid();
  try {
    await resetForgottenPassword({ userId: consumed.userId, passwordHash: await hashPassword(password) });
  } catch {
    return invalid();
  }
  const { staff } = await establishSession(consumed.userId, "password_reset");
  // Reset on an organization's address the person belongs to: land on that workspace (the new session cookie is set here).
  const site = resolveSite(host, rootDomain(), new URL(request.url).searchParams);
  if (site.kind === "org" && !(staff && staffTwoFactorRequired())) {
    const member = await rawPrisma().membership.findFirst({
      where: { userId: consumed.userId, status: "ACTIVE", organization: { slug: site.slug, deletedAt: null } },
      select: { id: true },
    });
    if (member) return NextResponse.redirect(new URL("/", origin), 303);
  }
  return NextResponse.redirect(new URL(loginDestination({ staff: Boolean(staff), next: null, requestHost: host }), origin), 303);
}
