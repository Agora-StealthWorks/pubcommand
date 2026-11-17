import { tenantDb } from "@pubcommand/db";
import { Button, Label, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { gapStatusAction, pasteGapsAction } from "@/features/support/actions";
import { fmtDate } from "@/features/support/data";
import { supportPage } from "@/features/support/guard";
import { Empty, Section } from "@/features/support/ui";

const TABS = [
  ["open", "Open"],
  ["resolved", "Answered"],
  ["dismissed", "Dismissed"],
] as const;

export default async function SupportGapsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string; show?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await supportPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx } = access;
  const show = TABS.some(([key]) => key === query.show) ? (query.show as (typeof TABS)[number][0]) : "open";
  const db = tenantDb(ctx.resolved.id);
  const [gaps, profiles, counts] = await Promise.all([
    db.supportGap.findMany({ where: { brandId: ctx.brand.id, status: show }, orderBy: [{ count: "desc" }, { lastSeenAt: "desc" }], take: 200 }),
    db.supportAgentProfile.findMany({ where: { brandId: ctx.brand.id, deletedAt: null }, select: { id: true, name: true } }),
    Promise.all(TABS.map(([key]) => db.supportGap.count({ where: { brandId: ctx.brand.id, status: key } }))),
  ]);
  const agentName = new Map(profiles.map((p) => [p.id, p.name]));

  return (
    <div className="space-y-4">
      <Flash error={query.error} notice={query.notice} />
      <div className="flex gap-1 overflow-x-auto text-sm">
        {TABS.map(([key, label], i) => (
          <Link key={key} href={`/support/gaps?show=${key}`} className={`inline-flex min-h-11 shrink-0 items-center rounded-md px-3 font-medium ${show === key ? "bg-white text-ink shadow-sm" : "text-muted hover:bg-white"}`}>
            {label} · {counts[i]}
          </Link>
        ))}
      </div>

      {gaps.length ? (
        <ul className="space-y-2">
          {gaps.map((gap) => (
            <li key={gap.id} className="min-w-0 rounded-xl border border-line bg-white p-4">
              <p className="font-medium [overflow-wrap:anywhere]">“{gap.question}”</p>
              <p className="mt-1 text-xs text-muted">
                Asked {gap.count} time{gap.count === 1 ? "" : "s"} · last {fmtDate(gap.lastSeenAt)} · {gap.source === "webhook" ? `from ${gap.profileId ? (agentName.get(gap.profileId) ?? "an agent") : "an agent"}` : "added by hand"} · {gap.reason}
              </p>
              {ctx.canWrite ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {gap.status === "open" ? (
                    <Link href={`/support/records/new?gap=${gap.id}`} className="inline-flex min-h-11 items-center rounded-md bg-accent px-3 text-sm font-semibold text-white">
                      Write the answer
                    </Link>
                  ) : null}
                  {gap.recordId ? (
                    <Link href={`/support/records/${gap.recordId}`} className="inline-flex min-h-11 items-center rounded-md border border-line px-3 text-sm font-semibold">
                      Open record
                    </Link>
                  ) : null}
                  <form action={gapStatusAction} className="flex flex-wrap gap-2">
                    <input type="hidden" name="gapId" value={gap.id} />
                    {gap.status === "open" ? (
                      <>
                        <Button type="submit" name="to" value="resolved" variant="secondary">
                          Already answered
                        </Button>
                        <Button type="submit" name="to" value="dismissed" variant="ghost">
                          Dismiss
                        </Button>
                      </>
                    ) : (
                      <Button type="submit" name="to" value="open" variant="secondary">
                        Reopen
                      </Button>
                    )}
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{show === "open" ? "No open gaps. Questions agents could not answer show up here." : "Nothing here."}</Empty>
      )}

      {ctx.canWrite ? (
        <Section title="Add gaps by hand" description="Paste questions, one per line, or a transcript with Customer: lines. Each agent page also has a post-call webhook that records gaps automatically.">
          <form action={pasteGapsAction} className="space-y-3">
            <div>
              <Label htmlFor="g-text">Questions</Label>
              <Textarea id="g-text" name="text" rows={5} required placeholder={"Customer: Can I pause my membership while I travel?\nCustomer: Where do I find last week's issue?"} />
            </div>
            <div className="max-w-xs">
              <Label htmlFor="g-agent">Agent (optional)</Label>
              <select id="g-agent" name="profileId" className="pc-control w-full" defaultValue="">
                <option value="">Not sure</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit">Add to queue</Button>
          </form>
        </Section>
      ) : null}
    </div>
  );
}
