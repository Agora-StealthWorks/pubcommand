import { Button, Input } from "@pubcommand/ui";
import Link from "next/link";
import { Denied, Flash } from "@/components/ui";
import { bringPastDataOver } from "@/features/console/actions";
import { pastDataCounts, pastFromMasterBrain } from "@/features/console/past-data";
import { PastNoteList } from "@/features/console/past-list";
import { brainStaff } from "@/features/main-brain/staff";

export const dynamic = "force-dynamic";

function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = (
    <>
      <span className="block text-2xl font-semibold tabular-nums">{value}</span>
      <span className="block text-xs text-muted">{label}</span>
    </>
  );
  return href ? (
    <Link href={href} className="rounded-xl border border-line bg-white p-4 hover:bg-canvas">
      {body}
    </Link>
  ) : (
    <div className="rounded-xl border border-line bg-white p-4">{body}</div>
  );
}

export default async function PastDataPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; q?: string; show?: string }> }) {
  const staff = await brainStaff();
  if (!staff) return <Denied title="This page needs the platform.brain.manage permission" />;
  const query = await searchParams;
  const show = query.show === "videos" ? "videos" : "promos";
  const [counts, past] = await Promise.all([pastDataCounts(), pastFromMasterBrain(show, { q: query.q, take: 150 })]);
  const tab = (key: "promos" | "videos", label: string) => (
    <Link
      href={`/brain/past?show=${key}${query.q ? `&q=${encodeURIComponent(query.q)}` : ""}`}
      className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium ${show === key ? "bg-[#eef2ff] text-[#1e3a8a]" : "hover:bg-canvas"}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="min-w-0 max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Past promos &amp; videos</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Everything Promo Analyzer and VidRipper produced, in any organization, belongs in the Master Brain. Bringing it over adds any missing analyses and copy to the Master Brain
        (deleted organizations included) and copies the promos and captured videos into the console&apos;s own Promo Analyzer and VidRipper. Nothing is removed from the organizations, and running
        it again only fills what is missing.
      </p>
      <div className="mt-4">
        <Flash error={query.error} notice={query.notice} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Promo reviews in the Master Brain" value={counts.brainPromos} href="/brain/past?show=promos" />
        <Stat label="Video captures in the Master Brain" value={counts.brainVideos} href="/brain/past?show=videos" />
        <Stat label="Promos in the console's Promo Analyzer" value={counts.consolePromos} href="/promo-studio" />
        <Stat label="Videos in the console's VidRipper" value={counts.consoleVideos} href="/intel/videos" />
      </div>
      <form action={bringPastDataOver} className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white p-4">
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">Bring past data over</p>
          <p className="text-muted">
            In other organizations: {counts.otherOrgPromos} promos ({counts.copiedPromos} copied so far) and {counts.otherOrgVideos} videos ({counts.copiedVideos} copied so far).
          </p>
        </div>
        <Button type="submit">Bring it over</Button>
      </form>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <nav className="flex gap-1" aria-label="Past data">
          {tab("promos", "Promo reviews")}
          {tab("videos", "Videos (VidRipper)")}
        </nav>
        <form action="/brain/past" className="flex min-w-0 gap-2">
          <input type="hidden" name="show" value={show} />
          <Input name="q" defaultValue={query.q} placeholder="Search titles and text" aria-label="Search" className="min-w-0" />
          <Button type="submit" variant="secondary" className="shrink-0 whitespace-nowrap">
            Search
          </Button>
        </form>
      </div>
      <p className="mb-2 mt-3 text-sm text-muted">
        {past.total} {show === "videos" ? "video capture" : "promo review"}
        {past.total === 1 ? "" : "s"} in the Master Brain{past.total > past.notes.length ? ` (newest ${past.notes.length} shown)` : ""}.
        {show === "videos" ? " For videos whose organization is gone, this note is the only record left." : ""}
      </p>
      <PastNoteList notes={past.notes} empty={show === "videos" ? "No video captures in the Master Brain yet." : "No promo reviews in the Master Brain yet."} />
    </div>
  );
}
