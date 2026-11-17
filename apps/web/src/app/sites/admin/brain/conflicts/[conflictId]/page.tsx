import { aiConfigured } from "@pubcommand/ai";
import { rawPrisma } from "@pubcommand/db";
import { Badge, Button, Input, Label, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import {
  applyRewrite,
  discardRewrite,
  dismissConflict,
  editPassage,
  markSetupToFix,
  reopenConflict,
  suggestRewrite,
  supersedeNote,
} from "@/features/brain-conflicts/actions";
import { noteFlag } from "@/features/brain-conflicts/flags";
import { setupAdmins, setupUrl } from "@/features/brain-conflicts/links";
import { ConflictStatusBadge, kindLabel, LayerBadge, placeText, resolutionText } from "@/features/brain-conflicts/parts";
import { getConflict } from "@/features/brain-conflicts/queries";
import { getMainNote, provenanceNames } from "@/features/main-brain/notes";
import { brainStaff } from "@/features/main-brain/staff";
import { AutoRefresh } from "@/features/promos/auto-refresh";
import { startImpersonation } from "@/server/platform-actions";
import { factLabel, locateQuote, noteHash, suggestPassageFix } from "../../../../../../../../../modules/knowledge/conflicts";

type Suggestion = { status: string; body?: string; summary?: string; reason?: string; baseHash?: string; at?: string } | null;

function Panel({ title, children, tone }: { title: string; children: React.ReactNode; tone?: "warn" }) {
  return (
    <section className={`rounded-xl border bg-white p-4 ${tone === "warn" ? "border-[#fedf89]" : "border-line"}`}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-2 space-y-3 text-sm">{children}</div>
    </section>
  );
}

export default async function ConflictPage({ params, searchParams }: { params: Promise<{ conflictId: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { conflictId } = await params;
  const query = await searchParams;
  const staff = await brainStaff();
  if (!staff) return <Denied />;
  const row = await getConflict(conflictId);
  if (!row) notFound();
  const org = await rawPrisma().organization.findUnique({ where: { id: row.entityOrganizationId }, select: { slug: true, name: true } });
  const [note, flag, names, setup, admins, resolver] = await Promise.all([
    getMainNote(row.noteId),
    noteFlag(row.noteId),
    provenanceNames(),
    org ? setupUrl({ organizationSlug: org.slug, kind: row.entityKind, id: row.entityId }) : Promise.resolve(null),
    setupAdmins(row.entityOrganizationId, staff.role),
    row.resolvedById ? rawPrisma().user.findUnique({ where: { id: row.resolvedById }, select: { email: true } }) : Promise.resolve(null),
  ]);
  const suggestion = (row.suggestion ?? null) as Suggestion;
  const stale = note ? noteHash(note.body) !== row.noteHash : true;
  const where = note ? locateQuote(note.body, row.quote) : null;
  const context = note && where ? { before: note.body.slice(Math.max(0, where.start - 220), where.start), quote: note.body.slice(where.start, where.end), after: note.body.slice(where.end, where.end + 220) } : null;
  const open = row.status === "OPEN";
  const ai = aiConfigured();
  const setupPath = row.entityKind === "editor" ? `/publication-setup/editors/${row.entityId}` : `/publication-setup/publications/${row.entityId}`;
  const brandName = names.brands.get(row.entityBrandId)?.name ?? "the brand";

  return (
    <div className="max-w-5xl">
      <Link href="/brain/conflicts" className="inline-flex min-h-11 items-center text-sm text-muted hover:text-ink">
        ← Conflicts
      </Link>
      <Flash error={query.error} notice={query.notice} />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight">{factLabel(row.factKey)}</h1>
        <ConflictStatusBadge status={row.status} resolution={row.resolution} />
        <LayerBadge layer={row.layer} confidence={row.confidence} />
      </div>
      <p className="mt-1 break-words text-sm text-muted">
        <Link href={`/brain/conflicts/entity/${row.entityKind}/${row.entityId}`} className="font-semibold text-accent hover:underline">
          {row.check.entityName}
          {row.check.entityCode ? ` (${row.check.entityCode})` : ""}
        </Link>{" "}
        · {kindLabel(row.entityKind)} · {placeText(names, row.entityOrganizationId, row.entityBrandId)} · found {row.firstSeenAt.toISOString().slice(0, 10)}, last seen {row.lastSeenAt.toISOString().slice(0, 10)}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-xl border border-[#abefc6] bg-[#ecfdf3] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#067647]">Publication Setup (source of truth)</p>
          <p className="mt-1 whitespace-pre-line break-words text-sm">{row.factValue}</p>
        </div>
        <div className="min-w-0 rounded-xl border border-[#fecdca] bg-[#fef3f2] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#b42318]">The main Brain says</p>
          <p className="mt-1 break-words text-sm">{row.noteSays}</p>
          <p className="mt-2 break-words text-xs text-muted">
            In{" "}
            <Link href={`/brain/${row.noteId}`} className="font-semibold text-accent hover:underline">
              {note?.title ?? row.noteTitle}
            </Link>
            {flag ? " · marked outdated" : ""}
          </p>
        </div>
      </div>

      <section className="mt-3 rounded-xl border border-line bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">The passage</p>
        {context ? (
          <p className="mt-1 whitespace-pre-line break-words text-sm text-muted">
            {where && where.start > 220 ? "…" : ""}
            {context.before}
            <mark className="rounded bg-[#fef0c7] px-0.5 text-ink">{context.quote}</mark>
            {context.after}
            {note && where && where.end + 220 < note.body.length ? "…" : ""}
          </p>
        ) : (
          <p className="mt-1 break-words text-sm">“{row.quote}”</p>
        )}
        {stale && note ? <p className="mt-2 text-xs text-[#93370d]">The note changed since this was found. Re-check the entity to refresh.</p> : null}
        {!note ? <p className="mt-2 text-xs text-[#93370d]">The note was deleted.</p> : null}
      </section>

      {!open || row.resolution ? (
        <section className="mt-3 rounded-xl border border-line bg-white p-4 text-sm">
          <p>
            <strong>{resolutionText(row.resolution) ?? row.status}</strong>
            {row.resolvedAt ? ` · ${row.resolvedAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}
            {resolver ? ` · ${resolver.email}` : row.resolution === "cleared" ? " · by the re-check" : ""}
          </p>
          {row.reason ? <p className="mt-1 break-words text-muted">{row.reason}</p> : null}
          {!open ? (
            <form action={reopenConflict} className="mt-2">
              <input type="hidden" name="conflictId" value={row.id} />
              <Button type="submit" variant="secondary">
                Reopen
              </Button>
            </form>
          ) : null}
        </section>
      ) : null}

      {open ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <Panel title="1. Correct the note">
            {note && context ? (
              <form action={editPassage} className="space-y-2">
                <input type="hidden" name="conflictId" value={row.id} />
                <Label htmlFor="passage">Corrected passage (replaces only the highlighted text)</Label>
                <Textarea id="passage" name="passage" rows={4} defaultValue={suggestPassageFix(context.quote, row.noteValue, row.suggestedValue)} />
                <Button type="submit" className="w-full sm:w-auto">
                  Save corrected passage
                </Button>
              </form>
            ) : (
              <p className="text-muted">The passage is no longer in the note. Edit the note itself, or re-check.</p>
            )}
            <div className="border-t border-line pt-3">
              <p className="font-semibold">Or rewrite the whole note with the correct fact</p>
              {!suggestion ? (
                <>
                  <p className="text-xs text-muted">The AI suggests a rewrite; nothing is saved until you review and confirm it.</p>
                  <form action={suggestRewrite} className="mt-2">
                    <input type="hidden" name="conflictId" value={row.id} />
                    <Button type="submit" variant="secondary" disabled={!note || !ai}>
                      Suggest a rewrite
                    </Button>
                  </form>
                  {!ai ? <p className="mt-1 text-xs text-[#93370d]">The AI key is not set, so rewrites are off. Correct the passage above instead.</p> : null}
                </>
              ) : suggestion.status === "running" ? (
                <p className="flex items-center gap-2 text-muted">
                  Writing a suggestion… <AutoRefresh />
                </p>
              ) : suggestion.status === "ok" && suggestion.body ? (
                <form action={applyRewrite} className="mt-2 space-y-2">
                  <input type="hidden" name="conflictId" value={row.id} />
                  {suggestion.summary ? <p className="text-xs text-muted">AI: {suggestion.summary}</p> : null}
                  {suggestion.baseHash !== (note ? noteHash(note.body) : "") ? <p className="text-xs text-[#93370d]">The note changed since this suggestion. Discard it and ask again.</p> : null}
                  <Label htmlFor="rewrite">Suggested note (edit before saving)</Label>
                  <Textarea id="rewrite" name="body" rows={12} defaultValue={suggestion.body} />
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit">Save rewritten note</Button>
                    <Button type="submit" variant="secondary" formAction={discardRewrite}>
                      Discard
                    </Button>
                  </div>
                </form>
              ) : (
                <form action={discardRewrite} className="mt-2 space-y-2">
                  <input type="hidden" name="conflictId" value={row.id} />
                  <p className="text-[#93370d]">No suggestion: {suggestion.reason ?? "the AI did not answer."}</p>
                  <Button type="submit" variant="secondary">
                    Clear
                  </Button>
                </form>
              )}
            </div>
          </Panel>

          <Panel title="2. Mark the note outdated">
            <p className="text-muted">Keeps the note, flags it as superseded and stops Ask from using it. Every open conflict from this note closes. You can restore it from the note page.</p>
            <form action={supersedeNote} className="space-y-2">
              <input type="hidden" name="conflictId" value={row.id} />
              <Label htmlFor="sup-reason">Reason (optional)</Label>
              <Input id="sup-reason" name="reason" placeholder={`Superseded by Publication Setup (${factLabel(row.factKey)})`} />
              <Button type="submit" variant="secondary" disabled={!note || Boolean(flag)}>
                {flag ? "Already marked outdated" : "Mark outdated"}
              </Button>
            </form>
          </Panel>

          <Panel title="3. Not a conflict">
            <p className="text-muted">Dismissed conflicts are not raised again unless the fact or the note changes.</p>
            <form action={dismissConflict} className="space-y-2">
              <input type="hidden" name="conflictId" value={row.id} />
              <Label htmlFor="dis-reason">Why is this not a conflict?</Label>
              <Input id="dis-reason" name="reason" required placeholder="e.g. The note is about the 2019 trial edition" />
              <Button type="submit" variant="secondary">
                Dismiss
              </Button>
            </form>
          </Panel>

          <Panel title="4. The Brain is right: Publication Setup is wrong" tone="warn">
            <p className="text-muted">
              Facts belong to {org?.name ?? "the organization"} and are changed only in its Publication Setup, never from here. Open it on the organization&apos;s site (brand: {brandName}). If you are not a member, impersonate one of its admins first: you land on their dashboard, then open <span className="break-all font-mono text-xs">{setupPath}</span>.
            </p>
            {setup ? (
              <a href={setup} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 font-semibold hover:bg-canvas">
                Open in Publication Setup ↗
              </a>
            ) : null}
            {admins && admins.length ? (
              <form action={startImpersonation} className="pc-form-row">
                <input type="hidden" name="organizationId" value={row.entityOrganizationId} />
                <select name="email" className="pc-control sm:flex-1" aria-label="Member to impersonate" defaultValue={admins[0]!.email}>
                  {admins.map((admin) => (
                    <option key={admin.email} value={admin.email}>
                      {admin.name ? `${admin.name} · ` : ""}
                      {admin.email} ({admin.role})
                    </option>
                  ))}
                </select>
                <Button type="submit" variant="secondary">
                  Impersonate
                </Button>
              </form>
            ) : admins === null ? (
              <p className="text-xs text-muted">Impersonation needs the platform.orgs.impersonate permission.</p>
            ) : null}
            <form action={markSetupToFix} className="space-y-2 border-t border-line pt-3">
              <input type="hidden" name="conflictId" value={row.id} />
              <Label htmlFor="setup-reason">Note for the record (optional)</Label>
              <Input id="setup-reason" name="reason" defaultValue={row.resolution === "setup-to-fix" ? (row.reason ?? "") : ""} placeholder="e.g. Price went up in October; Setup not updated" />
              <Button type="submit" variant="secondary">
                {row.resolution === "setup-to-fix" ? "Update note" : "Mark: Setup needs fixing"}
              </Button>
              <p className="text-xs text-muted">It stays open as “Waiting on Setup” and closes by itself once the fact changes and the entity is re-checked.</p>
            </form>
          </Panel>
        </div>
      ) : null}
      {open ? (
        <p className="mt-4 text-xs text-muted">
          <Badge tone="neutral">{row.layer === "ai" ? "Found by the AI check" : `Found by the ${row.rule ?? ""} rule`}</Badge> Publication Setup is the source of truth; the console never edits organization data.
        </p>
      ) : null}
    </div>
  );
}
