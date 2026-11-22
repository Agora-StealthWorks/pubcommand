import type { SwitcherLink, SwitcherModel } from "@/features/navigation/switcher";

/**
 * Where you are, and where else you can go: every organization you belong to, the Platform
 * console (staff), all workspaces, Your account, and sign out. Sits under the logo on every
 * signed-in surface. A plain <details>, so it opens inline (also in the phone menu) without JS.
 */
export function SiteSwitcher({ model }: { model: SwitcherModel }) {
  const others = [model.console, model.chooser].filter((link): link is SwitcherLink => Boolean(link));
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
        <span className="sr-only">Switch organization or site</span>
      </summary>
      <div className="border-t border-line py-1">
        {model.organizations.length > 0 ? (
          <>
            <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Organizations</p>
            <ul>
              {model.organizations.map((link) => (
                <li key={link.key}>
                  <SwitchLink link={link} />
                </li>
              ))}
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

function SwitchLink({ link }: { link: SwitcherLink }) {
  return (
    <a
      href={link.href}
      aria-current={link.current ? "page" : undefined}
      className={`flex min-h-10 items-center gap-2 px-3 py-1 text-sm ${link.current ? "bg-[#f1f4fb] font-semibold text-[#1e3a8a]" : "text-ink hover:bg-canvas"}`}
    >
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
