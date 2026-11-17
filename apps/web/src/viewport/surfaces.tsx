import { Button, Card, Input, Label, Textarea } from "@pubcommand/ui";
import { performanceHome } from "@pubcommand/modules";
import { defaultSpec } from "@pubcommand/modules/charts";
import { createProjectAction, fetchSeriesAction, saveChartAction, saveTemplateAction, uploadImageAction } from "@/features/charts/actions";
import { ChartEditor } from "@/features/charts/editor";
import {
  buildPlansSettingsScreen,
  createModuleAddOn,
  createPlan,
  createSeat,
  stripeEnvStatus,
} from "../../../../modules/billing/index";
import { renderEditorialPage } from "../../../../modules/editorial/render";
import { loadKnowledge } from "../../../../modules/knowledge/index";
import { loadIntelScreen } from "../../../../modules/intel/index";
import { AdminShell } from "@/components/admin-shell";
import { OrgShell } from "@/components/org-shell";
import { NewOrganizationForm, OrganizationDetail, OrganizationsList } from "@/components/organizations-console";
import { PlansConsole } from "@/components/plans-console";
import { UserDetail, UsersList } from "@/components/users-console";
import { TableScroll } from "@/components/table-scroll";
import { PageHeader } from "@/components/ui";
import { FormsBuilder } from "@/app/sites/org/[slug]/forms/builder";
import { VIEWPORT_ORG_ID, viewportSubject } from "./subject";

const EMAIL = "stephen.operator.with.a.very.long.mailbox@onenationfinancial.example";
const SLUG = "northstar-publishing-command-desk";
const SECRET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const SHARE_URL =
  "https://northstar.pubcommand.com/charts?share=viewport-check-token-abcdefghijklmnopqrstuvwxyz0123456789";

const organization = { id: VIEWPORT_ORG_ID, name: "Northstar Publishing Desk", slug: SLUG };
const brands = [{ id: "brand-desk", name: "Northstar Desk" }];

function orgFrame(pathname: string, children: React.ReactNode, impersonating = false) {
  return (
    <OrgShell
      organization={organization}
      brands={brands}
      brand={brands[0] ?? null}
      subject={viewportSubject()}
      pathname={pathname}
      email={EMAIL}
      impersonating={impersonating ? { targetEmail: EMAIL } : null}
    >
      {children}
    </OrgShell>
  );
}

function adminFrame(pathname: string, children: React.ReactNode) {
  return (
    <AdminShell role="SUPER_ADMIN" email={EMAIL} pathname={pathname}>
      {children}
    </AdminShell>
  );
}

function WideTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <TableScroll>
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-3 py-2">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join("|")} className="border-t border-line">
              {row.map((cell) => (
                <td key={cell} className="pc-break px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

function billingScreen() {
  const plan = createPlan({
    id: "plan-desk",
    key: "desk",
    name: "Desk",
    seatLimit: 8,
    monthlyPriceCents: 4900,
    moduleIds: ["knowledge", "editorial", "charts"],
  });
  const seat = createSeat({
    id: "seat-stephen",
    organizationId: VIEWPORT_ORG_ID,
    userId: "viewport-user",
    status: "assigned",
  });
  const addOn = createModuleAddOn({
    id: "addon-intel",
    organizationId: VIEWPORT_ORG_ID,
    moduleId: "intel",
    monthlyPriceCents: 1500,
    active: true,
  });
  return buildPlansSettingsScreen({
    canRead: true,
    canManage: true,
    catalog: [plan],
    assignment: {
      organizationId: VIEWPORT_ORG_ID,
      planId: plan.id,
      seatLimit: plan.seatLimit,
      seats: [seat],
      addOns: [addOn],
    },
    stripe: stripeEnvStatus({}),
  });
}

type ShareResult = { url: string } | { error: string };

/** Fixed example bars so the viewport check never needs market data. */
function viewportBars() {
  const bars = [];
  let value = 50;
  for (let index = 0; index < 250; index += 1) {
    value *= 1 + 0.003 + 0.012 * Math.sin(index / 11);
    bars.push({ t: Date.UTC(2025, 0, 2) + index * 86_400_000, o: value, h: value * 1.01, l: value * 0.99, c: value });
  }
  return bars;
}

export async function ViewportSurface({
  route,
  publishShare: _publishShare,
}: {
  route: string;
  publishShare: (draft: { csv: string; annotation: string; accent: string }) => Promise<ShareResult>;
}) {
  if (route === "admin") {
    return (
      <div data-surface="admin">
        {adminFrame(
          "/",
          <div>
            <PageHeader title="Platform console" description="Staff only. Organization roles never open this host." />
            <dl className="grid gap-4 md:grid-cols-3">
              <Card className="p-4">
                <dt className="text-xs font-semibold uppercase text-muted">Organizations</dt>
                <dd className="mt-2 text-3xl font-semibold">4</dd>
              </Card>
            </dl>
          </div>,
        )}
      </div>
    );
  }

  if (route === "admin/2fa") {
    return (
      <main data-surface="admin-2fa" className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-4 py-12">
        <h1 className="break-words text-3xl font-semibold">Staff two-factor authentication</h1>
        <p className="mt-2 text-sm text-muted">The console stays closed until this authenticator is confirmed.</p>
        <div className="mt-6 rounded-lg border border-line bg-white p-4 text-sm">
          <p className="font-semibold">Add this secret to an authenticator app</p>
          <p className="pc-break mt-2 font-mono">{SECRET}</p>
          <p className="pc-break mt-2 text-muted">otpauth://totp/PubCommand:{EMAIL}?secret={SECRET}&issuer=PubCommand</p>
        </div>
        <form className="mt-6 space-y-3 rounded-lg border border-line bg-white p-4">
          <Label htmlFor="code">Enter the code to finish enrollment</Label>
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" />
          <Button type="button" className="w-full sm:w-auto">Verify</Button>
        </form>
      </main>
    );
  }

  if (route === "admin/orgs") {
    return (
      <div data-surface="admin-orgs">
        {adminFrame(
          "/orgs",
          <OrganizationsList
            rootDomain="pubcommand.com"
            canCreate
            newHref="/viewport/admin/orgs/new"
            detailHref={() => "/viewport/admin/orgs/detail"}
            organizations={[
              {
                id: "org-northstar",
                name: organization.name,
                slug: SLUG,
                planId: "plan-desk",
                planName: "Desk",
                seatsUsed: 3,
                seatLimit: 8,
                brands: 2,
                workspaces: 4,
                suspended: false,
              },
            ]}
          />,
        )}
      </div>
    );
  }

  if (route === "admin/orgs/empty") {
    return (
      <div data-surface="admin-orgs-empty">
        {adminFrame(
          "/orgs",
          <OrganizationsList
            rootDomain="pubcommand.com"
            canCreate
            newHref="/viewport/admin/orgs/new"
            organizations={[]}
          />,
        )}
      </div>
    );
  }

  if (route === "admin/orgs/new") {
    return (
      <div data-surface="admin-orgs-new">
        {adminFrame(
          "/orgs/new",
          <NewOrganizationForm
            plans={[
              { id: "plan-desk", key: "desk", name: "Desk" },
              { id: "plan-internal", key: "internal", name: "Internal (unlimited)" },
            ]}
            rootDomain="pubcommand.com"
            listHref="/viewport/admin/orgs"
          />,
        )}
      </div>
    );
  }

  if (route === "admin/orgs/new-empty") {
    return (
      <div data-surface="admin-orgs-new-empty">
        {adminFrame(
          "/orgs/new",
          <NewOrganizationForm plans={[]} rootDomain="pubcommand.com" listHref="/viewport/admin/orgs" plansHref="/viewport/admin/plans" />,
        )}
      </div>
    );
  }

  if (route === "admin/orgs/detail") {
    return (
      <div data-surface="admin-orgs-detail">
        {adminFrame(
          "/orgs/northstar",
          <OrganizationDetail
            rootDomain="pubcommand.com"
            listHref="/viewport/admin/orgs"
            selfIsAdmin={false}
            canManage
            canPlan
            canSuspend
            canImpersonate
            organization={{
              id: "org-northstar",
              name: organization.name,
              slug: SLUG,
              planId: "plan-desk",
              planName: "Desk",
              seatsUsed: 1,
              seatLimit: 8,
              brands: 1,
              workspaces: 1,
              suspended: false,
            }}
            plans={[
              { id: "plan-desk", name: "Desk" },
              { id: "plan-team", name: "Team" },
            ]}
            roles={[
              { id: "role-owner", name: "Owner" },
              { id: "role-admin", name: "Admin" },
            ]}
            members={[{ id: "member-stephen", email: EMAIL, roleId: "role-owner", roleName: "Owner", status: "INVITED" }]}
          />,
        )}
      </div>
    );
  }

  if (route === "admin/users") {
    return (
      <div data-surface="admin-users">
        {adminFrame(
          "/users",
          <div>
            <PageHeader title="Users" description="Search accounts, then open one to edit it." />
            <UsersList
              query=""
              listPath="/viewport/admin/users"
              detailHref={() => "/viewport/admin/users/detail"}
              users={[
                {
                  id: "user-stephen",
                  email: EMAIL,
                  name: "Stephen Operator",
                  disabled: false,
                  staffRole: "SUPER_ADMIN",
                  organizations: SLUG,
                },
              ]}
            />
          </div>,
        )}
      </div>
    );
  }

  if (route === "admin/users/detail") {
    return (
      <div data-surface="admin-users-detail">
        {adminFrame(
          "/users/stephen",
          <UserDetail
            listHref="/viewport/admin/users"
            canEdit
            canStaff
            self={false}
            user={{
              id: "user-stephen",
              email: EMAIL,
              name: "Stephen Operator",
              disabled: false,
              staffManager: false,
              sessionCount: 2,
              staff: { role: "SUPPORT", removed: false, totp: "enrolled" },
            }}
            memberships={[
              {
                id: "member-stephen",
                organizationId: "org-northstar",
                organizationName: organization.name,
                roleId: "role-owner",
                roleName: "Owner",
                status: "ACTIVE",
                roles: [
                  { id: "role-owner", name: "Owner" },
                  { id: "role-admin", name: "Admin" },
                ],
              },
            ]}
            placements={[
              { organizationId: "org-harbor", organizationName: "Harbor Weekly", roleId: "role-editor", roleName: "Editor" },
            ]}
          />,
        )}
      </div>
    );
  }

  if (route === "admin/staff") {
    return (
      <div data-surface="admin-staff">
        {adminFrame(
          "/staff",
          <div>
            <PageHeader title="Staff" description="Every staff member must enroll TOTP before the console opens." />
            <form className="pc-form-row mb-6">
              <Input type="email" defaultValue={EMAIL} aria-label="Staff email" />
              <select className="pc-control w-full md:w-auto" aria-label="Role" defaultValue="SUPER_ADMIN">
                <option>SUPER_ADMIN</option>
                <option>SUPPORT</option>
              </select>
              <Button type="button" className="w-full md:w-auto">Save staff</Button>
            </form>
            <WideTable headers={["Email", "Role", "2FA"]} rows={[[EMAIL, "SUPER_ADMIN", "pending"]]} />
          </div>,
        )}
      </div>
    );
  }

  if (route === "admin/plans") {
    return (
      <div data-surface="admin-plans">
        {adminFrame(
          "/plans",
          <div>
            <PageHeader title="Plans" description="Create and edit plans. The price is display only." />
            <PlansConsole
              canEdit
              canModules={false}
              organizations={[{ id: "org-northstar", name: organization.name }]}
              modules={[
                { id: "knowledge", name: "Knowledge" },
                { id: "editorial", name: "Editorial" },
                { id: "charts", name: "Charts" },
              ]}
              plans={[
                {
                  id: "plan-internal",
                  key: "internal",
                  name: "Internal (unlimited)",
                  seatLimit: 1_000_000,
                  brandLimit: 1_000_000,
                  workspaceLimit: 1_000_000,
                  monthlyPriceCents: 0,
                  archived: false,
                  moduleIds: ["knowledge", "editorial", "charts"],
                  organizationCount: 1,
                },
              ]}
            />
          </div>,
        )}
      </div>
    );
  }

  if (route === "admin/domains") {
    return (
      <div data-surface="admin-domains">
        {adminFrame(
          "/domains",
          <div>
            <PageHeader title="Domains" description="Phase 1 serves every organization on a subdomain." />
            <div className="rounded-lg border border-line bg-white p-4">
              <p className="font-semibold">{organization.name}</p>
              <p className="pc-break text-sm text-muted">{SLUG}.pubcommand.com</p>
              <form className="pc-form-row mt-3">
                <Input defaultValue={SLUG} aria-label="Slug" />
                <Button type="button" variant="secondary" className="w-full md:w-auto">Override slug</Button>
              </form>
            </div>
          </div>,
        )}
      </div>
    );
  }

  if (route === "admin/audit") {
    return (
      <div data-surface="admin-audit">
        {adminFrame(
          "/audit",
          <div>
            <PageHeader title="Platform audit" description="Append-only." />
            <WideTable headers={["When", "Action", "Target"]} rows={[["2026-11-15 12:00:00", "staff.invited", EMAIL]]} />
          </div>,
        )}
      </div>
    );
  }

  if (route === "app") {
    return (
      <main data-surface="app" className="mx-auto w-full max-w-3xl px-4 py-12">
        <p className="text-sm font-semibold uppercase tracking-wide text-accent">PubCommand</p>
        <h1 className="mt-2 break-words text-3xl font-semibold">Choose an organization</h1>
        <p className="pc-break mt-2 text-sm text-muted">{EMAIL}</p>
        <ul className="mt-8 divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">
          <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
            <div className="min-w-0">
              <p className="break-words font-semibold">{organization.name}</p>
              <p className="text-sm text-muted">Owner</p>
            </div>
            <span className="inline-flex min-h-11 items-center text-sm font-semibold text-accent">Open</span>
          </li>
        </ul>
      </main>
    );
  }

  if (route === "org") {
    return (
      <div data-surface="org">
        {orgFrame(
          "/",
          <div>
            <PageHeader title={organization.name} description="Organization overview." />
            <div className="grid gap-4 md:grid-cols-3">
              <Card className="p-4">
                <p className="text-xs font-semibold uppercase text-muted">Brand</p>
                <p className="mt-2 text-lg font-semibold">Northstar Desk</p>
              </Card>
            </div>
          </div>,
          true,
        )}
      </div>
    );
  }

  if (route === "org/billing") {
    const screen = billingScreen();
    return (
      <div data-surface="billing">
        {orgFrame(
          "/billing",
          <div>
            <PageHeader title={screen.title} description={screen.description} />
            {screen.current ? (
              <section className="rounded-lg border border-line bg-white p-5">
                <h2 className="text-lg font-semibold text-ink">{screen.current.name}</h2>
                <p className="mt-1 text-sm text-muted">
                  {screen.current.price} · {screen.current.seatsUsed} of {screen.current.seatLimit} seats
                </p>
                <p className="pc-break mt-2 text-sm text-ink">{screen.current.modules.join(", ")}</p>
              </section>
            ) : null}
            <ul className="mt-6 divide-y divide-line rounded-lg border border-line bg-white">
              <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="pc-break min-w-0 font-medium">{EMAIL}</span>
                <span className="text-muted">assigned</span>
              </li>
            </ul>
            <form className="pc-form-row mt-6 rounded-lg border border-line bg-white p-4">
              <label className="min-w-0 text-sm" htmlFor="billing-plan">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Plan</span>
                <select id="billing-plan" className="pc-control w-full" defaultValue="desk">
                  {screen.choices.map((choice) => (
                    <option key={choice.planId} value={choice.planId}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="button" className="w-full sm:w-auto">Assign plan</Button>
            </form>
            <p className="pc-break mt-6 text-sm text-muted">{screen.stripe.detail}</p>
          </div>,
        )}
      </div>
    );
  }

  if (route === "org/knowledge") {
    const view = loadKnowledge(VIEWPORT_ORG_ID, { q: "example" });
    return (
      <div data-surface="knowledge">
        {orgFrame(
          "/knowledge",
          <div>
            <PageHeader title="Knowledge" description="Markdown pages for this organization." />
            <form className="pc-form-row mb-6 max-w-xl">
              <Input defaultValue={view.query} aria-label="Search pages" />
              <Button type="button" variant="secondary" className="w-full sm:w-auto">Search</Button>
            </form>
            <div className="grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
              <ul className="divide-y divide-line rounded-lg border border-line bg-white">
                {view.pages.map((page) => (
                  <li key={page.id} className="px-4 py-3 text-sm font-medium">
                    {page.title}
                  </li>
                ))}
              </ul>
              <article className="min-w-0 rounded-lg border border-line bg-white p-5">
                <h2 className="break-words text-lg font-semibold">{view.selected?.title}</h2>
                <pre className="mt-4 whitespace-pre-wrap break-words font-sans text-sm leading-6">{view.selected?.body}</pre>
              </article>
            </div>
            <form className="mt-6 space-y-3 rounded-lg border border-line bg-white p-4">
              <Label htmlFor="knowledge-title">Title</Label>
              <Input id="knowledge-title" defaultValue="Desk note" />
              <Label htmlFor="knowledge-body">Markdown</Label>
              <Textarea id="knowledge-body" defaultValue="A note for the desk." />
              <Button type="button" className="w-full sm:w-auto">Save page</Button>
            </form>
          </div>,
        )}
      </div>
    );
  }

  if (route === "org/editorial") {
    const html = await renderEditorialPage({ organizationId: VIEWPORT_ORG_ID, canWrite: true });
    return <div data-surface="editorial">{orgFrame("/editorial", <div dangerouslySetInnerHTML={{ __html: html }} />)}</div>;
  }

  if (route === "org/performance") {
    const home = performanceHome(VIEWPORT_ORG_ID);
    return (
      <div data-surface="performance">
        {orgFrame(
          "/performance",
          <div>
            <PageHeader title="Performance" description="Recommendations and the launch funnel." />
            <TableScroll>
              <table className="w-full min-w-[36rem] border-collapse text-sm">
                <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2">Symbol</th>
                    <th className="px-3 py-2">Direction</th>
                    <th className="px-3 py-2">Opened</th>
                    <th className="px-3 py-2">Closed</th>
                    <th className="px-3 py-2">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {home.recommendations.map((row) => (
                    <tr key={row.id} className="border-t border-line">
                      <td className="px-3 py-2">{row.symbol}</td>
                      <td className="px-3 py-2">{row.direction}</td>
                      <td className="px-3 py-2">{row.openedOn}</td>
                      <td className="px-3 py-2">{row.closedOn}</td>
                      <td className="px-3 py-2">{row.pnl}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </div>,
        )}
      </div>
    );
  }

  if (route === "org/intel") {
    const screen = loadIntelScreen({ organizationId: VIEWPORT_ORG_ID, callDate: "2026-06-04" });
    return (
      <div data-surface="intel">
        {orgFrame(
          "/intel",
          <div>
            <PageHeader title={screen.title} description={screen.description} />
            <ul className="divide-y divide-line rounded-lg border border-line bg-white">
              {screen.competitors.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="min-w-0 font-medium">{row.name}</span>
                  <span className="pc-break min-w-0 text-muted">{row.domain}</span>
                </li>
              ))}
            </ul>
            <ul className="mt-6 divide-y divide-line rounded-lg border border-line bg-white">
              {screen.emails.map((row) => (
                <li key={row.id} className="px-4 py-3">
                  <p className="text-sm font-semibold">{row.subject}</p>
                  <p className="pc-break mt-1 text-sm text-muted">{row.from}</p>
                </li>
              ))}
            </ul>
            <form className="pc-form-row mt-6 max-w-md">
              <div>
                <Label htmlFor="intel-call-date">Call date</Label>
                <Input id="intel-call-date" type="date" defaultValue="2026-06-04" className="mt-1" />
              </div>
              <Button type="button" variant="secondary" className="w-full sm:w-auto">Look up</Button>
            </form>
          </div>,
        )}
      </div>
    );
  }

  if (route === "org/promo-studio") {
    return (
      <div data-surface="promo-studio">{orgFrame("/promo-studio", <p className="text-sm text-muted">Promo Analyzer</p>)}</div>
    );
  }

  if (route === "org/forms") {
    return (
      <div data-surface="forms">
        {orgFrame(
          "/forms",
          <div>
            <PageHeader title="Forms" description="Build a form, preview it, and count responses." />
            <FormsBuilder organizationId={VIEWPORT_ORG_ID} canWrite canExport />
          </div>,
        )}
      </div>
    );
  }

  if (route === "org/charts") {
    return (
      <div data-surface="charts">
        {orgFrame(
          "/charts",
          <ChartEditor
            initialSpec={defaultSpec("2026-01-01")}
            initialSeries={{ symbol: "EXMPL", name: "Example Corporation With A Very Long Name", source: "example data", unit: "$", warnings: [], bars: viewportBars() }}
            initialError={null}
            chartId={null}
            chartName=""
            projectId={null}
            templates={[]}
            projects={[{ id: "viewport-project", name: "A project with a long name for the viewport check" }]}
            marketNote="Market data is not connected yet: MASSIVE_API_KEY and TIINGO_API_KEY are not set."
            actions={{ fetchSeries: fetchSeriesAction, save: saveChartAction, createProject: createProjectAction, saveTemplate: saveTemplateAction, uploadImage: uploadImageAction }}
          />,
        )}
      </div>
    );
  }

  if (route === "org/search") {
    return (
      <div data-surface="search">
        {orgFrame(
          "/search",
          <div>
            <PageHeader title="Search" description="Global search is a stub in Phase 1." />
            <form className="mb-4">
              <input
                name="q"
                defaultValue={SHARE_URL}
                aria-label="Search"
                className="pc-break h-11 min-h-11 w-full max-w-full rounded-md border border-line px-3"
              />
            </form>
            <p className="pc-break text-sm text-muted">No results for “{SHARE_URL}”.</p>
          </div>,
        )}
      </div>
    );
  }

  if (route === "org/settings") {
    return (
      <div data-surface="settings">
        {orgFrame(
          "/settings",
          <div className="max-w-xl min-w-0">
            <PageHeader title="Organization settings" description="The public slug is the subdomain." />
            <form className="space-y-3 rounded-lg border border-line bg-white p-4">
              <Label htmlFor="displayName">Display name</Label>
              <Input id="displayName" defaultValue={organization.name} />
              <Label htmlFor="supportEmail">Support email</Label>
              <Input id="supportEmail" defaultValue={EMAIL} />
              <Button type="button" className="w-full sm:w-auto">Save settings</Button>
            </form>
          </div>,
        )}
      </div>
    );
  }

  if (route === "org/settings/users") {
    return (
      <div data-surface="settings-users">
        {orgFrame(
          "/settings/users",
          <div>
            <PageHeader title="Users" description="Invites send a magic link." />
            <form className="pc-form-row mb-6">
              <Input type="email" defaultValue={EMAIL} aria-label="Invite email" />
              <Button type="button" className="w-full md:w-auto">Invite</Button>
            </form>
            <WideTable headers={["Email", "Role", "Status"]} rows={[[EMAIL, "Owner", "ACTIVE"]]} />
          </div>,
        )}
      </div>
    );
  }

  if (route === "org/settings/roles") {
    return (
      <div data-surface="settings-roles">
        {orgFrame(
          "/settings/roles",
          <div>
            <PageHeader title="Roles and permissions" description="A grant is not enough by itself." />
            <WideTable
              headers={["Permission", "Owner"]}
              rows={[
                ["settings.users.manage", "Allow"],
                ["billing.manage", "Allow"],
                ["knowledge.write", "Off"],
              ]}
            />
          </div>,
        )}
      </div>
    );
  }

  if (route === "org/settings/modules") {
    return (
      <div data-surface="settings-modules">
        {orgFrame(
          "/settings/modules",
          <div>
            <PageHeader title="Modules" description="Desk plan." />
            <ul className="divide-y divide-line rounded-lg border border-line bg-white">
              <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold">Knowledge</p>
                  <p className="pc-break text-muted">/knowledge · on plan</p>
                </div>
                <span className="inline-flex min-h-11 items-center font-semibold text-accent">Enabled</span>
              </li>
            </ul>
          </div>,
        )}
      </div>
    );
  }

  if (route === "org/settings/audit") {
    return (
      <div data-surface="settings-audit">
        {orgFrame(
          "/settings/audit",
          <div>
            <PageHeader title="Audit log" description="Permission and admin changes for this organization." />
            <WideTable headers={["When", "Action", "Target"]} rows={[["2026-11-15 12:00:00", "settings.slug.changed", SLUG]]} />
          </div>,
        )}
      </div>
    );
  }

  return null;
}
