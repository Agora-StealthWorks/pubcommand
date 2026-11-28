import { Flash } from "@/components/ui";
import { feedAccessState, FEED_LABELS, FEEDS, type Feed } from "../../../../../../../../modules/ispy/index";
import { setFeedAccess } from "@/features/ispy/console-actions";
import { Back, btnSm, card, Pill, SortTh, sortRows, td, th } from "@/features/ispy/console-ui";
import { ispyDb } from "@/features/ispy/db";

export const metadata = { title: "ISpy · Access" };

const STATE_LABEL = { niche: "✓ by niche", granted: "✓ granted", blocked: "blocked", off: "off" } as const;
const STATE_TONE = { niche: "ok", granted: "ok", blocked: "red", off: "muted" } as const;

/** Which feeds each organization sees: its brands' niche by default, with a staff override. */
export default async function AccessPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const data = await ispyDb(async (tx) => {
    const [orgs, brands, overrides, linked] = await Promise.all([
      tx.organization.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      tx.brand.findMany({ select: { organizationId: true, niche: true } }),
      tx.ispyFeedAccess.findMany({ select: { orgId: true, feed: true, mode: true } }),
      tx.ispyPublication.findMany({ where: { deletedAt: null, linkedOrganizationId: { not: null } }, select: { name: true, linkedOrganizationId: true } }),
    ]);
    return { orgs, brands, overrides, linked };
  });
  const rows = sortRows(
    data.orgs.map((o) => {
      const niches = data.brands.filter((b) => b.organizationId === o.id).map((b) => b.niche);
      const overrides = data.overrides.filter((x) => x.orgId === o.id);
      return { ...o, niches, overrides, pubs: data.linked.filter((l) => l.linkedOrganizationId === o.id).map((l) => l.name) };
    }),
    query,
    { name: (r) => r.name, niche: (r) => [...new Set(r.niches)].join(","), pubs: (r) => r.pubs.length },
    "name",
  );
  const params = { ...query };
  return (
    <div className="flex flex-col gap-4">
      <Flash error={query.error} notice={query.notice} />
      <div>
        <h2 className="text-lg font-semibold">Who sees which feed</h2>
        <p className="max-w-3xl text-sm text-muted">Organizations with ISpy get the feed that matches their brands&apos; niche (finance and general → FinPub, health → Health). Grant or block a feed here. Agents follow the same access. ISpy itself is turned on per org under Plans and Organizations.</p>
      </div>
      <section className={`${card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead className="bg-[#fafbfc]">
              <tr>
                <SortTh base="/ispy/access" params={params} sortKey="name">Organization</SortTh>
                <SortTh base="/ispy/access" params={params} sortKey="niche">Niche</SortTh>
                {FEEDS.map((f) => (
                  <th key={f} scope="col" className={th}>{FEED_LABELS[f]}</th>
                ))}
                <SortTh base="/ispy/access" params={params} sortKey="pubs">Linked publications</SortTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="border-t border-line align-top">
                  <td className={`${td} font-semibold`}>{o.name}</td>
                  <td className={td}>{[...new Set(o.niches)].join(", ") || "—"}</td>
                  {FEEDS.map((f: Feed) => {
                    const state = feedAccessState(f, o.niches, o.overrides);
                    return (
                      <td key={f} className={td}>
                        <div className="flex flex-wrap items-center gap-1">
                          <Pill tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Pill>
                          {(state === "off" || state === "blocked" ? ["ALLOWED"] : state === "niche" ? ["BLOCKED"] : ["BLOCKED"]).concat(state === "granted" || state === "blocked" ? ["RESET"] : []).map((mode) => (
                            <form key={mode} action={setFeedAccess}>
                              <Back to="/ispy/access" />
                              <input type="hidden" name="orgId" value={o.id} />
                              <input type="hidden" name="feed" value={f} />
                              <input type="hidden" name="mode" value={mode} />
                              <button className={btnSm} type="submit">{mode === "ALLOWED" ? "Grant" : mode === "BLOCKED" ? "Block" : "Reset"}</button>
                            </form>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                  <td className={`${td} text-muted`}>{o.pubs.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
