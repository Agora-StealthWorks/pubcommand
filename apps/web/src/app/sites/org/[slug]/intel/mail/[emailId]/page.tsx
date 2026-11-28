import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { ispyEmailDocument, ispyEmailHtml } from "@/features/ispy/email-view";
import { ReportPanel } from "@/features/ispy/org-blocks";
import { UUID, ispyOrgScope, qs, searchDuplicateTargets } from "@/features/ispy/org-data";
import { IspyTypeBadge, KindBadge, formatDay } from "@/features/ispy/org-ui";
import { getEmail } from "@/features/ispy/read";
import { currentRequest } from "@/lib/request";
import { hostOf, isUtilityLink, type EmailLink } from "../../../../../../../../../../modules/intel/index";
import { INBOX_LEVEL_LABELS, LIST_CATEGORY_LABELS, describeConditions, kindForViewer, parseConditions, type InboxLevel, type ListCategory } from "../../../../../../../../../../modules/ispy/index";

const VIEWS = ["email", "text", "links", "raw"] as const;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="grid gap-0.5 border-b border-line py-2 last:border-b-0 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="pc-break min-w-0 text-sm text-ink">{children}</dd>
    </div>
  );
}

function AuthPill({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  const tone = value === "pass" ? "bg-[#dcfae6] text-[#067647]" : value === "fail" ? "bg-[#fee4e2] text-[#b42318]" : "bg-canvas text-muted";
  return (
    <span className={`mr-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {label} {value}
    </span>
  );
}

export default async function IspyEmailPage({ params, searchParams }: { params: Promise<{ slug: string; emailId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug, emailId } = await params;
  const search = await searchParams;
  if (!UUID.test(emailId)) notFound();
  const found = await ispyOrgScope(slug, search.feed);
  if (!found.ok) return <Denied title={found.error} />;
  const { viewer, scope } = found.value;
  const email = await getEmail(viewer, emailId);
  if (!email) notFound();
  const { origin } = await currentRequest();
  const feedParam = search.feed;
  const view = (VIEWS as readonly string[]).includes(search.view ?? "") ? (search.view as (typeof VIEWS)[number]) : email.htmlBody ? "email" : "text";
  const base = `/intel/mail/${email.id}`;
  const back = `${base}${qs({ feed: feedParam, view: search.view })}`;
  const kind = kindForViewer({ sendKind: email.sendKind, publisherLinkedOrgId: email.publisher?.linkedOrganizationId ?? null, publicationLinkedOrgId: email.publication?.linkedOrganizationId ?? null }, scope.organizationId);
  const rendered = view === "email" && email.htmlBody ? ispyEmailHtml(email.htmlBody, origin) : null;
  const links = (Array.isArray(email.links) ? (email.links as unknown as EmailLink[]) : []).filter((l) => !isUtilityLink(l));
  const auth = (email.authResults ?? null) as { spf?: string | null; dkim?: string | null; dmarc?: string | null } | null;
  const dupResults = search.dupq ? await searchDuplicateTargets(viewer, "PROMO", search.dupq, email.promoId ?? "") : [];
  const rule = email.rule ? describeConditions(parseConditions(email.rule.conditions)) : null;

  return (
    <div className="min-w-0">
      <Link href={`/intel${qs({ feed: feedParam })}`} className="text-sm text-accent underline">
        ← Feed
      </Link>
      <div className="mt-3">
        <Flash error={search.error} notice={search.notice} />
      </div>
      <header className="mb-4 rounded-xl border border-line bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <IspyTypeBadge type={email.emailType} />
          <KindBadge kind={kind} />
          {kind === "INTERNAL" ? <span className="rounded-full bg-[#d3f0eb] px-2 py-0.5 text-xs font-semibold text-[#0b5248]">teaching your Brain</span> : null}
          {email.placement ? <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-semibold text-muted">{email.placement.toLowerCase()}</span> : null}
        </div>
        <h2 className="pc-break mt-2 text-xl font-semibold tracking-tight text-ink">“{email.subject}”</h2>
        <p className="pc-break mt-1 text-sm text-muted">
          {email.fromName ? `${email.fromName} ` : ""}&lt;{email.fromAddress}&gt; · {formatDay(email.receivedAt)}
          {email.publisher ? ` · ${email.publisher.name}` : ""}
          {email.list ? ` · ${email.list.name}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          {email.copy ? (
            <Link href={`/intel/copies/${email.copy.id}${qs({ feed: feedParam })}`} className="text-accent underline">
              {email.copy.sendCount > 1 ? `This copy was sent ${email.copy.sendCount}× (${email.copy.subjectCount} subject${email.copy.subjectCount === 1 ? "" : "s"}) →` : "This copy: first send →"}
            </Link>
          ) : null}
          {email.promo ? (
            <Link href={`/intel/promos/${email.promo.id}${qs({ feed: feedParam })}`} className="text-accent underline">
              Promo: {email.promo.headline ?? hostOf(email.promo.landingUrl)} →
            </Link>
          ) : null}
        </div>
      </header>

      <div className="flex flex-wrap items-start gap-4">
        <section className="min-w-0 flex-[999_1_560px] overflow-hidden rounded-xl border border-line bg-white">
          <nav aria-label="Email view" className="flex flex-wrap gap-1 border-b border-line px-2">
            {VIEWS.filter((v) => v !== "email" || email.htmlBody).map((v) => (
              <Link key={v} href={`${base}${qs({ feed: feedParam, view: v })}`} className={`-mb-px inline-flex min-h-11 items-center border-b-[3px] px-3 text-sm font-bold ${view === v ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}>
                {v === "email" ? "Email" : v === "text" ? "Text" : v === "links" ? `Links (${links.length})` : "Raw provider data"}
              </Link>
            ))}
          </nav>
          {rendered ? (
            <div className="bg-[#fafbfc] p-3">
              <iframe
                title="Email"
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer"
                srcDoc={ispyEmailDocument(rendered.html, origin)}
                className="h-[70vh] w-full rounded-md border border-line bg-white"
              />
              <p className="mt-2 text-xs text-muted">
                Images load through PubCommand, so publishers never see who is reading.{rendered.pixelsRemoved ? ` ${rendered.pixelsRemoved} tracking pixel${rendered.pixelsRemoved === 1 ? "" : "s"} removed.` : ""}
              </p>
            </div>
          ) : null}
          {view === "text" ? <pre className="pc-break max-h-[70vh] overflow-auto whitespace-pre-wrap p-4 font-sans text-sm text-ink">{email.textBody}</pre> : null}
          {view === "links" ? (
            <ul className="divide-y divide-line">
              {links.length ? (
                links.map((l) => (
                  <li key={l.href} className="px-4 py-2 text-sm">
                    <a href={l.href} target="_blank" rel="noopener noreferrer nofollow" className="pc-break text-accent underline">
                      {l.text || l.href}
                    </a>
                    <span className="pc-break block text-xs text-muted">
                      {hostOf(l.href)}
                      {l.count > 1 ? ` · ${l.count}×` : ""}
                    </span>
                  </li>
                ))
              ) : (
                <li className="px-4 py-6 text-sm text-muted">No content links (unsubscribe, preference and social links are hidden).</li>
              )}
            </ul>
          ) : null}
          {view === "raw" ? (
            <div className="p-4">
              <pre className="max-h-[70vh] overflow-auto rounded-md bg-ink p-4 text-xs leading-relaxed text-[#e8ecf3]">{JSON.stringify(email.providerMeta ?? { provider: "none recorded" }, null, 2)}</pre>
              <p className="mt-2 text-xs text-muted">Everything the mail provider sent with this message, kept as-is.</p>
            </div>
          ) : null}
        </section>

        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          <div className="rounded-xl border border-line bg-white p-4">
            <h3 className="text-sm font-semibold text-ink">Why is this email here?</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink">
              {email.receivedInbox ? (
                <li className="pc-break">
                  Arrived at <code className="rounded bg-canvas px-1 text-xs">{email.receivedInbox.address}</code> ({INBOX_LEVEL_LABELS[email.receivedInbox.level as InboxLevel] ?? email.receivedInbox.level}).
                </li>
              ) : null}
              {rule && email.rule ? (
                <li className="pc-break">
                  Matched rule #{email.rule.priority}: {rule}.
                </li>
              ) : null}
              <li className="pc-break">{email.routeReason ?? "No routing reason recorded."}</li>
              {email.list ? (
                <li>
                  List: <strong>{email.list.name}</strong> ({LIST_CATEGORY_LABELS[email.list.category as ListCategory] ?? email.list.category})
                  {email.inbox && email.receivedInbox && email.inbox.address !== email.receivedInbox.address ? <> · moved to <code className="rounded bg-canvas px-1 text-xs">{email.inbox.address}</code></> : null}
                </li>
              ) : null}
              <li>
                {kind === "INTERNAL"
                  ? "It's from a publication linked to your organization, so it's Internal for you (External for every other org)."
                  : kind === "AFFILIATE"
                    ? "The mailer is an affiliate file, so it's credited to the advertiser on the landing page."
                    : "It's from a publisher outside your organization."}
              </li>
            </ol>
          </div>
          <div className="rounded-xl border border-line bg-white p-4">
            <h3 className="text-sm font-semibold text-ink">Sender &amp; deliverability</h3>
            <dl className="mt-1">
              <Fact label="Email platform">{email.espName}</Fact>
              <Fact label="Campaign ID">{email.campaignId ? <code className="text-xs">{email.campaignId}</code> : null}</Fact>
              <Fact label="List-Id">{email.listIdHeader ? <code className="text-xs">{email.listIdHeader}</code> : null}</Fact>
              <Fact label="SPF / DKIM / DMARC">
                {auth ? (
                  <>
                    <AuthPill label="SPF" value={auth.spf} />
                    <AuthPill label="DKIM" value={auth.dkim} />
                    <AuthPill label="DMARC" value={auth.dmarc} />
                  </>
                ) : null}
              </Fact>
              <Fact label="Sending IP">{email.sendingIp}</Fact>
              <Fact label="Spam score">{email.spamScore !== null && email.spamScore !== undefined ? String(email.spamScore) : null}</Fact>
              <Fact label="Placement">{email.placement?.toLowerCase()}</Fact>
            </dl>
            {!email.espName && !email.campaignId && !auth && !email.sendingIp ? <p className="text-sm text-muted">The headers carried no sender details.</p> : null}
          </div>
          <ReportPanel targetType="EMAIL" targetId={email.id} feed={email.feed} back={back} canWrite={scope.canWrite} dupKind="PROMO" dupQuery={search.dupq ?? ""} dupResults={dupResults} />
        </aside>
      </div>
    </div>
  );
}
