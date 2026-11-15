import { validateSlug, slugifyName } from "./slug";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseEmailAddress(input: string): string | null {
  const email = input.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 200) return null;
  return email;
}

export type OrganizationDraft =
  | { ok: true; name: string; slug: string; planId: string; adminEmail: string }
  | { ok: false; field: "name" | "slug" | "plan" | "email"; message: string };

export function validateOrganizationDraft(input: {
  name: string;
  slug: string;
  planId: string;
  adminEmail: string;
}): OrganizationDraft {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) {
    return { ok: false, field: "name", message: "Enter an organization name." };
  }
  const slug = validateSlug(input.slug);
  if (!slug.ok) {
    return {
      ok: false,
      field: "slug",
      message: slug.reason === "reserved" ? "That subdomain is reserved." : "Use 3-40 lowercase letters, numbers, or hyphens.",
    };
  }
  const planId = input.planId.trim();
  if (!planId) return { ok: false, field: "plan", message: "Choose a plan." };
  const adminEmail = parseEmailAddress(input.adminEmail);
  if (!adminEmail) return { ok: false, field: "email", message: "Enter the first admin's email." };
  return { ok: true, name, slug: slug.slug, planId, adminEmail };
}

export type OrganizationPlaces = {
  brand: { name: string; slug: string };
  workspace: { name: string; slug: string };
};

/** Default brand and workspace created with a new organization. */
export function defaultOrganizationPlaces(name: string): OrganizationPlaces {
  const base = slugifyName(name);
  const brandSlug = base.length >= 2 ? base.slice(0, 40).replace(/-+$/g, "") || "main" : "main";
  return {
    brand: { name: name.trim() || "Main", slug: brandSlug || "main" },
    workspace: { name: "Default", slug: "default" },
  };
}

export type OrganizationAdminRole = {
  slug: "owner" | "admin";
  name: "Owner" | "Admin";
  permissions: string[];
};

/** Owner and admin both receive every organization permission passed in. */
export function organizationAdminRoleGrants(permissionKeys: readonly string[]): OrganizationAdminRole[] {
  const permissions = [...new Set(permissionKeys)];
  return [
    { slug: "owner", name: "Owner", permissions },
    { slug: "admin", name: "Admin", permissions },
  ];
}

/**
 * The person creating the organization can open it immediately.
 * Anyone else stays invited until they use the sign-in link.
 */
export function firstAdminMembershipStatus(adminEmail: string, actorEmail: string): "ACTIVE" | "INVITED" {
  const admin = parseEmailAddress(adminEmail);
  const actor = parseEmailAddress(actorEmail);
  if (admin && actor && admin === actor) return "ACTIVE";
  return "INVITED";
}

/** Public organization host. Production uses https://{slug}.{ROOT_DOMAIN}. */
export function organizationPublicUrl(slug: string, rootDomain: string): string {
  const root = rootDomain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!root || root === "localhost" || root === "127.0.0.1") return `http://${slug}.localhost`;
  return `https://${slug}.${root}`;
}

/**
 * Page copy after an invite is issued. The magic link is included only when the
 * dev expose flag is on. Production and a missing RESEND_API_KEY stay silent.
 */
export function organizationInviteNotice(input: {
  lead: string;
  delivered: "sent" | "logged" | "failed";
  magicUrl: string;
  exposeOnPage: boolean;
}): string {
  if (input.exposeOnPage) return `${input.lead} Magic link: ${input.magicUrl}`;
  if (input.delivered === "sent") return `${input.lead} A sign-in link was emailed.`;
  if (input.delivered === "failed") return `${input.lead} The sign-in email could not be sent.`;
  return input.lead;
}
