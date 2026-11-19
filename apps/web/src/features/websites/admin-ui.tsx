import { Badge } from "@pubcommand/ui";
import Link from "next/link";
import { effectiveStatus } from "../../../../../modules/websites/content";
import { chooseSite } from "./actions";
import type { SiteRow } from "./data";

/** "Working on: <site>" with a switcher when the brand has more than one site. */
export function SiteBar({ sites, site, back }: { sites: SiteRow[]; site: SiteRow; back: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">Website:</span>
      {sites.length > 1 ? (
        <form action={chooseSite} className="flex items-center gap-2">
          <input type="hidden" name="back" value={back} />
          <select name="siteId" defaultValue={site.id} className="pc-control">
            {sites.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <button className="text-sm font-semibold text-accent">Switch</button>
        </form>
      ) : (
        <b>{site.name}</b>
      )}
      <Badge tone={site.status === "live" ? "ok" : "warn"}>{site.status === "live" ? "Live" : "Not live yet"}</Badge>
      <a href={`/w/${site.slug}`} target="_blank" rel="noreferrer" className="ml-auto font-semibold text-accent">
        View site ↗
      </a>
      <a href={`/w/${site.slug}/my`} target="_blank" rel="noreferrer" className="font-semibold text-accent">
        Members area ↗
      </a>
    </div>
  );
}

export function NoSite() {
  return (
    <div className="rounded-xl border border-line bg-white p-6 text-sm">
      <p className="font-semibold">No website yet.</p>
      <p className="mt-1 text-muted">
        Create one on the{" "}
        <Link href="/websites" className="font-semibold text-accent">
          Websites
        </Link>{" "}
        page first.
      </p>
    </div>
  );
}

export function PostStatusBadge({ post, now }: { post: { status: string; publishedAt: Date | null; deletedAt?: Date | null }; now: Date }) {
  if (post.deletedAt) return <Badge tone="danger">Trash</Badge>;
  const status = effectiveStatus(post, now);
  const map = { published: ["ok", "Published"], scheduled: ["warn", "Scheduled"], pending: ["accent", "Pending review"], draft: ["neutral", "Draft"] } as const;
  const [tone, label] = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function AccessBadge({ access }: { access: string }) {
  if (access === "members") return <Badge tone="warn">🔒 Members</Badge>;
  if (access === "free") return <Badge tone="accent">Free subscribers</Badge>;
  return <Badge tone="ok">Public</Badge>;
}

/** Small publication chip: logo (from Publication Setup) + name. */
export function PubChip({ siteSlug, pub }: { siteSlug: string; pub: { id: string; name: string; hasLogo: boolean } | null | undefined }) {
  if (!pub) return <span className="text-muted">Site-wide</span>;
  return (
    <span className="inline-flex items-center gap-2 font-medium">
      {pub.hasLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/w/${siteSlug}/pub-logo/${pub.id}?bg=light`} alt="" className="h-6 w-6 rounded object-contain" />
      ) : (
        <span className="grid h-6 w-6 place-items-center rounded bg-[#10213a] text-[10px] font-bold text-white">{pub.name.slice(0, 1)}</span>
      )}
      {pub.name}
    </span>
  );
}

export function formatDate(date: Date | null | undefined, timeZone: string, withTime = false): string {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) }).format(date);
}
