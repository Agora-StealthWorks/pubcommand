import { NICHE_LABELS, brandProfile } from "@pubcommand/core";
import { Button, Label, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { AutoRefresh } from "@/features/promos/auto-refresh";
import { aiCheckAction, approveTestimonialAction, deleteFileAction, deleteTestimonialAction, rejectTestimonialAction, reopenTestimonialAction, updateTestimonialAction } from "@/features/testimonials/actions";
import { testimonialsPage } from "@/features/testimonials/guard";
import { getTestimonial } from "@/features/testimonials/server";
import { ConsentFields, FlagList, StatusBadge, TestimonialFields } from "@/features/testimonials/ui";
import { CHANNEL_LABELS, DEFAULT_DISCLOSURE, approvalBlockers, asAiReview, type Channel } from "../../../../../../../../../modules/testimonials/testimonials";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (children == null || children === "") return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-sm [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export default async function TestimonialPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug, id } = await params;
  const query = await searchParams;
  const access = await testimonialsPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, can } = access;
  const t = await getTestimonial(ctx.resolved.id, ctx.brand.id, id);
  if (!t) notFound();
  const profile = brandProfile(ctx.brand);
  const niche = profile.niche;
  const ai = asAiReview(t.aiFlags);
  const pending = approvalBlockers({ consentGiven: t.consentGiven, disclosure: t.disclosure ?? DEFAULT_DISCLOSURE[niche], flags: t.flags, acknowledged: false }, niche);
  const look = t.look;

  return (
    <div className="space-y-4">
      <Flash error={query.error} notice={query.notice} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/testimonials" className="inline-flex min-h-11 items-center text-accent hover:underline">
          ← All testimonials
        </Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="min-w-0 space-y-4 lg:col-span-3">
          <section className="space-y-3 rounded-xl border border-line bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={t.status} />
              <span className="text-xs text-muted">{t.source === "public-form" ? "Submitted on the public form" : "Entered by the team"}</span>
            </div>
            <h2 className="text-xl font-semibold [overflow-wrap:anywhere]">{t.displayName}</h2>
            <blockquote className="whitespace-pre-line border-l-4 border-accent/40 pl-3 text-[15px] leading-relaxed [overflow-wrap:anywhere]">&ldquo;{t.quote}&rdquo;</blockquote>
            {t.body && t.body !== t.quote ? <p className="whitespace-pre-line text-sm text-ink [overflow-wrap:anywhere]">{t.body}</p> : null}
            <dl className="grid gap-3 sm:grid-cols-2">
              <Row label="Result claimed">{t.resultClaimed}</Row>
              <Row label="Location">{t.location}</Row>
              <Row label="Date given">{t.givenOn}</Row>
              <Row label="Channel">{CHANNEL_LABELS[t.channel as Channel] ?? t.channel}</Row>
              <Row label="Rating">{t.rating ? `${t.rating} / 5` : null}</Row>
              <Row label="Tags">{t.tags.length ? t.tags.join(", ") : null}</Row>
              <Row label="Publication">
                {t.publication ? (
                  can.wiki ? (
                    <Link href={`/wiki/publications/${t.publication.slug}`} className="text-accent hover:underline">
                      {t.publication.name} (wiki)
                    </Link>
                  ) : (
                    t.publication.name
                  )
                ) : null}
              </Row>
              <Row label="Editor">
                {t.editor ? (
                  can.wiki ? (
                    <Link href={`/wiki/editors/${t.editor.slug}`} className="text-accent hover:underline">
                      {t.editor.name} (wiki)
                    </Link>
                  ) : (
                    t.editor.name
                  )
                ) : null}
              </Row>
              <Row label="Video">
                {t.videoUrl ? (
                  <a href={t.videoUrl} target="_blank" rel="noreferrer noopener" className="text-accent [overflow-wrap:anywhere] hover:underline">
                    {t.videoUrl}
                  </a>
                ) : null}
              </Row>
              <Row label="Contact (private)">{t.contactEmail}</Row>
            </dl>
            {t.files.length ? (
              <ul className="flex flex-wrap gap-3">
                {t.files.map((f) => (
                  <li key={f.id} className="w-36 space-y-1 text-xs">
                    <a href={`/testimonials/${t.id}/file/${f.id}`} target="_blank" rel="noreferrer">
                      <img src={`/testimonials/${t.id}/file/${f.id}`} alt={f.kind} className="h-28 w-36 rounded-md border border-line object-cover" />
                    </a>
                    <span className="flex items-center justify-between gap-1 text-muted">
                      {f.kind === "photo" ? "Photo" : "Screenshot"}
                      {can.write ? (
                        <form action={deleteFileAction}>
                          <input type="hidden" name="id" value={t.id} />
                          <input type="hidden" name="fileId" value={f.id} />
                          <button type="submit" className="min-h-9 px-1 text-[#b42318] hover:underline">
                            Remove
                          </button>
                        </form>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="space-y-2 rounded-xl border border-line bg-white p-4 sm:p-5">
            <h3 className="text-base font-semibold">Consent record</h3>
            {t.consentGiven ? (
              <dl className="space-y-2">
                <Row label="Given">{`${t.consentMethod === "public-form" ? "Ticked on the public form" : "Attested by staff"}${t.consentAt ? ` · ${t.consentAt.toISOString().replace("T", " ").slice(0, 16)} UTC` : ""}`}</Row>
                <Row label="Exact wording">{t.consentText}</Row>
              </dl>
            ) : (
              <p className="text-sm text-[#b42318]">No consent on record. It cannot be approved until the person gives permission.</p>
            )}
          </section>

          {can.write ? (
            <details className="rounded-xl border border-line bg-white p-4 sm:p-5">
              <summary className="cursor-pointer text-base font-semibold">Edit</summary>
              <form action={updateTestimonialAction} className="mt-4 space-y-4">
                <input type="hidden" name="id" value={t.id} />
                <TestimonialFields
                  values={t}
                  publications={look.publications.filter((p) => !p.archived || p.id === t.publicationId).map((p) => ({ id: p.id, name: p.name, code: p.code }))}
                  editors={look.editorList.filter((e) => !e.archived || e.id === t.editorId).map((e) => ({ id: e.id, name: e.name }))}
                  niche={niche}
                />
                {t.consentMethod !== "public-form" ? (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="recordConsent" value="yes" className="h-4 w-4" />
                      Update the consent record
                    </label>
                    <ConsentFields />
                  </div>
                ) : null}
                <p className="text-xs text-muted">Changing the quote, full text or result sends an approved testimonial back to review.</p>
                <Button type="submit">Save changes</Button>
              </form>
              <form action={deleteTestimonialAction} className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                <input type="hidden" name="id" value={t.id} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="confirm" value="yes" className="h-4 w-4" />
                  Delete this testimonial
                </label>
                <Button type="submit" variant="danger" size="sm">
                  Delete
                </Button>
              </form>
            </details>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-4 lg:col-span-2">
          <section className="space-y-3 rounded-xl border border-line bg-white p-4 sm:p-5">
            <h3 className="text-base font-semibold">Compliance review</h3>
            {t.reviewedAt || t.reviewReason ? (
              <p className="text-sm text-muted [overflow-wrap:anywhere]">
                {t.reviewedAt ? `${t.status === "approved" ? "Approved" : t.status === "rejected" ? "Rejected" : "Reviewed"} ${t.reviewedAt.toISOString().slice(0, 10)}${t.reviewer ? ` by ${t.reviewer}` : ""}. ` : ""}
                {t.reviewReason ? `Note: ${t.reviewReason}` : ""}
              </p>
            ) : null}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">{ctx.brand.name} rules · {NICHE_LABELS[niche]}</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">
                {profile.complianceRules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Flags from the rules</p>
              <FlagList flags={t.flags} />
            </div>
            <div className="rounded-md border border-line bg-canvas p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">AI pre-check</p>
                {can.write && t.aiStatus !== "running" ? (
                  <form action={aiCheckAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <button type="submit" className="min-h-9 text-xs font-medium text-accent hover:underline">
                      {t.aiStatus === "none" ? "Run" : "Run again"}
                    </button>
                  </form>
                ) : null}
              </div>
              {t.aiStatus === "running" ? (
                <p className="mt-1 text-sm text-muted">
                  Checking… <AutoRefresh />
                </p>
              ) : t.aiStatus === "done" && ai ? (
                <div className="mt-1 space-y-2 text-sm">
                  <p>{ai.summary}</p>
                  {ai.flags.length ? (
                    <ul className="space-y-1.5">
                      {ai.flags.map((f, i) => (
                        <li key={i} className="[overflow-wrap:anywhere]">
                          <span className="font-medium">“{f.phrase}”</span> <span className="text-muted">({f.rule})</span> {f.why}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="text-xs text-muted">AI suggestions only. A person decides.</p>
                </div>
              ) : t.aiStatus === "unavailable" || t.aiStatus === "failed" ? (
                <p className="mt-1 text-sm text-muted">{t.aiReason ?? "The AI check did not run."} The rule-based flags above still apply.</p>
              ) : (
                <p className="mt-1 text-sm text-muted">Not run yet.</p>
              )}
            </div>

            {can.approve ? (
              <form action={approveTestimonialAction} className="space-y-3 border-t border-line pt-3">
                <input type="hidden" name="id" value={t.id} />
                {pending.length ? (
                  <ul className="space-y-1 rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">
                    {pending.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="space-y-1.5">
                  <Label htmlFor="r-disclosure">Disclosure shown with it{niche === "health" ? " (required)" : ""}</Label>
                  <Textarea id="r-disclosure" name="disclosure" rows={2} maxLength={500} defaultValue={t.disclosure ?? DEFAULT_DISCLOSURE[niche]} />
                </div>
                {t.flags.length ? (
                  <label className="flex min-h-11 items-start gap-2 text-sm">
                    <input type="checkbox" name="acknowledged" value="yes" className="mt-1 h-4 w-4" />
                    <span>I checked every flagged claim{niche === "finance" ? " (gains and returns match the record)" : ""}.</span>
                  </label>
                ) : null}
                <div className="space-y-1.5">
                  <Label htmlFor="r-reason">Review note (required to reject)</Label>
                  <Textarea id="r-reason" name="reason" rows={2} maxLength={1000} defaultValue="" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" data-decision="approve">
                    Approve
                  </Button>
                  <Button type="submit" formAction={rejectTestimonialAction} data-decision="reject" variant="danger">
                    Reject
                  </Button>
                  {t.status !== "pending" ? (
                    <Button type="submit" formAction={reopenTestimonialAction} data-decision="reopen" variant="secondary">
                      Back to pending
                    </Button>
                  ) : null}
                </div>
              </form>
            ) : (
              <p className="border-t border-line pt-3 text-sm text-muted">Only reviewers with the approve permission can approve or reject.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
