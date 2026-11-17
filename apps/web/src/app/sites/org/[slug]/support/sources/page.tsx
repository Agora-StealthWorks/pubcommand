import { tenantDb } from "@pubcommand/db";
import { Button, Input, Label, Textarea } from "@pubcommand/ui";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { approveProposalAction, importCsvAction, ingestKeyAction, proposeBrainAction, rejectProposalAction, sheetAction, syncPubsetupAction } from "@/features/support/actions";
import { brainCandidates } from "@/features/support/brain";
import { SecretButton } from "@/features/support/client";
import { ensureSettings, fmtDate } from "@/features/support/data";
import { supportPage } from "@/features/support/guard";
import { Empty, Section, ruleLabel } from "@/features/support/ui";
import { currentRequest } from "@/lib/request";
import { checkContent } from "../../../../../../../../../modules/support/gate";
import { CATEGORIES, RECORD_CATEGORIES } from "../../../../../../../../../modules/support/taxonomy";

function summary(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const v = value as Record<string, unknown>;
  if (typeof v.error === "string") return `Failed: ${v.error}`;
  return Object.entries(v)
    .filter(([, n]) => typeof n === "number")
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
}

export default async function SupportSourcesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string; brainq?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await supportPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx } = access;
  const db = tenantDb(ctx.resolved.id);
  const settings = await ensureSettings(ctx.resolved.id, ctx.brand.id);
  const brainEntitled = ctx.subject.entitledModuleIds.includes("knowledge");
  const [pubCount, siteCount, proposals, candidates] = await Promise.all([
    db.supportRecord.count({ where: { brandId: ctx.brand.id, source: "pubsetup" } }),
    db.supportRecord.count({ where: { brandId: ctx.brand.id, source: "website", status: { not: "archived" } } }),
    db.supportProposal.findMany({ where: { brandId: ctx.brand.id, status: "pending" }, orderBy: { createdAt: "desc" }, take: 30 }),
    ctx.canWrite && brainEntitled ? brainCandidates(ctx.resolved.id, ctx.brand.id, query.brainq ?? "") : Promise.resolve([]),
  ]);
  const proposedRefs = new Set(proposals.map((p) => p.sourceRef));
  const { origin } = await currentRequest();

  return (
    <div className="space-y-4">
      <Flash error={query.error} notice={query.notice} />

      <Section title="Publication Setup" description="Each publication and editor becomes a public record (public-safe fields only: no positioning, voice, compliance notes or internal email). Offers become a price record that stays a draft until a publisher confirms it.">
        <p className="text-sm text-muted">
          {pubCount} record{pubCount === 1 ? "" : "s"} from Publication Setup.{" "}
          {settings.lastPubsetupAt ? `Last sync ${fmtDate(settings.lastPubsetupAt)}: ${summary(settings.lastPubsetupResult)}.` : "Never synced."}
        </p>
        {ctx.canPublish ? (
          <form action={syncPubsetupAction} className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="pubsetupSync" defaultChecked={settings.pubsetupSync} /> Sync every hour
            </label>
            <Button type="submit" name="intent" value="run">
              Sync now
            </Button>
            <Button type="submit" name="intent" value="save" variant="secondary">
              Save setting
            </Button>
          </form>
        ) : null}
      </Section>

      <Section id="website" title="Website directory" description="Every post, article and report on the website, so agents can point to it. Only an access level that clearly says free is public; blank or unclear means members only. Pages edited here are locked and imports skip them.">
        <p className="text-sm text-muted">
          {siteCount} page{siteCount === 1 ? "" : "s"} in the directory.
          {settings.lastSheetSyncAt ? ` Last sheet import ${fmtDate(settings.lastSheetSyncAt)}: ${summary(settings.lastSheetResult)}.` : ""}
        </p>
        {ctx.canPublish ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <form action={importCsvAction} className="min-w-0 space-y-2">
              <Label htmlFor="csv">Upload a CSV</Label>
              <input id="csv" name="csv" type="file" accept=".csv,text/csv" className="block w-full min-w-0 text-sm" required />
              <p className="text-xs text-muted">Headers: Title, URL, Date, Author, Product, Access level, Categories, Tags, Status, Summary.</p>
              <Button type="submit" variant="secondary">
                Import CSV
              </Button>
            </form>
            <form action={sheetAction} className="min-w-0 space-y-2">
              <Label htmlFor="sheetUrl">Google Sheet link</Label>
              <Input id="sheetUrl" name="sheetUrl" defaultValue={settings.siteSheetUrl ?? ""} placeholder="https://docs.google.com/spreadsheets/d/…" inputMode="url" />
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="siteSheetSync" defaultChecked={settings.siteSheetSync} /> Re-import every hour
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" name="intent" value="run">
                  Import now
                </Button>
                <Button type="submit" name="intent" value="save" variant="secondary">
                  Save link
                </Button>
              </div>
            </form>
          </div>
        ) : null}
        <div className="mt-5 min-w-0 rounded-lg border border-line bg-canvas p-3 text-sm">
          <p className="font-semibold">WordPress or site ingest</p>
          <p className="mt-1 text-muted">
            POST pages as JSON to <code className="break-all">{origin}/api/v1/support/ingest/site-pages</code> with <code>Authorization: Bearer psi_…</code>. The key can only add pages; it reads nothing.
            {settings.ingestKeyPrefix ? ` Current key starts ${settings.ingestKeyPrefix}…` : " No key yet."}
          </p>
          {ctx.canPublish ? (
            <div className="mt-3">
              <SecretButton action={ingestKeyAction} label={settings.ingestKeyPrefix ? "Replace ingest key" : "Make ingest key"} confirm={settings.ingestKeyPrefix ? "The old key stops working at once. Continue?" : undefined} />
            </div>
          ) : null}
        </div>
      </Section>

      <Section id="brain" title="Brand Brain" description={`Copy a note from ${ctx.brand.name}'s Brain. The Brain is internal, so a note becomes a proposal: the content gate checks it and a publisher approves the final wording.`}>
        {!brainEntitled ? (
          <p className="text-sm text-muted">The Brain is not in this organization&apos;s plan.</p>
        ) : ctx.canWrite ? (
          <>
            <form className="flex min-w-0 flex-wrap gap-2" role="search">
              <Input name="brainq" defaultValue={query.brainq ?? ""} placeholder="Search Brain notes" aria-label="Search Brain notes" className="min-w-0 flex-1" />
              <Button type="submit" variant="secondary">
                Search
              </Button>
            </form>
            {candidates.length ? (
              <ul className="mt-3 divide-y divide-line">
                {candidates.map((note) => (
                  <li key={note.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium [overflow-wrap:anywhere]">{note.title}</span>
                      <span className="block text-xs text-muted [overflow-wrap:anywhere]">{note.snippet || note.folder || "No folder"}</span>
                    </span>
                    {proposedRefs.has(`brain:${note.id}`) ? (
                      <span className="text-xs text-muted">In review</span>
                    ) : (
                      <form action={proposeBrainAction}>
                        <input type="hidden" name="noteId" value={note.id} />
                        <Button type="submit" variant="secondary" size="sm">
                          Propose
                        </Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted">{query.brainq ? "No notes match." : "No notes in this brand's Brain yet."}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">Writers can propose Brain notes.</p>
        )}
      </Section>

      <Section id="review" title={`Review queue · ${proposals.length}`} description="Brain notes waiting for approval, and edits someone made directly in ElevenLabs.">
        {proposals.length ? (
          <ul className="space-y-4">
            {proposals.map((p) => {
              const gate = checkContent(`${p.title}\n${p.text}`);
              return (
                <li key={p.id} className="min-w-0 rounded-lg border border-line p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">{p.kind === "brain-note" ? "From the Brain" : "Edited in ElevenLabs"} · {fmtDate(p.createdAt)}</p>
                  {gate.hits.length ? (
                    <p className="mt-1 text-sm text-[#b42318]">Gate: {gate.hits.map((h) => `${ruleLabel(h.id)} (“${h.match}”)`).join("; ")}</p>
                  ) : (
                    <p className="mt-1 text-sm text-[#067647]">Gate: nothing internal found.</p>
                  )}
                  {p.kind === "brain-note" && ctx.canPublish ? (
                    <form action={approveProposalAction} className="mt-3 space-y-3">
                      <input type="hidden" name="proposalId" value={p.id} />
                      <Input name="title" defaultValue={p.title} aria-label="Title" maxLength={300} />
                      <Textarea name="body" defaultValue={p.text} rows={8} aria-label="Text" />
                      <div className="grid gap-2 sm:grid-cols-3">
                        <select name="category" className="pc-control w-full" defaultValue="faqs" aria-label="Category">
                          {RECORD_CATEGORIES.map((key) => (
                            <option key={key} value={key}>
                              {CATEGORIES[key].label}
                            </option>
                          ))}
                        </select>
                        <select name="audience" className="pc-control w-full" defaultValue="member" aria-label="Audience">
                          <option value="public">Public</option>
                          <option value="member">Members only</option>
                        </select>
                        <select name="status" className="pc-control w-full" defaultValue="draft" aria-label="Status">
                          <option value="draft">Copy as draft</option>
                          <option value="published">Copy and publish</option>
                        </select>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit">Approve copy</Button>
                        <Button type="submit" variant="secondary" formAction={rejectProposalAction}>
                          Do not copy
                        </Button>
                      </div>
                    </form>
                  ) : p.kind === "platform-edit" && ctx.canPublish ? (
                    <div className="mt-2 space-y-2">
                      <p className="font-medium [overflow-wrap:anywhere]">{p.title}</p>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-canvas p-2 text-xs">{p.text.slice(0, 6000)}</pre>
                      <p className="text-sm text-muted">Copy anything worth keeping into a record here first. Either choice sends this app&apos;s version again on the next push.</p>
                      <form action={rejectProposalAction} className="flex flex-wrap gap-2">
                        <input type="hidden" name="proposalId" value={p.id} />
                        <Button type="submit" name="decision" value="approved" variant="secondary">
                          I copied the change
                        </Button>
                        <Button type="submit" name="decision" value="rejected" variant="secondary">
                          Discard the edit
                        </Button>
                      </form>
                    </div>
                  ) : (
                    <p className="mt-2 font-medium [overflow-wrap:anywhere]">{p.title}</p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>Nothing waiting for review.</Empty>
        )}
      </Section>
    </div>
  );
}
