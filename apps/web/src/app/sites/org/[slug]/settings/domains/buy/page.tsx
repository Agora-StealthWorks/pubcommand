import { Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { domainsAccess } from "@/features/domains/access";
import { buyDomainAction } from "@/features/domains/actions";
import { cloudflareFromEnv, type DomainCheck, type DomainSuggestion } from "@/features/domains/cloudflare";
import { domainsConfig } from "@/features/domains/config";
import { formatPrice, normalizeHostname } from "@/features/domains/data";
import { MissingEnv } from "@/features/domains/ui";
import { rootDomain } from "@/lib/auth";

export const metadata = { title: "Buy a domain" };

type Search = Promise<{ q?: string; domain?: string; error?: string }>;

function ConfirmPurchase({ check, sandbox }: { check: DomainCheck; sandbox: boolean }) {
  if (!check.registrable || !check.pricing) {
    return (
      <div className="rounded-xl border border-line bg-white p-5">
        <p className="break-all font-semibold">{check.name}</p>
        <p className="mt-1 text-sm text-[#b42318]">{check.reason ? `Not available: ${check.reason}.` : "This domain is not available."}</p>
      </div>
    );
  }
  if (check.tier && check.tier !== "standard") {
    return (
      <div className="rounded-xl border border-line bg-white p-5">
        <p className="break-all font-semibold">{check.name}</p>
        <p className="mt-1 text-sm text-muted">This is a premium domain. Cloudflare&apos;s Registrar API cannot buy premium domains yet.</p>
      </div>
    );
  }
  const price = formatPrice(check.pricing.registrationCost, check.pricing.currency);
  const renewal = formatPrice(check.pricing.renewalCost, check.pricing.currency);
  return (
    <form action={buyDomainAction} className="space-y-4 rounded-xl border-2 border-accent bg-white p-5">
      <input type="hidden" name="domain" value={check.name} />
      <input type="hidden" name="price" value={check.pricing.registrationCost} />
      <input type="hidden" name="currency" value={check.pricing.currency} />
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[#067647]">Available</p>
        <h2 className="mt-1 break-all text-lg font-semibold text-ink">
          Buy {check.name} for {price}/year — non-refundable
        </h2>
        <p className="mt-1 text-sm text-muted">
          Renews at {renewal}/year, automatically, on the Cloudflare account&apos;s billing method. The price was just checked with the registry and is checked again when
          you press Buy; if it changed, nothing is bought.
        </p>
        {sandbox ? <p className="mt-2 text-sm font-medium text-[#b54708]">Sandbox mode: Cloudflare&apos;s registrar sandbox, nothing is charged.</p> : null}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="acknowledge" value="yes" required className="mt-0.5 h-4 w-4 shrink-0" />
        <span>I understand this purchase is final and cannot be refunded.</span>
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" className="w-full sm:w-auto">
          Buy {check.name} for {price}
        </Button>
        <Link href="/settings/domains/buy" className="inline-flex min-h-11 items-center justify-center rounded-md border border-line px-4 text-sm font-semibold">
          Cancel
        </Link>
      </div>
    </form>
  );
}

export default async function BuyDomainPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Search }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await domainsAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied />;
  const config = domainsConfig();
  const cloudflare = cloudflareFromEnv();
  const q = (query.q ?? "").trim().slice(0, 100);
  const exact = query.domain ? normalizeHostname(query.domain, rootDomain()) : q.includes(".") ? normalizeHostname(q, rootDomain()) : null;

  let error = query.error;
  let check: DomainCheck | null = null;
  let suggestions: DomainSuggestion[] = [];
  if (cloudflare && exact) {
    if (!exact.ok) error = error ?? exact.reason;
    else if (!exact.isApex) error = error ?? `Buy the main domain (${exact.apex}); you can point any subdomain of it later.`;
    else {
      try {
        [check] = await cloudflare.checkDomains([exact.hostname]);
        if (!check) error = error ?? "Cloudflare did not return that domain.";
      } catch (problem) {
        error = error ?? `Could not check the domain: ${problem instanceof Error ? problem.message : "unknown error"}`;
      }
    }
  } else if (cloudflare && q.length >= 2) {
    try {
      suggestions = await cloudflare.searchDomains(q);
    } catch (problem) {
      error = error ?? `Search failed: ${problem instanceof Error ? problem.message : "unknown error"}`;
    }
  }

  return (
    <div className="min-w-0 max-w-2xl">
      <p className="mb-2 text-sm">
        <Link href="/settings/domains" className="text-muted hover:text-ink">
          ← Domains
        </Link>
      </p>
      <PageHeader title="Buy a domain" description="Search for a name, check its price with the registry, then confirm. Bought domains are set up for you." />
      <Flash error={error} />
      {!config.cloudflare.ready ? (
        <MissingEnv
          title="Buying domains is not set up"
          why="Domains are bought through Cloudflare Registrar, billed to that Cloudflare account. Set these on the Railway service, then redeploy:"
          missing={config.cloudflare.missing}
        />
      ) : (
        <div className="space-y-5">
          <form method="get" className="flex flex-col gap-2 rounded-xl border border-line bg-white p-4 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <Label htmlFor="q">Name or keyword</Label>
              <Input id="q" name="q" defaultValue={query.domain ?? q} placeholder="myoffer.com or my offer" required minLength={2} maxLength={100} />
            </div>
            <Button type="submit" variant="secondary" className="w-full sm:w-auto">
              Search
            </Button>
          </form>
          {check ? <ConfirmPurchase check={check} sandbox={config.cloudflare.sandbox} /> : null}
          {suggestions.length > 0 ? (
            <section className="rounded-xl border border-line bg-white p-4">
              <h2 className="text-sm font-semibold">Suggestions</h2>
              <p className="mt-1 text-xs text-muted">Prices here are estimates. Check one to get the registry&apos;s price before buying.</p>
              <ul className="mt-3 divide-y divide-line">
                {suggestions.map((item) => (
                  <li key={item.name} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0 break-all font-medium">{item.name}</span>
                    <span className="flex items-center gap-3">
                      <span className="text-muted">
                        {item.registrable ? (item.pricing ? `~${formatPrice(item.pricing.registrationCost, item.pricing.currency)}/yr` : "available") : "taken"}
                      </span>
                      {item.registrable ? (
                        <Link href={`/settings/domains/buy?domain=${encodeURIComponent(item.name)}`} className="inline-flex min-h-11 items-center font-semibold text-accent">
                          Check
                        </Link>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : q && !exact && !error ? (
            <p className="text-sm text-muted">No suggestions for “{q}”. Try a full name like {q.replace(/\s+/g, "")}.com.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
