import { createAttemptLimiter, type AttemptLimiter } from "@pubcommand/core";

/**
 * Wrong "current password" attempts on Your account, per user: 5 per 15 minutes.
 * There is no login throttle elsewhere to share yet; kept on globalThis so dev
 * reloads do not reset it.
 */
const holder = globalThis as typeof globalThis & { __pcPasswordLimiter?: AttemptLimiter };

export function currentPasswordLimiter(): AttemptLimiter {
  holder.__pcPasswordLimiter ??= createAttemptLimiter({ max: 5, windowMs: 15 * 60_000 });
  return holder.__pcPasswordLimiter;
}
