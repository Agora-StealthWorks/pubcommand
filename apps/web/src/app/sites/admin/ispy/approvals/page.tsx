import { Flash } from "@/components/ui";
import { LIST_CATEGORIES, LIST_CATEGORY_LABELS, parseConditions } from "../../../../../../../../modules/ispy/index";
import { approveCandidateAction, assignCandidatePublisher, mergeCandidateAction, rejectCandidateAction } from "@/features/ispy/console-actions";
import { Back, btn, btnDanger, btnPrimary, btnSm, card, ConditionRows, day, input, label, Pill, statusTone } from "@/features/ispy/console-ui";
import { ispyDb } from "@/features/ispy/db";

export const metadata = { title: "ISpy · New lists" };

/** Lists ISpy found but never creates on its own: staff approve, merge or reject. */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ show?: string; error?: string; notice?: string }> }) {
  const query = await searchParams;
  const showDecided = query.show === "decided";
  const data = await ispyDb(async (tx) => {
    const candidates = await tx.ispyListCandidate.findMany({ where: showDecided ? { status: { not: "PENDING" } } : { status: "PENDING" }, orderBy: showDecided ? { decidedAt: "desc" } : [{ emailCount: "desc" }, { createdAt: "asc" }], take: 100 });
    const sampleIds = candidates.flatMap((c) => c.sampleEmailIds.slice(0, 3));
    const [samples, publishers, publications, lists] = await Promise.all([
      tx.ispyEmail.findMany({ where: { id: { in: sampleIds } }, select: { id: true, subject: true, receivedAt: true, fromAddress: true } }),
      tx.ispyPublisher.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      tx.ispyPublication.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, publisherId: true } }),
      tx.ispyList.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, publisherId: true } }),
    ]);
    return { candidates, samples, publishers, publications, lists };
  });
  const back = `/ispy/approvals${showDecided ? "?show=decided" : ""}`;
  const pubName = new Map(data.publishers.map((p) => [p.id, p.name]));
  const publicationName = new Map(data.publications.map((p) => [p.id, p.name]));
  const sample = new Map(data.samples.map((s) => [s.id, s]));

  return (
    <div className="flex flex-col gap-4">
      <Flash error={query.error} notice={query.notice} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">New lists to approve</h2>
          <p className="max-w-3xl text-sm text-muted">ISpy never creates a list on its own. Approving creates the list (with the type you pick), its routing rule and its own inbox, then moves the waiting mail.</p>
        </div>
        <a className={btnSm} href={showDecided ? "/ispy/approvals" : "/ispy/approvals?show=decided"}>
          {showDecided ? "Show pending" : "Show decided"}
        </a>
      </div>
      {data.candidates.length === 0 ? <p className={`${card} p-6 text-sm text-muted`}>{showDecided ? "Nothing decided yet." : "No new lists waiting. Unknown mail that doesn't look like a list stays in Inboxes → Unsorted."}</p> : null}
      {data.candidates.map((c) => {
        const signals = Array.isArray(c.signals) ? (c.signals as unknown[]).map(String) : [];
        const rule = parseConditions(c.proposedRule);
        const lists = data.lists.filter((l) => !c.publisherId || l.publisherId === c.publisherId);
        return (
          <section key={c.id} className={`${card} flex flex-col gap-3 p-4`}>
            <div className="flex flex-wrap items-baseline gap-2">
              <strong className="text-base">“{c.proposedName}”</strong>
              <span className="text-sm text-muted">
                under {c.publisherId ? pubName.get(c.publisherId) ?? "?" : "no publisher"}
                {c.publicationId ? ` · ${publicationName.get(c.publicationId) ?? ""}` : ""} · {c.emailCount} email(s) · first seen {day(c.createdAt)}
              </span>
              {c.status !== "PENDING" ? <span className="ml-auto"><Pill tone={statusTone(c.status)}>{c.status.toLowerCase()} {day(c.decidedAt)}</Pill></span> : null}
            </div>
            {signals.length ? (
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="text-muted">Signals:</span>
                {signals.map((s) => (
                  <code key={s} className="pc-break rounded bg-[#f2f4f7] px-1.5 text-xs">{s}</code>
                ))}
              </div>
            ) : null}
            <ul className="text-sm text-muted">
              {c.sampleEmailIds.slice(0, 3).map((id) => {
                const s = sample.get(id);
                return s ? (
                  <li key={id}>
                    {day(s.receivedAt)} · “{s.subject}” · {s.fromAddress}
                  </li>
                ) : null;
              })}
            </ul>
            {c.status === "PENDING" ? (
              <>
                {!c.publisherId ? (
                  <form action={assignCandidatePublisher} className="pc-form-row rounded-md border border-[#fedf89] bg-[#fffaeb] p-3">
                    <Back to={back} />
                    <input type="hidden" name="candidateId" value={c.id} />
                    <span className="text-sm">Assign a publisher before approving:</span>
                    <select name="publisherId" className="pc-control" aria-label="Publisher" required defaultValue="">
                      <option value="" disabled>Publisher…</option>
                      {data.publishers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button className={btnSm} type="submit">Set publisher</button>
                  </form>
                ) : null}
                <form action={approveCandidateAction} className="flex flex-col gap-3 rounded-md border border-line bg-[#fafbfc] p-3">
                  <Back to={back} />
                  <input type="hidden" name="candidateId" value={c.id} />
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <label className={label}>
                      List name
                      <input name="name" defaultValue={c.proposedName} required className={input} />
                    </label>
                    <label className={label}>
                      List type
                      <select name="category" defaultValue={c.proposedType} className={input}>
                        {LIST_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {LIST_CATEGORY_LABELS[cat]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="inline-flex min-h-11 items-center gap-2 self-end text-sm">
                      <input type="checkbox" name="createInbox" defaultChecked /> Create its own inbox
                    </label>
                  </div>
                  <ConditionRows conditions={rule} />
                  <div className="flex flex-wrap gap-2">
                    <button className={btnPrimary} type="submit" disabled={!c.publisherId}>
                      Approve → create list{c.emailCount ? `, move ${c.emailCount}` : ""}
                    </button>
                  </div>
                </form>
                <div className="flex flex-wrap items-end gap-3">
                  <form action={mergeCandidateAction} className="flex flex-wrap items-end gap-2">
                    <Back to={back} />
                    <input type="hidden" name="candidateId" value={c.id} />
                    {rule.map((r, i) => (
                      <span key={i}>
                        <input type="hidden" name={`cond_field_${i}`} value={r.field} />
                        <input type="hidden" name={`cond_op_${i}`} value={r.op} />
                        <input type="hidden" name={`cond_value_${i}`} value={r.header ? `${r.header}: ${r.value}` : r.value} />
                      </span>
                    ))}
                    <label className={label}>
                      Merge into existing list (adds a synonym and the rule)
                      <select name="listId" className="pc-control" required defaultValue="">
                        <option value="" disabled>List…</option>
                        {lists.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className={btn} type="submit">Merge</button>
                  </form>
                  <form action={rejectCandidateAction}>
                    <Back to={back} />
                    <input type="hidden" name="candidateId" value={c.id} />
                    <button className={btnDanger} type="submit">Reject</button>
                  </form>
                </div>
              </>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
