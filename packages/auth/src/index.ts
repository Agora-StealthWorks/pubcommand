export { authCookieBase, cookieDomain, DEFAULT_SUPERADMIN_EMAIL, normalizeEmail, SESSION_COOKIE } from "./cookies";
export {
  GATE_COOKIE,
  IMPERSONATION_COOKIE,
  openGate,
  openImpersonation,
  sealGate,
  sealImpersonation,
  type GatePayload,
  type ImpersonationPayload,
} from "./edge";
export { createLucia, type AppLucia, type AuthSession, type AuthUser } from "./lucia";
export { consumeMagicLink, createMagicLinkToken, hashMagicLinkToken, issueMagicLink, type MagicLinkStore } from "./magic-link";
export { hashPassword, verifyPassword } from "./password";
export { ssoNotConfigured, type SsoHooks, type SsoIdentity, type SsoProvider } from "./sso";
export {
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  otpauthUrl,
  verifyTotp,
} from "./totp";
