import Link from "next/link";
import { Flash } from "@/components/ui";
import { describeConditions, FEED_LABELS, INBOX_LEVEL_LABELS, parseConditions, type Feed, type InboxLevel } from "../../../../../../../../modules/ispy/index";
import { previewRuleOnRecent } from "@/features/ispy/admin";
import { assignEmailList, connectGmail, deleteRule, rerouteAction, saveRule, setInboxStatus, syncGmailNow, toggleRule } from "@/features/ispy/console-actions";
import { readConditionRows } from "@/features/ispy/console-form";
import { ago, Back, btn, btnDanger, btnPrimary, btnSm, card, ConditionRows, day, EmptyRow, input, label, Pill, SortTh, sortRows, statusTone, td, th } from "@/features/ispy/console-ui";
import { ispyDb } from "@/features/ispy/db";
import { gmailEnv } from "@/features/intel/gmail";
import { machineMailConfig } from "@/features/ispy/providers/machinemail";

export const metadata = { title: "ISpy · Inboxes & routing" };

type Query = Record<string, string | undefined>;

export default async function InboxesPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const publicationId = query.publication ?? null;
  const publisherIdParam = query.publisher ?? null;
  const data = await ispyDb(async (tx) => {
    const publication = publicationId ? await tx.ispyPublication.findUnique({ where: { id: publicationId }, select: { id: true, name: true, publisherId: true } }) : null;
    const publisherId = publication?.publisherId ?? publisherIdParam;
    const [inboxes, publishers, publications, lists, rules, unsorted] = await Promise.all([
      tx.ispyInbox.findMany({
        where: publication ? { OR: [{ publicationId: publication.id }, { publisherId: publication.publisherId, level: "PUBLISHER_CATCHALL" }, { list: { publicationId: publication.id } }] } : publisherId ? { OR: [{ publisherId }, { list: { publisherId } }] } : {},
        select: { id: true, address: true, level: true, provider: true, status: true, feed: true, affiliateSeed: true, lastMessageAt: true, lastSyncAt: true, lastSyncError: true, refreshTokenEnc: true, list: { select: { name: true } }, publication: { select: { name: true } }, publisher: { select: { name: true } } },
        take: 500,
      }),
      tx.ispyPublisher.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, feed: true } }),
      tx.ispyPublication.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, publisherId: true } }),
      tx.ispyList.findMany({ where: { deletedAt: null, ...(publisherId ? { publisherId } : {}) }, orderBy: { name: "asc" }, select: { id: true, name: true, publisherId: true, publicationId: true } }),
      tx.ispyRoutingRule.findMany({
        where: publication ? { OR: [{ publicationId: publication.id }, { publisherId: publication.publisherId, publicationId: null }] } : publisherId ? { publisherId } : {},
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        take: 300,
      }),
      tx.ispyEmail.findMany({
        where: { routeStatus: { in: ["UNSORTED", "CANDIDATE"] }, ...(publication ? { OR: [{ publicationId: publication.id }, { receivedInbox: { publicationId: publication.id } }] } : publisherId ? { OR: [{ publisherId }, { receivedInbox: { publisherId } }] } : {}) },
        orderBy: { receivedAt: "desc" },
        take: 50,
        select: { id: true, subject: true, fromAddress: true, fromName: true, receivedAt: true, routeReason: true, routeStatus: true, receivedInbox: { select: { address: true } } },
      }),
    ]);
    return { publication, publisherId, inboxes, publishers, publications, lists, rules, unsorted };
  });
  const scopeParams: Query = { publication: publicationId ?? undefined, publisher: publicationId ? undefined : publisherIdParam ?? undefined };
  const scopeSearch = new URLSearchParams(Object.entries(scopeParams).filter((e): e is [string, string] => !!e[1])).toString();
  const back = `/ispy/inboxes${scopeSearch ? `?${scopeSearch}` : ""}`;
  const listName = new Map(data.lists.map((l) => [l.id, l.name]));
  const scopeName = data.publication?.name ?? data.publishers.find((p) => p.id === data.publisherId)?.name ?? null;

  // Test on last 200: a saved rule (?test=<id>) or the editor's conditions (?preview=1&cond_…).
  let preview: Awaited<ReturnType<typeof previewRuleOnRecent>> | null = null;
  let previewLabel = "";
  const testRule = query.test ? data.rules.find((r) => r.id === query.test) : null;
  if (testRule) {
    preview = await previewRuleOnRecent({ conditions: parseConditions(testRule.conditions), action: testRule.action as "ROUTE", listId: testRule.listId, publisherId: testRule.publisherId, publicationId: testRule.publicationId });
    previewLabel = `rule #${testRule.priority}`;
  } else if (query.preview) {
    const conditions = readConditionRows(new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => typeof e[1] === "string")));
    if (conditions.length) {
      preview = await previewRuleOnRecent({ conditions, action: (query.action as "ROUTE") ?? "ROUTE", listId: query.listId || null, publisherId: query.publisherId || data.publisherId, publicationId: query.publicationId || publicationId });
      previewLabel = "the unsaved rule";
    }
  }
  const editing = query.edit ? data.rules.find((r) => r.id === query.edit) ?? null : null;

  const inboxes = sortRows(data.inboxes, query, { address: (i) => i.address, level: (i) => i.level, provider: (i) => i.provider, goes: (i) => i.list?.name ?? i.publication?.name ?? i.publisher?.name ?? "", last: (i) => i.lastMessageAt, status: (i) => i.status }, "last");

  return (
    <div className="flex flex-col gap-5">
      <Flash error={query.error} notice={query.notice} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Inboxes &amp; routing{scopeName ? ` · ${scopeName}` : ""}</h2>
          <p className="max-w-3xl text-sm text-muted">Mail can arrive at any inbox (publisher catch-all, publication or list). Rules pick the list, first match wins, and the email moves to that list&apos;s own inbox. Signals and the AI only suggest: unknown lists wait in New lists.</p>
        </div>
        <form className="flex flex-wrap items-end gap-2" action="/ispy/inboxes">
          <label className={label}>
            Publication
            <select name="publication" defaultValue={publicationId ?? ""} className="pc-control">
              <option value="">(all)</option>
              {data.publications.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={btnSm}>Show</button>
        </form>
      </div>

      <section className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h3 className="text-base font-semibold">Inboxes</h3>
          <div className="flex flex-wrap gap-2 text-sm">
            {machineMailConfig() ? <Pill tone="ok">MachineMail connected</Pill> : <Pill tone="warn">MachineMail key not set</Pill>}
            {gmailEnv() ? (
              <form action={connectGmail} className="flex flex-wrap items-center gap-2">
                <Back to={back} />
                <select name="feed" aria-label="Feed" className="pc-control">
                  {(["FINPUB", "HEALTH"] as Feed[]).map((f) => (
                    <option key={f} value={f}>
                      {FEED_LABELS[f]}
                    </option>
                  ))}
                </select>
                <button className={btnSm} type="submit">Connect a legacy Gmail inbox</button>
              </form>
            ) : (
              <Pill tone="warn">GOOGLE_CLIENT_ID not set (legacy Gmail)</Pill>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse">
            <thead className="bg-[#fafbfc]">
              <tr>
                <SortTh base="/ispy/inboxes" params={{ ...query, ...scopeParams }} sortKey="address">Address</SortTh>
                <SortTh base="/ispy/inboxes" params={{ ...query, ...scopeParams }} sortKey="level">Level</SortTh>
                <SortTh base="/ispy/inboxes" params={{ ...query, ...scopeParams }} sortKey="provider">Provider</SortTh>
                <SortTh base="/ispy/inboxes" params={{ ...query, ...scopeParams }} sortKey="goes">Goes to</SortTh>
                <SortTh base="/ispy/inboxes" params={{ ...query, ...scopeParams }} sortKey="last">Last mail</SortTh>
                <SortTh base="/ispy/inboxes" params={{ ...query, ...scopeParams }} sortKey="status">Status</SortTh>
                <th scope="col" className={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {inboxes.length ? null : <EmptyRow cols={7}>No inboxes yet. Create them from Publications, or connect a legacy Gmail inbox.</EmptyRow>}
              {inboxes.map((i) => (
                <tr key={i.id} className="border-t border-line">
                  <td className={td}>
                    <code className="pc-break">{i.address}</code>
                    {i.affiliateSeed ? <div><Pill tone="purple">affiliate seed</Pill></div> : null}
                    {i.lastSyncError ? <div className="text-xs text-[#912018]">{i.lastSyncError}</div> : null}
                  </td>
                  <td className={td}>{INBOX_LEVEL_LABELS[i.level as InboxLevel] ?? i.level}</td>
                  <td className={td}>{i.provider === "GMAIL_LEGACY" ? "Gmail" : i.provider === "MACHINEMAIL" ? "MachineMail" : "Inbound"}</td>
                  <td className={td}>{i.list?.name ?? (i.level === "LIST" ? "—" : "rules ↓")}{i.publication && i.level !== "LIST" ? <div className="text-xs text-muted">{i.publication.name}</div> : null}</td>
                  <td className={td}>{ago(i.lastMessageAt)}</td>
                  <td className={td}><Pill tone={statusTone(i.status)}>{i.status === "PENDING_SIGNUP" ? "subscribe this address" : i.status.toLowerCase()}</Pill></td>
                  <td className={td}>
                    <div className="flex flex-wrap gap-2">
                      {i.provider === "GMAIL_LEGACY" && i.refreshTokenEnc ? (
                        <form action={syncGmailNow}>
                          <Back to={back} />
                          <input type="hidden" name="id" value={i.id} />
                          <button className={btnSm} type="submit">Sync now</button>
                        </form>
                      ) : null}
                      {i.status === "PENDING_SIGNUP" ? (
                        <form action={setInboxStatus}>
                          <Back to={back} />
                          <input type="hidden" name="id" value={i.id} />
                          <input type="hidden" name="status" value="ACTIVE" />
                          <button className={btnSm} type="submit">Mark subscribed</button>
                        </form>
                      ) : null}
                      {i.status !== "RETIRED" ? (
                        <form action={setInboxStatus}>
                          <Back to={back} />
                          <input type="hidden" name="id" value={i.id} />
                          <input type="hidden" name="status" value="RETIRED" />
                          <button className={btnDanger} type="submit">Retire</button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h3 className="text-base font-semibold">Routing rules <span className="font-normal text-muted">(lowest number first; first match wins)</span></h3>
          <form action={rerouteAction}>
            <Back to={back} />
            {data.publication ? <input type="hidden" name="publicationId" value={data.publication.id} /> : data.publisherId ? <input type="hidden" name="publisherId" value={data.publisherId} /> : null}
            <button className={btnSm} type="submit">Re-route history{scopeName ? ` for ${scopeName}` : ""}</button>
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse">
            <thead className="bg-[#fafbfc]">
              <tr>
                <th scope="col" className={th}>#</th>
                <th scope="col" className={th}>When…</th>
                <th scope="col" className={th}>Then</th>
                <th scope="col" className={`${th} text-right`}>Hits</th>
                <th scope="col" className={th}>Last hit</th>
                <th scope="col" className={th}>Origin</th>
                <th scope="col" className={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.rules.length ? null : <EmptyRow cols={7}>No rules{scopeName ? ` for ${scopeName}` : ""} yet. Add one below.</EmptyRow>}
              {data.rules.map((r) => (
                <tr key={r.id} className={`border-t border-line ${r.enabled ? "" : "opacity-60"}`}>
                  <td className={`${td} font-bold`}>{r.priority}</td>
                  <td className={`${td} min-w-[260px]`}>{describeConditions(parseConditions(r.conditions))}</td>
                  <td className={td}>{r.action === "IGNORE" ? <Pill>Ignore</Pill> : <Pill tone={r.action === "AFFILIATE" ? "purple" : "blue"}>→ {r.listId ? listName.get(r.listId) ?? "list" : "?"}{r.action === "AFFILIATE" ? " (affiliate)" : ""}</Pill>}</td>
                  <td className={`${td} text-right tabular-nums`}>{r.hits}</td>
                  <td className={td}>{ago(r.lastHitAt)}</td>
                  <td className={`${td} text-muted`}>{r.origin.toLowerCase()}</td>
                  <td className={td}>
                    <div className="flex flex-wrap gap-2">
                      <Link className={btnSm} href={`/ispy/inboxes?${new URLSearchParams({ ...(Object.fromEntries(Object.entries(scopeParams).filter((e): e is [string, string] => !!e[1]))), edit: r.id }).toString()}#rule-editor`}>Edit</Link>
                      <Link className={btnSm} href={`/ispy/inboxes?${new URLSearchParams({ ...(Object.fromEntries(Object.entries(scopeParams).filter((e): e is [string, string] => !!e[1]))), test: r.id }).toString()}#preview`}>Test on last 200</Link>
                      <form action={toggleRule}>
                        <Back to={back} />
                        <input type="hidden" name="id" value={r.id} />
                        <button className={btnSm} type="submit">{r.enabled ? "Disable" : "Enable"}</button>
                      </form>
                      <form action={deleteRule}>
                        <Back to={back} />
                        <input type="hidden" name="id" value={r.id} />
                        <button className={btnDanger} type="submit">Delete</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {preview ? (
        <section id="preview" className="rounded-lg border border-[#c7d6fb] bg-[#f3f7ff] p-4 text-sm">
          <h3 className="font-semibold">Preview · {previewLabel} against the last {preview.checked} emails (nothing was changed)</h3>
          <p className="mt-1">
            Would match <strong>{preview.matched}</strong>. Would move <strong>{preview.wouldMoveCount}</strong>
            {preview.wouldMoveCount ? ":" : "."}
          </p>
          {preview.wouldMove.length ? (
            <ul className="mt-2 list-disc pl-5">
              {preview.wouldMove.map((e) => (
                <li key={e.id}>
                  {day(e.receivedAt)} · “{e.subject}” · now in {e.list ?? "Unsorted"}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section id="rule-editor" className={`${card} p-4`}>
        <h3 className="mb-3 text-base font-semibold">{editing ? `Edit rule #${editing.priority}` : "Add a rule"}</h3>
        <form action={saveRule} className="flex flex-col gap-3">
          <Back to={back} />
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <input type="hidden" name="preview" value="1" />
          {publicationId ? <input type="hidden" name="publication" value={publicationId} /> : null}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <label className={label}>
              Priority (lower runs first)
              <input type="number" name="priority" min={1} max={10000} defaultValue={editing?.priority ?? (data.rules.at(-1)?.priority ?? 0) + 10} className={input} />
            </label>
            <label className={label}>
              Applies to publisher
              <select name="publisherId" defaultValue={editing?.publisherId ?? data.publisherId ?? ""} className={input}>
                <option value="">(any)</option>
                {data.publishers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              …and publication
              <select name="publicationId" defaultValue={editing?.publicationId ?? publicationId ?? ""} className={input}>
                <option value="">(any)</option>
                {data.publications
                  .filter((p) => !data.publisherId || p.publisherId === data.publisherId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className={label}>
              Then
              <select name="action" defaultValue={editing?.action ?? "ROUTE"} className={input}>
                <option value="ROUTE">Route to list</option>
                <option value="AFFILIATE">Route as affiliate file</option>
                <option value="IGNORE">Ignore</option>
              </select>
            </label>
            <label className={`${label} md:col-span-2`}>
              Target list
              <select name="listId" defaultValue={editing?.listId ?? ""} className={input}>
                <option value="">(none, for Ignore)</option>
                {data.lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex min-h-11 items-center gap-2 self-end text-sm">
              <input type="checkbox" name="disabled" defaultChecked={editing ? !editing.enabled : false} /> Save disabled
            </label>
          </div>
          <ConditionRows conditions={editing ? parseConditions(editing.conditions) : undefined} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={btnPrimary}>Save rule</button>
            <button type="submit" formAction="/ispy/inboxes#preview" formMethod="get" className={btn}>Test on last 200</button>
            {editing ? <Link className={btn} href={back}>Cancel</Link> : null}
          </div>
        </form>
      </section>

      <section id="unsorted" className={`${card} overflow-hidden`}>
        <h3 className="border-b border-line px-4 py-3 text-base font-semibold">Unsorted ({data.unsorted.length}{data.unsorted.length === 50 ? "+" : ""})</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead className="bg-[#fafbfc]">
              <tr>
                <th scope="col" className={th}>Date</th>
                <th scope="col" className={th}>From</th>
                <th scope="col" className={th}>Subject</th>
                <th scope="col" className={th}>Why</th>
                <th scope="col" className={th}>Sort by hand</th>
              </tr>
            </thead>
            <tbody>
              {data.unsorted.length ? null : <EmptyRow cols={5}>Nothing unsorted.</EmptyRow>}
              {data.unsorted.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className={`${td} whitespace-nowrap`}>{day(e.receivedAt)}</td>
                  <td className={td}>
                    {e.fromName ?? ""} <span className="text-muted">{e.fromAddress}</span>
                    {e.receivedInbox ? <div className="text-xs text-muted">to {e.receivedInbox.address}</div> : null}
                  </td>
                  <td className={td}>{e.subject}</td>
                  <td className={`${td} text-muted`}>{e.routeStatus === "CANDIDATE" ? <Link className="underline" href="/ispy/approvals">waiting for approval</Link> : e.routeReason}</td>
                  <td className={td}>
                    <form action={assignEmailList} className="flex flex-wrap gap-2">
                      <Back to={back} />
                      <input type="hidden" name="emailId" value={e.id} />
                      <select name="listId" aria-label="List" className="pc-control" defaultValue="">
                        <option value="" disabled>Pick a list…</option>
                        {data.lists.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                      <button className={btnSm} type="submit">Assign</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
