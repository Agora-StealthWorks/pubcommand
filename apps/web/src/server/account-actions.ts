"use server";

import { hashPassword } from "@pubcommand/auth";
import { newPasswordProblem } from "@pubcommand/core";
import { changeOwnPassword, rawPrisma, updateOwnName } from "@pubcommand/db";
import { redirect } from "next/navigation";
import { verifyPassword } from "@/lib/auth";
import { getOrgContext } from "@/lib/org";
import { currentPasswordLimiter } from "@/lib/password-throttle";
import { currentRequest } from "@/lib/request";

const ACCOUNT_HREF = "/account";

function back(kind: "error" | "notice", message: string): never {
  redirect(`${ACCOUNT_HREF}?${kind}=${encodeURIComponent(message)}`);
}

/** The signed-in person in this organization, never someone staff is viewing as. */
async function accountContext() {
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/");
  const ctx = await getOrgContext(request.site.slug);
  if (ctx.kind === "anonymous") redirect(`/login?next=${encodeURIComponent(ACCOUNT_HREF)}`);
  if (ctx.kind !== "ok") redirect("/?error=You do not have access to that organization.");
  if (ctx.impersonatingHere) back("error", "Stop viewing as someone else before changing an account.");
  return ctx;
}

export async function changeMyPassword(formData: FormData) {
  const ctx = await accountContext();
  const userId = ctx.auth.user.id;
  const user = await rawPrisma().user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user) back("error", "Unknown account.");
  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");
  const hadPassword = Boolean(user.passwordHash);
  if (hadPassword) {
    const limiter = currentPasswordLimiter();
    const wait = limiter.blocked(userId);
    if (wait) back("error", wait);
    if (!current || !(await verifyPassword(current, user.passwordHash ?? ""))) {
      limiter.fail(userId);
      back("error", "Your current password is wrong.");
    }
    limiter.reset(userId);
  }
  const problem = newPasswordProblem(next, confirm);
  if (problem) back("error", problem);
  if (hadPassword && next === current) back("error", "Pick a new password that is different from the current one.");
  const result = await changeOwnPassword({
    userId,
    passwordHash: await hashPassword(next),
    keepSessionId: ctx.auth.session.id,
    organizationId: ctx.resolved.id,
    firstPassword: !hadPassword,
  });
  const others = result.sessionsSignedOut > 0 ? ` You were signed out on ${result.sessionsSignedOut} other device${result.sessionsSignedOut === 1 ? "" : "s"}.` : "";
  back("notice", `${hadPassword ? "Password changed." : "Password set. Use it with your email to log in next time."}${others}`);
}

export async function updateMyName(formData: FormData) {
  const ctx = await accountContext();
  try {
    await updateOwnName({ userId: ctx.auth.user.id, name: String(formData.get("name") ?? ""), organizationId: ctx.resolved.id });
  } catch (error) {
    back("error", error instanceof Error ? error.message : "Could not save your name.");
  }
  back("notice", "Name saved.");
}
