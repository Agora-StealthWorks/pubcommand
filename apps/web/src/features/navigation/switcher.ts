import { buildSiteUrl } from "@pubcommand/core";

/**
 * The site switcher at the top of every signed-in sidebar: where you are, and links to every
 * organization you can open (each with its brands, when it has more than one), the Platform
 * console (staff), Your account and the workspace list. The super admin sees every organization.
 * Pure: the caller looks up memberships and staff status. Links to another host are built with
 * buildSiteUrl, so they follow the environment (localhost locally, *.pubcommand.com in production).
 */

export type SwitcherHere = { kind: "org"; slug: string; name: string; brandId?: string | null } | { kind: "admin" } | { kind: "app" };

export type SwitcherLink = {
  key: string;
  label: string;
  href: string;
  /** This is the site you are on. */
  current: boolean;
  /** Small text under the label. */
  hint?: string;
  /** An organization's brands, each opening the organization with that brand picked. Only when there are two or more. */
  brands?: SwitcherLink[];
};

export type SwitcherModel = {
  /** What the switcher button says. */
  currentLabel: string;
  currentKind: string;
  organizations: SwitcherLink[];
  console: SwitcherLink | null;
  account: SwitcherLink | null;
  /** The "Choose a workspace" list, offered when there is more than one organization. */
  chooser: SwitcherLink | null;
};

export type SwitcherInput = {
  here: SwitcherHere;
  organizations: {
    slug: string;
    name: string;
    suspended?: boolean;
    /** The brands this person can work in there (all of them, or the one their membership is limited to). */
    brands?: { id: string; name: string }[];
    /** False when the super admin can open it without being a member. */
    member?: boolean;
  }[];
  /** Null when not platform staff. `ready` is false while staff two-factor is unfinished. */
  staff: { ready: boolean } | null;
  rootDomain: string;
  requestHost: string;
};

export function buildSwitcher(input: SwitcherInput): SwitcherModel {
  const url = (site: Parameters<typeof buildSiteUrl>[0]["site"], pathname = "/") =>
    buildSiteUrl({ rootDomain: input.rootDomain, requestHost: input.requestHost, site, pathname });
  const here = input.here;
  const hereSlug = here.kind === "org" ? here.slug : null;

  const hereBrand = here.kind === "org" ? here.brandId ?? null : null;

  const organizations: SwitcherLink[] = input.organizations.map((org) => {
    const isHere = org.slug === hereSlug;
    // Stay on this host for the current organization (a relative link keeps any local ?org= routing simple).
    const orgUrl = (pathname: string) => (isHere ? pathname : url({ kind: "org", slug: org.slug }, pathname));
    const brands = org.brands ?? [];
    const hint = org.suspended ? "Suspended" : org.member === false ? "Super admin access" : brands.length === 1 ? brands[0]!.name : undefined;
    return {
      key: `org:${org.slug}`,
      label: org.name,
      href: orgUrl("/"),
      current: isHere,
      ...(hint ? { hint } : {}),
      ...(brands.length > 1
        ? {
            brands: brands.map((brand) => ({
              key: `brand:${org.slug}:${brand.id}`,
              label: brand.name,
              href: orgUrl(`/switch-brand/${brand.id}`),
              current: isHere && brand.id === hereBrand,
            })),
          }
        : {}),
    };
  });

  const consoleLink: SwitcherLink | null = input.staff
    ? {
        key: "admin",
        label: "Platform console",
        href: here.kind === "admin" ? "/" : url({ kind: "admin" }, input.staff.ready ? "/" : "/2fa"),
        current: here.kind === "admin",
        hint: input.staff.ready ? "Staff only" : "Finish two-factor setup",
      }
    : null;

  // Your account lives inside an organization: here, or else the first one you belong to.
  const accountOrg = hereSlug && input.organizations.some((org) => org.slug === hereSlug) ? hereSlug : input.organizations[0]?.slug ?? null;
  const account: SwitcherLink | null = accountOrg
    ? {
        key: "account",
        label: "Your account",
        href: accountOrg === hereSlug ? "/account" : url({ kind: "org", slug: accountOrg }, "/account"),
        current: false,
        hint: "Password and name",
      }
    : null;

  const chooser: SwitcherLink | null =
    input.organizations.length > 1 || here.kind === "app"
      ? { key: "app", label: "All workspaces", href: here.kind === "app" ? "/" : url({ kind: "app" }), current: here.kind === "app" }
      : null;

  const currentLabel = here.kind === "org" ? here.name : here.kind === "admin" ? "Platform console" : "Choose a workspace";
  const currentKind = here.kind === "org" ? "Organization" : here.kind === "admin" ? "Staff" : "Workspaces";
  return { currentLabel, currentKind, organizations, console: consoleLink, account, chooser };
}

/** The same places (brands too) as flat ⌘K palette entries, leaving out the one you are on. */
export function switcherPaletteItems(model: SwitcherModel): { label: string; href: string; group: string }[] {
  const items: { label: string; href: string; group: string }[] = [];
  for (const org of model.organizations) {
    if (!org.current) items.push({ label: org.label, href: org.href, group: "Organizations" });
    for (const brand of org.brands ?? []) if (!brand.current) items.push({ label: `${org.label} · ${brand.label}`, href: brand.href, group: "Brands" });
  }
  if (model.console && !model.console.current) items.push({ label: model.console.label, href: model.console.href, group: "Sites" });
  if (model.chooser && !model.chooser.current) items.push({ label: model.chooser.label, href: model.chooser.href, group: "Sites" });
  if (model.account) items.push({ label: "Your account (password, name)", href: model.account.href, group: "Sites" });
  return items;
}
