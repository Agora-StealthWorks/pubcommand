"use client";

import { useState } from "react";
import type { SwitcherLink, SwitcherModel } from "@/features/navigation/switcher";

/** Above this many organizations and brands together, the switcher shows a search box. */
const SEARCH_FROM = 7;

/**
 * Where you are, and where else you can go: every organization you can open (the super admin
 * sees all of them) with its brands underneath, the Platform console (staff), all workspaces,
 * Your account, and sign out. Sits under the logo on every signed-in surface. A plain <details>,
 * so it opens inline (also in the phone menu) and its links work before JS loads.
 */
export function SiteSwitcher({ model }: { model: SwitcherModel }) {
  const [query, setQuery] = useState("");
  const others = [model.console, model.chooser].filter((link): link is SwitcherLink => Boolean(link));
  const total = model.organizations.reduce((sum, org) => sum + 1 + (org.brands?.length ?? 0), 0);
  const organizations = filterOrganizations(model.organizations, query);
  return (
    <details className="group rounded-lg border border-line bg-white" data-testid="site-switcher">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-1.5 hover:bg-canvas [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium text-muted">{model.currentKind}</span>
          <span className="block truncate text-sm font-semibold text-ink">{model.currentLabel}</span>
        </span>
        <span aria-hidden className="text-xs text-muted transition-transform group-open:rotate-180">
          ▾
        </span>
        <span className="sr-only">Switch organization, brand or site</span>
      </summary>
      <div className="border-t border-line py-1">
        {model.organizations.length > 0 ? (
          <>
            <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Organizations and brands</p>
            {total > SEARCH_FROM ? (
              <div className="px-2 pb-1">
                <label className="sr-only" htmlFor="pc-switcher-search">
                  Find an organization or brand
                </label>
                <input
                  id="pc-switcher-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find an organization or brand"
                  className="min-h-9 w-full rounded-md border border-line px-2 text-sm"
                />
              </div>
            ) : null}
            <ul className="max-h-[60vh] overflow-y-auto">
              {organizations.map((org) => (
                <li key={org.key}>
                  <SwitchLink link={org} />
                  {org.brands && org.brands.length > 0 ? (
                    <ul aria-label={`${org.label} brands`} className="pb-1">
                      {org.brands.map((brand) => (
                        <li key={brand.key}>
                          <SwitchLink link={brand} nested />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
              {organizations.length === 0 ? <li className="px-3 py-2 text-sm text-muted">Nothing matches “{query}”.</li> : null}
            </ul>
          </>
        ) : null}
        {others.length > 0 ? (
          <ul className={model.organizations.length > 0 ? "mt-1 border-t border-line pt-1" : ""}>
            {others.map((link) => (
              <li key={link.key}>
                <SwitchLink link={link} />
              </li>
            ))}
          </ul>
        ) : null}
        <ul className="mt-1 border-t border-line pt-1">
          {model.account ? (
            <li>
              <SwitchLink link={model.account} />
            </li>
          ) : null}
          <li>
            <form action="/api/auth/logout" method="post">
              <button className="flex min-h-10 w-full items-center px-3 text-left text-sm font-medium text-ink hover:bg-canvas">Sign out</button>
            </form>
          </li>
        </ul>
      </div>
    </details>
  );
}

/** Organizations whose name matches, with all their brands; or with only the brands that match. */
function filterOrganizations(organizations: SwitcherLink[], query: string): SwitcherLink[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return organizations;
  const result: SwitcherLink[] = [];
  for (const org of organizations) {
    if (org.label.toLowerCase().includes(needle) || org.hint?.toLowerCase().includes(needle)) {
      result.push(org);
      continue;
    }
    const brands = org.brands?.filter((brand) => brand.label.toLowerCase().includes(needle)) ?? [];
    if (brands.length > 0) result.push({ ...org, brands });
  }
  return result;
}

function SwitchLink({ link, nested = false }: { link: SwitcherLink; nested?: boolean }) {
  return (
    <a
      href={link.href}
      aria-current={link.current ? "page" : undefined}
      className={`flex items-center gap-2 py-1 text-sm ${nested ? "min-h-9 pl-7 pr-3" : "min-h-10 px-3"} ${
        link.current ? "bg-[#f1f4fb] font-semibold text-[#1e3a8a]" : `${nested ? "text-muted" : "text-ink"} hover:bg-canvas hover:text-ink`
      }`}
    >
      {nested ? (
        <span aria-hidden className="text-xs text-muted">
          └
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{link.label}</span>
        {link.hint ? <span className="block truncate text-xs font-normal text-muted">{link.hint}</span> : null}
      </span>
      {link.current ? (
        <span aria-hidden className="text-xs">
          ✓
        </span>
      ) : null}
    </a>
  );
}
