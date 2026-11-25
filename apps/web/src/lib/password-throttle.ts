import { createAttemptLimiter, type AttemptLimiter } from "@pubcommand/core";

/**
 * In-memory limiters (per server process), kept on globalThis so dev reloads do not reset them.
 */
const holder = globalThis as typeof globalThis & {
  __pcPasswordLimiter?: AttemptLimiter;
  __pcResetEmailLimiter?: AttemptLimiter;
  __pcResetIpLimiter?: AttemptLimiter;
};

/** Wrong "current password" attempts on Your account, per user: 5 per 15 minutes. */
export function currentPasswordLimiter(): AttemptLimiter {
  holder.__pcPasswordLimiter ??= createAttemptLimiter({ max: 5, windowMs: 15 * 60_000 });
  return holder.__pcPasswordLimiter;
}

/** "Forgot your password?" requests: 3 per email and 10 per IP address in 15 minutes. */
export const RESET_LIMITS = { perEmail: 3, perIp: 10, windowMs: 15 * 60_000 } as const;

/**
 * Counts one reset request and says whether it may send an email. Over the limit the caller
 * still shows the usual "If that account exists…" message and simply sends nothing.
 */
export function allowResetRequest(email: string, ip: string): boolean {
  holder.__pcResetEmailLimiter ??= createAttemptLimiter({ max: RESET_LIMITS.perEmail, windowMs: RESET_LIMITS.windowMs });
  holder.__pcResetIpLimiter ??= createAttemptLimiter({ max: RESET_LIMITS.perIp, windowMs: RESET_LIMITS.windowMs });
  const byEmail = holder.__pcResetEmailLimiter;
  const byIp = holder.__pcResetIpLimiter;
  const emailKey = email.trim().toLowerCase();
  const ipKey = ip || "unknown";
  const allowed = !byEmail.blocked(emailKey) && !byIp.blocked(ipKey);
  byEmail.fail(emailKey);
  byIp.fail(ipKey);
  return allowed;
}

const registration = globalThis as typeof globalThis & { __pcRegisterIpLimiter?: AttemptLimiter; __pcRegisterEmailLimiter?: AttemptLimiter };

/** Registration page attempts: 10 per IP address and 5 per email in 15 minutes. Null = allowed. */
export function registrationBlocked(email: string, ip: string): string | null {
  registration.__pcRegisterIpLimiter ??= createAttemptLimiter({ max: 10, windowMs: 15 * 60_000 });
  registration.__pcRegisterEmailLimiter ??= createAttemptLimiter({ max: 5, windowMs: 15 * 60_000 });
  const byIp = registration.__pcRegisterIpLimiter;
  const byEmail = registration.__pcRegisterEmailLimiter;
  const ipKey = ip || "unknown";
  const emailKey = email.trim().toLowerCase();
  const blocked = byIp.blocked(ipKey) ?? byEmail.blocked(emailKey);
  byIp.fail(ipKey);
  byEmail.fail(emailKey);
  return blocked;
}
