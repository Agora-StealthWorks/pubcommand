import { Button, Input, Label, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DEFAULT_TICKER, themeFrom } from "../../../../../../../../../modules/websites/content";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { cookies } from "next/headers";
import { generateApiKey, saveSettings } from "@/features/websites/actions";
import { webhookSecret } from "@/features/websites/api";
import { tickerConfigured } from "@/features/websites/ticker";
import { NoSite, SiteBar } from "@/features/websites/admin-ui";
import { sitePublications } from "@/features/websites/data";
import { NEW_KEY_COOKIE, websitesAccess } from "@/features/websites/guard";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <h2 className="font-semibold">{title}</h2>
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

const COLORS = [
  ["primary", "Main color (header, footer)"],
  ["accent", "Accent (buttons, rules)"],
  ["accentOnLight", "Accent text on white"],
  ["cream", "Warm background"],
  ["ink", "Body text"],
] as const;

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await websitesAccess(slug, "websites.publish");
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, sites, site } = access;
  if (!site) return <NoSite />;
  const pubs = await sitePublications(ctx.resolved.id, ctx.brand.id);
  const theme = themeFrom(site.theme);
  const newKey = (await cookies()).get(NEW_KEY_COOKIE)?.value;
  const apiBase = `${ctx.request.origin}/api/websites/v1`;
  const logo = (id: string | null, label: string, field: string, hint: string, dark: boolean) => (
    <div>
      <Label htmlFor={field}>{label}</Label>
      <div className={`mb-2 flex h-24 items-center justify-center rounded-lg border border-line ${dark ? "" : "bg-white"}`} style={dark ? { background: theme.primary } : undefined}>
        {id ? (
          <img src={`/w/${site.slug}/media/${id}`} alt="" className="max-h-20 max-w-[90%] object-contain" />
        ) : (
          <span className={`text-xs ${dark ? "text-white/70" : "text-muted"}`}>Using the brand logo from Publication Setup</span>
        )}
      </div>
      <input id={field} type="file" name={field} accept="image/png,image/jpeg,image/webp,image/svg+xml" className="block w-full text-xs" />
      <p className="mt-1 text-xs text-muted">{hint}</p>
      {id ? (
        <label className="mt-1 flex items-center gap-2 text-xs">
          <input type="checkbox" name={`${field}Remove`} /> Remove
        </label>
      ) : null}
    </div>
  );
  return (
    <div>
      <PageHeader title="Site settings" description="Address, logo, colors, menus and footer for the public website and the members area." />
      <Flash error={query.error} notice={query.notice} />
      <SiteBar sites={sites} site={site} back="/websites/settings" />
      <form action={saveSettings} className="space-y-5">
        <input type="hidden" name="siteId" value={site.id} />
        <Section title="Separate site app" description="FreeMarketSociety.org runs as its own app (its own GitHub repo and Railway project) and reads everything from here. Put its address here so sign-in emails and publish refreshes go to it.">
          <div>
            <Label htmlFor="s-public-url">Site address</Label>
            <Input id="s-public-url" name="publicUrl" defaultValue={site.publicUrl ?? ""} maxLength={300} placeholder="https://freemarketsociety.org" />
          </div>
        </Section>

        <Section title="Site">
          <div>
            <Label htmlFor="s-name">Site name</Label>
            <Input id="s-name" name="name" defaultValue={site.name} required maxLength={120} />
          </div>
          <div>
            <Label htmlFor="s-tagline">Tagline</Label>
            <Input id="s-tagline" name="tagline" defaultValue={site.tagline} maxLength={200} placeholder="Independent research for people who believe prosperity follows liberty." />
          </div>
          <div>
            <Label htmlFor="s-slug">Address on PubCommand</Label>
            <Input id="s-slug" name="slug" defaultValue={site.slug} required maxLength={60} />
            <p className="mt-1 text-xs text-muted">
              /w/{site.slug}. Your own domain (e.g. freemarketsociety.org) is set in{" "}
              <Link href="/settings/domains" className="font-semibold text-accent">
                Settings → Domains
              </Link>
              .
            </p>
          </div>
          <div>
            <Label htmlFor="s-status">Status</Label>
            <select id="s-status" name="status" defaultValue={site.status} className="pc-control w-full">
              <option value="draft">Not live (only signed-in staff can preview)</option>
              <option value="live">Live (public)</option>
            </select>
          </div>
          <div>
            <Label htmlFor="s-support">Support email (members area)</Label>
            <Input id="s-support" name="supportEmail" type="email" defaultValue={site.supportEmail ?? ""} maxLength={254} />
          </div>
          <div>
            <Label htmlFor="s-signup">Newsletter in the sign-up bar</Label>
            <select id="s-signup" name="signupPublicationId" defaultValue={site.signupPublicationId ?? ""} className="pc-control w-full">
              <option value="">First free newsletter</option>
              {pubs.free.map((pub) => (
                <option key={pub.id} value={pub.id}>
                  {pub.name}
                </option>
              ))}
            </select>
          </div>
        </Section>

        <Section title="Logo" description="Upload SVG, PNG or JPG. SVGs are turned into sharp PNGs. Leave empty to use the brand logos from Publication Setup.">
          {logo(site.logoAssetId, "Logo for the dark header", "logo", "Light artwork (e.g. cream + gold on navy).", true)}
          {logo(site.logoLightAssetId, "Logo for white backgrounds", "logoLight", "Dark artwork (e.g. navy + gold).", false)}
          {logo(site.iconAssetId, "Icon (favicon, app icon)", "icon", "Square, 512×512 or larger.", true)}
          <div>
            <Label htmlFor="s-logo-height">Header logo height (px)</Label>
            <Input id="s-logo-height" name="logoHeight" type="number" min={32} max={160} defaultValue={site.logoHeight} />
            <p className="mt-1 text-xs text-muted">Desktop size. Phones use about 70% of this.</p>
          </div>
        </Section>

        <Section title="Colors" description="Defaults follow the Free Market Society style guide.">
          {COLORS.map(([key, label]) => (
            <div key={key}>
              <Label htmlFor={`c-${key}`}>{label}</Label>
              <div className="flex items-center gap-2">
                <input id={`c-${key}`} type="color" name={`theme_${key}`} defaultValue={theme[key]} className="h-11 w-14 rounded border border-line" />
                <span className="font-mono text-xs text-muted">{theme[key]}</span>
              </div>
            </div>
          ))}
        </Section>

        <section className="rounded-xl border border-line bg-white p-5 text-sm">
          <h2 className="font-semibold">Menus</h2>
          <p className="mt-1 text-muted">
            The header menu and topic bar are edited in{" "}
            <a href="/websites/menus" className="font-semibold text-accent">
              Websites → Menus
            </a>
            .
          </p>
        </section>

        <Section
          title="Market ticker"
          description={`Live prices from Massive, refreshed every 5 minutes${tickerConfigured() ? "" : " (Massive is not connected yet: set MASSIVE_API_KEY on PubCommand)"}. Choose the symbols: one per line, "Label | SYMBOL". Massive has no index values, so use the funds that track them (SPY, DIA, QQQ); crypto is X:BTCUSD. Leave empty for the default list.`}
        >
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="showTicker" defaultChecked={site.showTicker} /> Show the ticker
          </label>
          <div className="sm:col-span-2">
            <Textarea name="tickerText" rows={6} defaultValue={site.tickerText} placeholder={DEFAULT_TICKER.map((row) => `${row.label} | ${row.symbol}`).join("\n")} className="font-mono text-xs" aria-label="Ticker symbols" />
          </div>
        </Section>

        <Section title="Footer">
          <div>
            <Label htmlFor="s-footer">About line</Label>
            <Textarea id="s-footer" name="footerText" rows={3} defaultValue={site.footerText} maxLength={600} />
          </div>
          <div>
            <Label htmlFor="s-disclaimer">Disclaimer (small print on every page)</Label>
            <Textarea id="s-disclaimer" name="disclaimer" rows={5} defaultValue={site.disclaimer} maxLength={4000} />
          </div>
        </Section>
        <div className="sticky bottom-0 -mx-4 border-t border-line bg-canvas/95 px-4 py-3 sm:-mx-6 sm:px-6">
          <Button>Save settings</Button>
        </div>
      </form>

      <section id="api" className="mt-5 rounded-xl border border-line bg-white p-5">
        <h2 className="font-semibold">API key for the site app</h2>
        <p className="mt-1 text-sm text-muted">The site app sends this key with every request. Put these three values in its Railway variables. Only the key&apos;s fingerprint is kept here, so copy it when it is shown.</p>
        {newKey ? (
          <div className="mt-4 rounded-lg border border-[#abefc6] bg-[#ecfdf3] p-4 text-sm">
            <p className="font-semibold text-[#067647]">Copy the key now. It is shown only this once.</p>
            <dl className="mt-3 grid gap-2 font-mono text-xs [overflow-wrap:anywhere]">
              <div><dt className="text-muted">PUBCOMMAND_API_URL</dt><dd>{apiBase}</dd></div>
              <div><dt className="text-muted">PUBCOMMAND_SITE_KEY</dt><dd>{newKey}</dd></div>
              <div><dt className="text-muted">PUBCOMMAND_WEBHOOK_SECRET</dt><dd>{webhookSecret(site)}</dd></div>
            </dl>
          </div>
        ) : site.apiKeyPrefix ? (
          <p className="mt-3 text-sm">
            Current key: <span className="font-mono">{site.apiKeyPrefix}</span> · API address <span className="font-mono text-xs">{apiBase}</span>
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted">No key yet.</p>
        )}
        <form action={generateApiKey} className="mt-4">
          <input type="hidden" name="siteId" value={site.id} />
          <Button variant={site.apiKeyPrefix ? "secondary" : "primary"}>{site.apiKeyPrefix ? "Replace key (the old one stops working)" : "Make API key"}</Button>
        </form>
      </section>
    </div>
  );
}
