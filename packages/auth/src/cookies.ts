export { SESSION_COOKIE } from "./edge";
export const DEFAULT_SUPERADMIN_EMAIL = "Stephen@onenationfinancial.com";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function cookieDomain(rootDomain = process.env.ROOT_DOMAIN ?? ""): string | undefined {
  const root = rootDomain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!root || root === "localhost" || root === "127.0.0.1" || !root.includes(".")) return undefined;
  return `.${root}`;
}

export function authCookieBase(rootDomain = process.env.ROOT_DOMAIN ?? "") {
  const domain = cookieDomain(rootDomain);
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    ...(domain ? { domain } : {}),
  };
}
