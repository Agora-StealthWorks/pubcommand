import Link from "next/link";
import { Flash } from "@/components/ui";
import { FEED_LABELS, FEEDS, LIST_CATEGORY_LABELS, PUBLISHER_TYPE_LABELS, isOneOf, type Feed, type ListCategory, type PublisherType } from "../../../../../../../../modules/ispy/index";
import { loadCalendarPublications, loadOrgOptions, loadRegistry, type Registry } from "@/features/ispy/console-data";
import { CreateInboxButton, DeleteListButton, DeletePublicationButton, DeletePublisherButton, ListForm, PublicationForm, PublisherForm, type OrgOption, type CalOption } from "@/features/ispy/console-forms";
import { ago, card, Pill, statusTone } from "@/features/ispy/console-ui";

export const metadata = { title: "ISpy · Publications" };

type Query = { feed?: string; q?: string; error?: string; notice?: string };

export default async function PublicationsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const feed: Feed = isOneOf(FEEDS, query.feed) ? query.feed : "FINPUB";
  const [registry, orgs] = await Promise.all([loadRegistry(feed), loadOrgOptions()]);
  const cals = await loadCalendarPublications(registry.publications.map((p) => p.linkedBrandId).filter((x): x is string => !!x).concat(registry.publishers.map((p) => p.linkedBrandId).filter((x): x is string => !!x)));
  const back = `/ispy/publications?feed=${feed}${query.q ? `&q=${encodeURIComponent(query.q)}` : ""}`;
  const q = (query.q ?? "").trim().toLowerCase();
  const matches = (publisherId: string) => {
    if (!q) return true;
    const p = registry.publishers.find((x) => x.id === publisherId)!;
    const hay = [p.name, ...p.domains, ...p.fromAddresses, ...registry.publications.filter((x) => x.publisherId === p.id).map((x) => x.name), ...registry.lists.filter((x) => x.publisherId === p.id).map((x) => x.name), ...registry.inboxes.filter((x) => x.publisherId === p.id).map((x) => x.address)].join(" ").toLowerCase();
    return hay.includes(q);
  };
  const nonAffiliate = registry.publishers.filter((p) => p.type !== "AFFILIATE");
  const childIds = new Set(nonAffiliate.filter((p) => p.parentId).map((p) => p.parentId!));
  const groups = nonAffiliate.filter((p) => p.type === "GROUP" || childIds.has(p.id));
  const topLevel = nonAffiliate.filter((p) => !p.parentId || !nonAffiliate.some((g) => g.id === p.parentId));
  const groupOptions = registry.publishers.filter((p) => p.type === "GROUP" || childIds.has(p.id) || !p.parentId).map((p) => ({ id: p.id, name: p.name }));
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const brandName = new Map(orgs.flatMap((o) => o.brands.map((b) => [b.id, b.name] as const)));

  return (
    <div className="flex flex-col gap-4">
      <Flash error={query.error} notice={query.notice} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Publications</h2>
          <p className="text-sm text-muted">Group → publisher → publication → lists → inboxes. Link a publisher or publication to an organization to teach its Brain. Affiliates live under <Link className="underline" href="/ispy/affiliates">Affiliate Lists</Link>.</p>
        </div>
        <nav aria-label="Feed" className="inline-flex gap-1 rounded-lg border border-line bg-white p-1">
          {FEEDS.map((f) => (
            <Link key={f} href={`/ispy/publications?feed=${f}`} aria-current={f === feed ? "page" : undefined} className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm font-semibold ${f === feed ? "bg-accent text-white" : "hover:bg-canvas"}`}>
              {FEED_LABELS[f]}
            </Link>
          ))}
        </nav>
      </div>
      <form className="pc-form-row" action="/ispy/publications">
        <input type="hidden" name="feed" value={feed} />
        <label className="sr-only" htmlFor="pub-q">Search</label>
        <input id="pub-q" name="q" defaultValue={query.q} placeholder="Publisher, publication, list, domain or address…" className="pc-control flex-1" />
        <button className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-canvas" type="submit">Search</button>
      </form>

      <details className={`${card} p-4`}>
        <summary className="cursor-pointer text-sm font-semibold">+ Add a publisher or group</summary>
        <div className="mt-3">
          <PublisherForm groups={groupOptions} orgs={orgs} back={back} defaultFeed={feed} />
        </div>
      </details>

      <section className={`${card} divide-y divide-line`}>
        {topLevel.filter((p) => matches(p.id) || nonAffiliate.some((c) => c.parentId === p.id && matches(c.id))).length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No publishers in {FEED_LABELS[feed]} yet{q ? " match that search" : ""}. Add one above, or run the iSpy import.</p>
        ) : null}
        {topLevel
          .filter((p) => matches(p.id) || nonAffiliate.some((c) => c.parentId === p.id && matches(c.id)))
          .sort((a, b) => Number(b.type === "GROUP" || childIds.has(b.id)) - Number(a.type === "GROUP" || childIds.has(a.id)) || Number(a.type === "UNKNOWN") - Number(b.type === "UNKNOWN") || a.name.localeCompare(b.name))
          .map((p) => (
            <PublisherNode
              key={p.id}
              publisher={p}
              registry={registry}
              kids={nonAffiliate.filter((c) => c.parentId === p.id && matches(c.id))}
              orgs={orgs}
              cals={cals}
              groups={groupOptions}
              back={back}
              orgName={orgName}
              brandName={brandName}
              open={!!q || groups.length + topLevel.length <= 3}
            />
          ))}
      </section>
    </div>
  );
}

function PublisherNode({
  publisher,
  registry,
  kids: children,
  orgs,
  cals,
  groups,
  back,
  orgName,
  brandName,
  open,
  depth = 0,
}: {
  publisher: Registry["publishers"][number];
  registry: Registry;
  kids: Registry["publishers"];
  orgs: OrgOption[];
  cals: CalOption[];
  groups: { id: string; name: string }[];
  back: string;
  orgName: Map<string, string>;
  brandName: Map<string, string>;
  open: boolean;
  depth?: number;
}) {
  const p = publisher;
  const publications = registry.publications.filter((x) => x.publisherId === p.id);
  const looseLists = registry.lists.filter((l) => l.publisherId === p.id && !l.publicationId);
  const catchAlls = registry.inboxes.filter((i) => i.publisherId === p.id && i.level === "PUBLISHER_CATCHALL");
  const isGroup = p.type === "GROUP" || children.length > 0;
  return (
    <details open={open} className={depth ? "border-t border-line" : ""}>
      <summary className="flex min-h-12 cursor-pointer flex-wrap items-center gap-2 px-4 py-2" style={{ paddingLeft: `${16 + depth * 28}px` }}>
        <strong className={depth ? "" : "text-base"}>{p.name}</strong>
        <span className="text-sm text-muted">{isGroup ? `group · ${children.length} publisher(s)` : `${publications.length} publication(s) · ${registry.lists.filter((l) => l.publisherId === p.id).length} list(s)`}</span>
        {p.domains.length ? <span className="text-xs text-muted">{p.domains.slice(0, 3).join(", ")}</span> : null}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {p.linkedOrganizationId ? <Pill tone="ok">↔ {orgName.get(p.linkedOrganizationId) ?? "org"}{p.linkedBrandId ? ` / ${brandName.get(p.linkedBrandId) ?? "brand"}` : ""}</Pill> : null}
          {p.hideFromOtherOrgs ? <Pill tone="warn">hidden from other orgs</Pill> : null}
          <Pill tone={p.type === "INTERNAL" ? "teal" : p.type === "UNKNOWN" ? "warn" : "muted"}>{PUBLISHER_TYPE_LABELS[p.type as PublisherType] ?? p.type}</Pill>
        </span>
      </summary>
      <div className="flex flex-col gap-3 pb-3 pr-4" style={{ paddingLeft: `${44 + depth * 28}px` }}>
        <details className="rounded-md border border-line p-3">
          <summary className="cursor-pointer text-sm font-semibold">Edit {p.name}</summary>
          <div className="mt-3 flex flex-col gap-3">
            <PublisherForm publisher={p} groups={groups} orgs={orgs} back={back} defaultFeed={p.feed} />
            <DeletePublisherButton id={p.id} back={back} />
          </div>
        </details>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Catch-all:</span>
          {catchAlls.length ? catchAlls.map((i) => <InboxChip key={i.id} inbox={i} />) : <CreateInboxButton level="PUBLISHER_CATCHALL" publisherId={p.id} name={p.name} back={back} labelText="+ Create catch-all inbox" />}
        </div>
        {publications.map((pub) => {
          const lists = registry.lists.filter((l) => l.publicationId === pub.id);
          const pubInboxes = registry.inboxes.filter((i) => i.publicationId === pub.id && i.level === "PUBLICATION");
          const gurus = registry.gurus.filter((g) => g.publicationId === pub.id);
          const pubCals = cals.filter((c) => c.brandId === (pub.linkedBrandId ?? p.linkedBrandId));
          return (
            <div key={pub.id} className="rounded-md border border-line bg-[#fcfcfd] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{pub.name}</strong>
                {pub.linkedBrandId ? <Pill tone="ok">↔ {brandName.get(pub.linkedBrandId) ?? "brand"}</Pill> : null}
                {pub.linkedCalendarPublicationId ? <Pill tone="ok">Publication Setup: {cals.find((c) => c.id === pub.linkedCalendarPublicationId)?.code ?? "linked"}</Pill> : null}
                <span className="text-sm text-muted">inbox:</span>
                {pubInboxes.length ? pubInboxes.map((i) => <InboxChip key={i.id} inbox={i} />) : <CreateInboxButton level="PUBLICATION" publisherId={p.id} publicationId={pub.id} name={pub.name} back={back} labelText="+ Create inbox" />}
                <Link href={`/ispy/inboxes?publication=${pub.id}`} className="ml-auto text-sm underline">
                  Routing rules →
                </Link>
              </div>
              <ListTable lists={lists} registry={registry} publisherId={p.id} back={back} />
              <p className="mt-2 text-sm">
                <span className="text-muted">Gurus: </span>
                {gurus.length ? gurus.map((g) => `${g.guru.name} (${g.role})`).join(", ") : "none yet"} · <Link href={`/ispy/gurus?publication=${pub.id}`} className="underline">manage</Link>
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-semibold">+ Add a list to {pub.name}</summary>
                <div className="mt-2">
                  <ListForm publisherId={p.id} publicationId={pub.id} back={back} />
                </div>
              </details>
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-semibold">Edit publication</summary>
                <div className="mt-2 flex flex-col gap-2">
                  <PublicationForm publisherId={p.id} publication={pub} orgs={orgs} cals={pubCals.length ? pubCals : cals} back={back} />
                  <DeletePublicationButton id={pub.id} back={back} />
                </div>
              </details>
            </div>
          );
        })}
        {looseLists.length ? (
          <div className="rounded-md border border-dashed border-line p-3">
            <strong className="text-sm">Lists without a publication</strong>
            <ListTable lists={looseLists} registry={registry} publisherId={p.id} back={back} publications={publications.map((x) => ({ id: x.id, name: x.name }))} />
          </div>
        ) : null}
        {!isGroup ? (
          <details className="rounded-md border border-line p-3">
            <summary className="cursor-pointer text-sm font-semibold">+ Add a publication to {p.name}</summary>
            <div className="mt-2">
              <PublicationForm publisherId={p.id} orgs={orgs} cals={cals.filter((c) => !p.linkedBrandId || c.brandId === p.linkedBrandId)} back={back} />
            </div>
          </details>
        ) : null}
        {children.map((child) => (
          <PublisherNode key={child.id} publisher={child} registry={registry} kids={[]} orgs={orgs} cals={cals} groups={groups} back={back} orgName={orgName} brandName={brandName} open={open} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}

function InboxChip({ inbox }: { inbox: Registry["inboxes"][number] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <code className="pc-break text-xs">{inbox.address}</code>
      <Pill tone={statusTone(inbox.status)}>{inbox.status === "PENDING_SIGNUP" ? "subscribe me" : inbox.status.toLowerCase()}</Pill>
    </span>
  );
}

function ListTable({ lists, registry, publisherId, back, publications }: { lists: Registry["lists"]; registry: Registry; publisherId: string; back: string; publications?: { id: string; name: string }[] }) {
  if (!lists.length) return <p className="mt-2 text-sm text-muted">No lists yet.</p>;
  return (
    <div className="pc-scroll mt-2">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead className="bg-[#fafbfc]">
          <tr>
            <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-muted">List</th>
            <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-muted">Type</th>
            <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-muted">Inbox</th>
            <th scope="col" className="px-3 py-2 text-right text-xs font-semibold text-muted">Sends / 7 days</th>
            <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-muted">Edit</th>
          </tr>
        </thead>
        <tbody>
          {lists.map((l) => {
            const inboxes = registry.inboxes.filter((i) => i.listId === l.id);
            return (
              <tr key={l.id} className="border-t border-line align-top">
                <td className="px-3 py-2 font-semibold">
                  {l.name}
                  {l.isIgnored ? <span className="ml-1"><Pill>ignored</Pill></span> : null}
                  {l.synonyms.length ? <div className="text-xs font-normal text-muted">also: {l.synonyms.join(", ")}</div> : null}
                </td>
                <td className="px-3 py-2">{LIST_CATEGORY_LABELS[l.category as ListCategory] ?? l.category}</td>
                <td className="px-3 py-2">
                  {inboxes.length ? (
                    inboxes.map((i) => (
                      <div key={i.id} className="flex flex-wrap items-center gap-1">
                        <InboxChip inbox={i} />
                        <span className="text-xs text-muted">last {ago(i.lastMessageAt)}</span>
                      </div>
                    ))
                  ) : (
                    <CreateInboxButton level="LIST" publisherId={publisherId} publicationId={l.publicationId} listId={l.id} name={l.name} back={back} labelText="+ Create inbox" />
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{l.perWeek}</td>
                <td className="px-3 py-2">
                  <details>
                    <summary className="cursor-pointer text-sm underline">Edit</summary>
                    <div className="mt-2 flex min-w-[520px] flex-col gap-2">
                      <ListForm publisherId={publisherId} publicationId={l.publicationId} list={l} publications={publications} back={back} />
                      <DeleteListButton id={l.id} back={back} />
                    </div>
                  </details>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
