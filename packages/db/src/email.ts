export const DEFAULT_SUPERADMIN_EMAIL = "Stephen@onenationfinancial.com";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
