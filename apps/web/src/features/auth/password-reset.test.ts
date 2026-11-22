import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawPrisma } from "@pubcommand/db";
import { GET as verifyMagicLinkRoute } from "@/app/api/auth/magic-link/verify/route";
import { POST as confirmReset } from "@/app/api/auth/password-reset/confirm/route";
import { POST as requestReset } from "@/app/api/auth/password-reset/route";
import { checkPasswordReset, consumePasswordReset, createLoginLink, issuePasswordReset } from "@/lib/auth";

/**
 * "Forgot your password?" against the real routes and database. The steps that would set a
 * session cookie need a request scope, so these cover every refusal path plus the token rules.
 */

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";
process.env.AUTH_SECRET ??= "local-dev-secret-at-least-16-chars";
delete process.env.RESEND_API_KEY;

const db = rawPrisma();
const suffix = randomBytes(4).toString("hex");
const users = { active: "", disabled: "" };
const email = (kind: string) => `reset-${kind}-${suffix}@example.com`;

function form(url: string, fields: Record<string, string>, ip = "203.0.113.9") {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request(url, { method: "POST", body, headers: { host: "app.localhost:3000", "x-forwarded-for": ip } });
}

beforeAll(async () => {
  execSync("pnpm exec prisma migrate deploy --schema prisma/schema", { cwd: new URL("../../../../../packages/db", import.meta.url).pathname, env: process.env, stdio: "ignore" });
  users.active = (await db.user.create({ data: { email: email("active") } })).id;
  users.disabled = (await db.user.create({ data: { email: email("disabled"), disabledAt: new Date() } })).id;
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: Object.values(users).filter(Boolean) } } });
  await db.$disconnect();
});

describe("password reset tokens", () => {
  it("a reset token cannot sign in through the magic-link route", async () => {
    const issued = (await issuePasswordReset(email("active")))!;
    const response = await verifyMagicLinkRoute(new Request(`http://app.localhost:3000/api/auth/magic-link/verify?token=${issued.token}`, { headers: { host: "app.localhost:3000" } }));
    expect(response.headers.get("location")).toContain("/login?error=");
    // Still good for its own purpose afterwards.
    expect(await checkPasswordReset(issued.token)).toMatchObject({ userId: users.active });
  });

  it("a sign-in link cannot reset a password", async () => {
    const login = await createLoginLink(users.active);
    expect(await checkPasswordReset(login.token)).toBeNull();
    const response = await confirmReset(form("http://app.localhost:3000/api/auth/password-reset/confirm", { token: login.token, newPassword: "a-new-password", confirmPassword: "a-new-password" }));
    expect(new URL(response.headers.get("location") ?? "http://x").searchParams.get("error")).toContain("invalid or has expired");
    const row = await db.user.findUnique({ where: { id: users.active }, select: { passwordHash: true } });
    expect(row?.passwordHash).toBeNull();
  });

  it("expires after 30 minutes, works once, and a newer link voids the older one", async () => {
    const first = (await issuePasswordReset(email("active")))!;
    expect(first.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
    expect(first.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);
    const second = (await issuePasswordReset(email("active")))!;
    expect(await checkPasswordReset(first.token)).toBeNull();
    expect(await consumePasswordReset(second.token)).toEqual({ userId: users.active });
    expect(await consumePasswordReset(second.token)).toBeNull();
    const expired = (await issuePasswordReset(email("active")))!;
    await db.magicLink.updateMany({ where: { tokenHash: { not: "" }, userId: users.active, consumedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await checkPasswordReset(expired.token)).toBeNull();
  });

  it("a mismatched new password does not use the link up", async () => {
    const issued = (await issuePasswordReset(email("active")))!;
    const response = await confirmReset(form("http://app.localhost:3000/api/auth/password-reset/confirm", { token: issued.token, newPassword: "a-new-password", confirmPassword: "different-one" }));
    expect(new URL(response.headers.get("location") ?? "http://x").searchParams.get("error")).toContain("do not match");
    expect(await checkPasswordReset(issued.token)).not.toBeNull();
  });

  it("disabled and unknown accounts get the same answer and no token", async () => {
    const before = await db.magicLink.count({ where: { userId: users.disabled } });
    const disabled = await requestReset(form("http://app.localhost:3000/api/auth/password-reset", { email: email("disabled") }, "203.0.113.20"));
    const unknown = await requestReset(form("http://app.localhost:3000/api/auth/password-reset", { email: email("nobody") }, "203.0.113.21"));
    expect(disabled.headers.get("location")).toBe("http://app.localhost:3000/login?forgot=sent");
    expect(unknown.headers.get("location")).toBe("http://app.localhost:3000/login?forgot=sent");
    expect(await db.magicLink.count({ where: { userId: users.disabled } })).toBe(before);
    expect(await issuePasswordReset(email("disabled"))).toBeNull();
  });

  it("limits requests per email (the answer stays the same)", async () => {
    const count = async () => db.magicLink.count({ where: { userId: users.active, purpose: "password_reset" } });
    const start = await count();
    for (let i = 0; i < 5; i += 1) {
      const response = await requestReset(form("http://app.localhost:3000/api/auth/password-reset", { email: email("active") }, `198.51.100.${i}`));
      expect(response.headers.get("location")).toMatch(/\/login\?forgot=sent/);
    }
    expect((await count()) - start).toBe(3);
  });
});
