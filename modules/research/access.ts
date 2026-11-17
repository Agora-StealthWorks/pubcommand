/**
 * Who can do what with a research project. Projects are private to their owner;
 * workspace admins see and manage all of them; anyone else needs a share.
 */

export type ShareLevel = "view" | "edit";
export type ProjectAccess = "none" | "view" | "edit" | "owner" | "admin";

export const SHARE_LEVELS: readonly ShareLevel[] = ["view", "edit"];

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.length <= 254;
}

/**
 * Resolve one viewer's access. `canWrite` is the viewer's research.write
 * permission: without it, an edit share or ownership is read-only.
 */
export function projectAccess(input: {
  ownerId: string;
  viewerId: string;
  viewerEmail: string;
  isAdmin: boolean;
  canWrite: boolean;
  shares: readonly { email: string; permission: string }[];
}): ProjectAccess {
  const readOnly = (level: ProjectAccess): ProjectAccess => (input.canWrite ? level : "view");
  if (input.ownerId === input.viewerId) return readOnly("owner");
  if (input.isAdmin) return readOnly("admin");
  const email = normalizeEmail(input.viewerEmail);
  const share = input.shares.find((row) => normalizeEmail(row.email) === email);
  if (!share) return "none";
  return share.permission === "edit" ? readOnly("edit") : "view";
}

export const canView = (access: ProjectAccess) => access !== "none";
export const canEdit = (access: ProjectAccess) => access === "edit" || access === "owner" || access === "admin";
/** Shares, the public link, the Brain toggle, rename and delete. */
export const canManage = (access: ProjectAccess) => access === "owner" || access === "admin";

/** A public link token: 32 url-safe characters (192 bits). */
export function isPublicToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(token);
}
