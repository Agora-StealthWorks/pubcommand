import { aiConfigured } from "@pubcommand/ai";
import { Badge, Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { assignCompetitor, deleteEmail, extractEmail, sendEmailToPromoAnalyzer } from "@/features/intel/actions";
import { canUsePromoAnalyzer, intelAccess } from "@/features/intel/context";
import { competitorOptions, loadEmail } from "@/features/intel/data";
import { loadLanding } from "@/features/intel/landing";
import { fetchEmailLanding } from "@/features/intel/more-actions";
import { entitiesFor } from "@/features/intel/registry";
import { emailDocument, sanitizeEmailHtml } from "@/features/intel/sanitize";
import { AiMissingNotice, EntityChips, ExtractionState, ExtractionView, LandingCard, TypeBadge, formatDate } from "@/features/intel/ui";
import { isCommercial, isUtilityLink } from "../../../../../../../../../../modules/intel/index";

const VIEWS = ["html", "text", "links"] as const;

export default async function IntelEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; emailId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug, emailId } = await params;
  const search = await searchParams;
  const access = await intelAccess("read", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const { scope } = access;
  const email = await loadEmail(scope.organizationId, scope.brand.id, emailId);
  if (!email) notFound();
  const [competitors, promoAllowed, landing, entities] = await Promise.all([
    competitorOptions(scope.organizationId, scope.brand.id),
    canUsePromoAnalyzer(slug),
    loadLanding(scope.organizationId, email.landingPageId),
    entitiesFor(scope.organizationId, { emailId: email.id }),
  ]);
  const landingUrl = email.extraction?.landingUrl ?? email.landingUrl;

  const view = (VIEWS as readonly string[]).includes(search.view ?? "") ? (search.view as (typeof VIEWS)[number]) : email.htmlBody ? "html" : "text";
  const images = search.images === "1";
  const sanitized = email.htmlBody && view === "html" ? sanitizeEmailHtml(email.htmlBody, { allowRemoteImages: images }) : null;
  const base = `/intel/emails/${email.id}`;
  const viewHref = (next: string, withImages = images) => `${base}?view=${next}${withImages ? "&images=1" : ""}`;
  const busy = email.extractionStatus === "QUEUED" || email.extractionStatus === "RUNNING";
  const ai = aiConfigured();

  return (
    <div className="min-w-0">
      <Link href="/intel" className="text-sm text-accent underline">
        ← Inbox
      </Link>
      <div className="mt-3">
        <Flash error={search.error} notice={search.notice} />
      </div>
      <header className="mb-4 rounded-xl border border-line bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <TypeBadge type={email.emailType} />
          {email.placement ? <Badge>{email.placement.toLowerCase()}</Badge> : null}
          <Badge>{email.source}</Badge>
        </div>
        <h2 className="pc-break mt-2 text-xl font-semibold tracking-tight text-ink">{email.subject}</h2>
        <dl className="mt-2 grid gap-1 text-sm">
          <div className="flex min-w-0 flex-wrap gap-x-2">
            <dt className="text-muted">From</dt>
            <dd className="pc-break min-w-0">
              {email.fromName ? `${email.fromName} ` : ""}&lt;{email.fromAddress}&gt;
            </dd>
          </div>
          {email.toAddress ? (
            <div className="flex min-w-0 flex-wrap gap-x-2">
              <dt className="text-muted">To</dt>
              <dd className="pc-break min-w-0">{email.toAddress}</dd>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted">Sent</dt>
            <dd>{formatDate(email.receivedAt)}</dd>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2">
            <dt className="text-muted">Competitor</dt>
            <dd className="min-w-0">
              {email.competitor ? (
                <Link href={`/intel/competitors/${email.competitor.id}`} className="text-accent underline">
                  {email.competitor.name}
                </Link>
              ) : (
                <span className="text-muted">Not matched</span>
              )}
              {email.matchedBy ? <span className="ml-1 text-xs text-muted">(by {email.matchedBy})</span> : null}
            </dd>
          </div>
        </dl>
        <EntityChips entities={entities} />
        {scope.canWrite ? (
          <form action={assignCompetitor} className="mt-3 flex flex-wrap items-center gap-2">
            <input type="hidden" name="emailId" value={email.id} />
            <label htmlFor="assign-competitor" className="sr-only">
              Set competitor
            </label>
            <select id="assign-competitor" name="competitorId" defaultValue={email.competitorId ?? ""} className="pc-control min-w-0 max-w-full flex-1 sm:max-w-xs">
              <option value="">No competitor</option>
              {competitors.map((competitor) => (
                <option key={competitor.id} value={competitor.id}>
                  {competitor.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary" size="sm">
              Set competitor
            </Button>
            {competitors.length === 0 ? (
              <Link href="/intel/competitors" className="text-sm text-accent underline">
                Add a competitor
              </Link>
            ) : null}
          </form>
        ) : null}
      </header>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <nav className="flex gap-1 rounded-lg border border-line bg-white p-1" aria-label="Email view">
              {VIEWS.filter((item) => item !== "html" || email.htmlBody).map((item) => (
                <Link
                  key={item}
                  href={viewHref(item)}
                  className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm font-semibold ${view === item ? "bg-accent text-white" : "text-ink hover:bg-canvas"}`}
                >
                  {item === "html" ? "Email" : item === "text" ? "Plain text" : `Links (${email.links.length})`}
                </Link>
              ))}
            </nav>
            {view === "html" && email.htmlBody ? (
              <Link href={viewHref("html", !images)} className="text-sm text-accent underline">
                {images ? "Block remote images" : `Show remote images${sanitized?.blockedImages ? ` (${sanitized.blockedImages} blocked)` : ""}`}
              </Link>
            ) : null}
          </div>
          {view === "html" && sanitized ? (
            <>
              {!images && sanitized.blockedImages ? (
                <p className="mb-2 text-xs text-muted">Remote images and tracking pixels are blocked, so the sender cannot see this was opened.</p>
              ) : null}
              <iframe
                title="Email"
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer"
                srcDoc={emailDocument(sanitized.html, { allowRemoteImages: images })}
                className="h-[70vh] w-full rounded-xl border border-line bg-white"
              />
            </>
          ) : null}
          {view === "text" ? (
            <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-white p-4 font-sans text-sm text-ink">
              {email.textBody || "This email has no text."}
            </pre>
          ) : null}
          {view === "links" ? (
            <ul className="divide-y divide-line rounded-xl border border-line bg-white">
              {email.links.length === 0 ? <li className="px-4 py-3 text-sm text-muted">No links.</li> : null}
              {email.links.map((link) => (
                <li key={link.href} className="px-4 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{link.text || "(no text)"}</span>
                    {link.count > 1 ? <Badge>{link.count}×</Badge> : null}
                    {isUtilityLink(link) ? <Badge>utility</Badge> : null}
                    {link.href === email.landingUrl ? <Badge tone="accent">landing page</Badge> : null}
                  </div>
                  <p className="pc-break text-xs text-muted">{link.href}</p>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-xs text-muted">
            <a href={`${base}/raw`} className="underline">
              Download the original (.eml)
            </a>
            {" · "}
            {(email.rawSize / 1024).toFixed(0)} KB
            {email.gmailAccount ? ` · from ${email.gmailAccount.email}` : ""}
          </p>
        </section>

        <aside className="min-w-0 space-y-4">
          <div className="rounded-xl border border-line bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Extraction</h3>
              {scope.canWrite && ai && !busy ? (
                <form action={extractEmail}>
                  <input type="hidden" name="emailId" value={email.id} />
                  <Button type="submit" variant="secondary" size="sm">
                    {email.extraction ? "Run again" : "Extract"}
                  </Button>
                </form>
              ) : null}
            </div>
            {!ai && !email.extraction ? <AiMissingNotice what="this email has not been extracted" /> : null}
            <ExtractionState status={email.extractionStatus} error={email.extractionError} />
            {email.extraction ? (
              <>
                <ExtractionView extraction={email.extraction} />
                <p className="mt-3 text-xs text-muted">
                  Read by AI ({email.extractionModel}){email.extractedAt ? ` on ${formatDate(email.extractedAt)}` : ""}. Prices and names are as the email states them; check before reusing.
                  {isCommercial(email.extraction.type) ? " Saved to this brand's Brain." : ""}
                </p>
              </>
            ) : !busy && ai && email.extractionStatus === "NONE" ? (
              <p className="text-sm text-muted">Not extracted yet.</p>
            ) : null}
          </div>

          {landingUrl || landing ? (
            <LandingCard landing={landing}>
              {scope.canWrite && landingUrl ? (
                <form action={fetchEmailLanding}>
                  <input type="hidden" name="emailId" value={email.id} />
                  {ai ? <input type="hidden" name="reextract" value="1" /> : null}
                  <Button type="submit" variant="secondary" size="sm">
                    {landing ? "Fetch again" : "Fetch page"}
                  </Button>
                </form>
              ) : null}
            </LandingCard>
          ) : null}

          <div className="rounded-xl border border-line bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Promo Analyzer</h3>
            {email.promo ? (
              <p className="text-sm">
                <Link href={`/promo-studio/${email.promo.id}`} className="text-accent underline">
                  Open the full analysis
                </Link>{" "}
                <span className="text-muted">
                  ({email.promo.analysisStatus.toLowerCase()}
                  {email.promo.effectivenessScore != null ? `, score ${email.promo.effectivenessScore.toFixed(1)}` : ""})
                </span>
              </p>
            ) : scope.canWrite && promoAllowed ? (
              <form action={sendEmailToPromoAnalyzer} className="space-y-2">
                <input type="hidden" name="emailId" value={email.id} />
                <p className="text-sm text-muted">Run the full copy analysis on this email: headline, structure, offer, score. It is saved as a promo in {scope.brand.name}.</p>
                <Button type="submit" className="w-full sm:w-auto">
                  Send to Promo Analyzer
                </Button>
              </form>
            ) : (
              <p className="text-sm text-muted">Sending to Promo Analyzer needs Promo Analyzer turned on and promo.write.</p>
            )}
          </div>

          {scope.canWrite ? (
            <form action={deleteEmail}>
              <input type="hidden" name="emailId" value={email.id} />
              <Button type="submit" variant="danger" size="sm">
                Delete email
              </Button>
            </form>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
