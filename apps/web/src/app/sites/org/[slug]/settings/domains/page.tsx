import { Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { domainsAccess, providersFromEnv } from "@/features/domains/access";
import { changeTargetAction, checkDomainAction, connectDomainAction, recheckAllAction, removeDomainAction } from "@/features/domains/actions";
import { AutoRefresh } from "@/features/domains/auto-refresh";
import { domainsConfig } from "@/features/domains/config";
import { formatPrice, loadDomains, loadPurchases, timeAgo, type DomainRow } from "@/features/domains/data";
import { settlePendingPurchases } from "@/features/domains/purchases";
import { recheckDue } from "@/features/domains/service";
import { listDomainTargets, type TargetGroup } from "@/features/domains/targets";
import { MissingEnv, RecordsTable, StatusPill, TargetPicker } from "@/features/domains/ui";

export const metadata = { title: "Domains" };

type Search = Promise<{ error?: string; notice?: string; hostname?: string; bought?: string }>;

function DomainCard({ row, groups, canConnect }: { row: DomainRow; groups: TargetGroup[]; canConnect: boolean }) {
  return (
    <li className="min-w-0 rounded-xl border border-line bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <a href={`https://${row.hostname}`} target="_blank" rel="noreferrer" className="break-all font-semibold text-ink hover:text-accent">
              {row.hostname}
            </a>
            <StatusPill status={row.status} />
            {row.provider === "CLOUDFLARE_PURCHASED" ? <span className="text-xs text-muted">Bought here</span> : null}
          </div>
          <p className="mt-1 break-all text-sm text-muted">
            Shows {row.targetLabel ? `${row.targetLabel} ` : ""}
            <code className="font-mono text-xs">{row.targetPath}</code>
          </p>
          {row.companions.map((www) => (
            <p key={www.id} className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="break-all">{www.hostname} → redirects here</span>
              <StatusPill status={www.status} />
            </p>
          ))}
          <p className="mt-1 text-xs text-muted">Checked {timeAgo(row.lastCheckedAt)}</p>
          {row.error ? <p className="mt-2 break-words text-sm text-[#b42318]">{row.error}</p> : null}
        </div>
        <form action={checkDomainAction}>
          <input type="hidden" name="id" value={row.id} />
          <Button type="submit" variant="secondary" size="sm" disabled={!canConnect}>
            Check now
          </Button>
        </form>
      </div>
      <details className="border-t border-line" open={row.status !== "ACTIVE"}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">DNS records</summary>
        <div className="space-y-4 px-4 pb-4">
          <RecordsTable records={row.records} managed={row.managedDns} />
          {row.companions.map((www) => (
            <div key={www.id}>
              <p className="mb-1 text-xs font-semibold text-ink">{www.hostname}</p>
              <RecordsTable records={www.records} managed={www.managedDns} />
            </div>
          ))}
        </div>
      </details>
      <details className="border-t border-line">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Change page</summary>
        <form action={changeTargetAction} className="space-y-3 px-4 pb-4">
          <input type="hidden" name="id" value={row.id} />
          <TargetPicker id={row.id} groups={groups} current={row.targetPath} />
          <Button type="submit" className="w-full sm:w-auto">
            Save page
          </Button>
        </form>
      </details>
      <details className="border-t border-line">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[#b42318]">Remove</summary>
        <form action={removeDomainAction} className="space-y-3 px-4 pb-4">
          <input type="hidden" name="id" value={row.id} />
          <p className="text-sm text-muted">
            Disconnects {row.hostname}
            {row.companions.length ? ` and ${row.companions.map((item) => item.hostname).join(", ")}` : ""} from PubCommand and Railway. The page stops loading on
            this domain. The registration itself is not cancelled.
          </p>
          <div>
            <Label htmlFor={`confirm-${row.id}`}>Type {row.hostname} to confirm</Label>
            <Input id={`confirm-${row.id}`} name="confirm" autoComplete="off" required />
          </div>
          <Button type="submit" variant="danger" className="w-full sm:w-auto">
            Remove domain
          </Button>
        </form>
      </details>
    </li>
  );
}

export default async function DomainsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Search }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await domainsAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied />;
  const { ctx } = access;
  const organizationId = ctx.resolved.id;
  const config = domainsConfig();
  const providers = providersFromEnv();

  const [{ rows, settling }, groups, purchases] = await Promise.all([
    loadDomains(organizationId),
    listDomainTargets(organizationId),
    loadPurchases(organizationId),
  ]);
  let railwayCount: number | null = null;
  if (providers.railway) railwayCount = await providers.railway.countCustomDomains().catch(() => null);

  // Background re-checks: due domains and pending registrations update after this response.
  after(async () => {
    await recheckDue(providers, organizationId).catch(() => undefined);
    await settlePendingPurchases(providers.cloudflare, organizationId).catch(() => undefined);
  });

  return (
    <div className="min-w-0 max-w-3xl">
      <PageHeader
        title="Custom domains"
        description="Show a public page (a form, a launch funnel, a text-letter site) on a domain of your own. Buy one here or connect one you already own."
      />
      <Flash error={query.error} notice={query.notice} />
      {settling ? (
        <p className="mb-4 text-xs text-muted">
          <AutoRefresh /> Waiting on DNS or a certificate; this page refreshes itself. DNS changes can take from a few minutes to a few hours.
        </p>
      ) : null}

      <div className="mb-6 space-y-3">
        {!config.railway.ready ? (
          <MissingEnv
            title="Connecting domains is not set up"
            why="Every custom domain is added to the pubcommand service on Railway, which issues its certificate. Set these on the Railway service, then redeploy:"
            missing={config.railway.missing}
          />
        ) : null}
        {!config.cloudflare.ready ? (
          <MissingEnv
            title="Buying domains is not set up"
            why="Domains are bought through Cloudflare Registrar, billed to that Cloudflare account. Set these to turn on Buy a domain:"
            missing={config.cloudflare.missing}
          />
        ) : null}
      </div>

      <div className="mb-6 flex flex-col gap-2 sm:flex-row">
        <Link
          href="/settings/domains/buy"
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-accent bg-accent px-4 text-sm font-semibold text-white hover:bg-[#1e40af]"
        >
          Buy a domain
        </Link>
        <a
          href="#connect"
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-canvas"
        >
          Connect a domain I own
        </a>
        {rows.length > 0 ? (
          <form action={recheckAllAction} className="sm:ml-auto">
            <Button type="submit" variant="ghost" className="w-full" disabled={!config.railway.ready}>
              Check all
            </Button>
          </form>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="mb-6 rounded-xl border border-dashed border-line bg-white p-6 text-center text-sm text-muted">No custom domains yet.</div>
      ) : (
        <ul className="mb-6 space-y-3">
          {rows.map((row) => (
            <DomainCard key={row.id} row={row} groups={groups} canConnect={config.railway.ready} />
          ))}
        </ul>
      )}

      <form id="connect" action={connectDomainAction} className="mb-6 scroll-mt-6 space-y-4 rounded-xl border border-line bg-white p-5">
        <div>
          <h2 className="text-sm font-semibold">{query.bought ? `Connect ${query.hostname}` : "Connect a domain"}</h2>
          <p className="mt-1 text-sm text-muted">
            Bought here, the DNS records are created for you. Bought elsewhere, we show the records to add at your DNS provider.
          </p>
        </div>
        <div>
          <Label htmlFor="hostname">Domain</Label>
          <Input id="hostname" name="hostname" defaultValue={query.hostname ?? ""} placeholder="example.com or offer.example.com" required maxLength={253} autoComplete="off" />
        </div>
        <TargetPicker id="new" groups={groups} />
        <fieldset>
          <legend className="text-sm font-medium text-ink">www</legend>
          <p className="text-xs text-muted">For a bare domain like example.com.</p>
          <div className="mt-2 space-y-2 text-sm">
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="www" value="redirect" defaultChecked className="h-4 w-4" />
              Also connect www and redirect it to the bare domain
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="www" value="none" className="h-4 w-4" />
              Only this exact domain
            </label>
          </div>
        </fieldset>
        <Button type="submit" className="w-full sm:w-auto" disabled={!config.railway.ready}>
          Connect domain
        </Button>
        <p className="text-xs text-muted">
          Railway limits custom domains per service: 20 on the Pro plan (more only on request), 2 on Hobby. Every organization&apos;s domains share the one pubcommand
          service{railwayCount !== null ? `, which has ${railwayCount} now` : ""}. A www redirect uses a second slot.
        </p>
      </form>

      {purchases.length > 0 ? (
        <section className="rounded-xl border border-line bg-white p-5">
          <h2 className="text-sm font-semibold">Purchases</h2>
          <p className="mt-1 text-xs text-muted">Every attempt is recorded. Domain purchases are non-refundable.</p>
          <ul className="mt-3 divide-y divide-line text-sm">
            {purchases.map((purchase) => (
              <li key={purchase.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="min-w-0 break-all font-medium">{purchase.domain}</span>
                <span className="text-muted">
                  {formatPrice(purchase.price.toFixed(2), purchase.currency)}/yr · {purchase.result.toLowerCase()}
                  {purchase.sandbox ? " · sandbox" : ""} · {purchase.createdAt.toISOString().slice(0, 10)}
                </span>
                {purchase.error ? <span className="w-full break-words text-xs text-[#b42318]">{purchase.error}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
