import { Badge, Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { Denied, Flash } from "@/components/ui";
import { intelAccess } from "@/features/intel/context";
import { competitorOptions } from "@/features/intel/data";
import { captureVideoAction } from "@/features/intel/more-actions";
import { TypeBadge, VideoStatusBadge, formatDay } from "@/features/intel/ui";
import { listVideos, readVideoFilters, videoQueueCounts } from "@/features/intel/video-data";
import { toolStatus } from "@/features/intel/video-tools";
import { AutoRefresh } from "@/features/promos/auto-refresh";
import { EMAIL_TYPES, EMAIL_TYPE_LABELS, formatDuration, hostOf, sttConfig, sttLabel } from "../../../../../../../../../modules/intel/index";

export default async function IntelVideosPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const search = await searchParams;
  const access = await intelAccess("read", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const { scope } = access;
  const filters = readVideoFilters(search);
  const [videos, counts, competitors, tools] = await Promise.all([
    listVideos(scope.organizationId, scope.brand.id, filters),
    videoQueueCounts(scope.organizationId, scope.brand.id),
    competitorOptions(scope.organizationId, scope.brand.id),
    toolStatus(),
  ]);
  const stt = sttConfig(process.env);
  const filtered = Boolean(filters.competitor || filters.type || filters.status || filters.q || filters.from || filters.to);
  const exportQuery = new URLSearchParams({ kind: "videos" });
  for (const [key, value] of Object.entries(filters)) if (value) exportQuery.set(key, value);
  const toolsMissing = !tools.ytDlp || !tools.ffmpeg;

  return (
    <div className="min-w-0">
      <Flash error={search.error} notice={search.notice} />
      {counts.queued + counts.running > 0 ? (
        <p className="mb-4 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
          {counts.running ? "Capturing 1 video" : "Waiting to capture"}
          {counts.queued ? ` · ${counts.queued} in the queue` : ""} · <AutoRefresh everyMs={8000} />
        </p>
      ) : null}

      <div className="mb-4 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        {scope.canWrite ? (
          <form action={captureVideoAction} className="min-w-0 rounded-xl border border-line bg-white p-4">
            <h2 className="text-base font-semibold">Capture a video</h2>
            <p className="mt-1 text-sm text-muted">
              Paste a sales page, webinar replay, YouTube, Vimeo or Wistia link. In the background we find the video, download it, transcribe it, keep a transcript and a few keyframes, and run the
              same AI extraction as emails. The video file itself is not kept.
            </p>
            <Label htmlFor="video-url" className="mt-3 block">
              Page or video URL
            </Label>
            <div className="mt-1 flex min-w-0 flex-col gap-2 sm:flex-row">
              <Input id="video-url" name="url" type="url" required placeholder="https://…" className="min-w-0 flex-1" />
              <Button type="submit" disabled={toolsMissing}>
                Capture
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted">Public pages only: private and internal addresses are refused. One capture runs at a time; long videos can take several minutes.</p>
          </form>
        ) : (
          <div className="rounded-xl border border-line bg-white p-4 text-sm text-muted">You can view captured videos. Capturing needs intel.write.</div>
        )}
        <aside className="min-w-0 rounded-xl border border-line bg-white p-4 text-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">How transcripts are made</h3>
          <ul className="mt-2 space-y-1">
            <li>1. The platform's captions, when it has them (YouTube, many Vimeo and Wistia videos). Free.</li>
            <li>
              2. Otherwise speech-to-text: <strong>{sttLabel(stt)}</strong>
              {stt ? "." : <span className="text-muted">. Set INTEL_WHISPER_URL (a self-hosted Whisper server), OPENAI_API_KEY or REVAI_ACCESS_TOKEN to transcribe videos without captions.</span>}
            </li>
          </ul>
          <p className="mt-3 text-xs text-muted">
            Downloader: {tools.ytDlp ? `yt-dlp ${tools.ytDlp}` : <span className="text-[#912018]">yt-dlp is not installed</span>} · {tools.ffmpeg ? "ffmpeg ready" : <span className="text-[#912018]">ffmpeg is not installed</span>}
          </p>
        </aside>
      </div>

      <form action="/intel/videos" className="mb-4 grid gap-3 rounded-xl border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(5,minmax(0,1fr))_auto]">
        <div className="min-w-0">
          <Label htmlFor="video-q">Search</Label>
          <Input id="video-q" name="q" defaultValue={filters.q} placeholder="Title, URL or transcript" className="mt-1" />
        </div>
        <div className="min-w-0">
          <Label htmlFor="video-competitor">Competitor</Label>
          <select id="video-competitor" name="competitor" defaultValue={filters.competitor} className="pc-control mt-1 w-full">
            <option value="">All</option>
            {competitors.map((competitor) => (
              <option key={competitor.id} value={competitor.id}>
                {competitor.name}
              </option>
            ))}
            <option value="none">Not matched</option>
          </select>
        </div>
        <div className="min-w-0">
          <Label htmlFor="video-type">Type</Label>
          <select id="video-type" name="type" defaultValue={filters.type} className="pc-control mt-1 w-full">
            <option value="">All</option>
            {EMAIL_TYPES.map((type) => (
              <option key={type} value={type}>
                {EMAIL_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <Label htmlFor="video-status">Status</Label>
          <select id="video-status" name="status" defaultValue={filters.status} className="pc-control mt-1 w-full">
            <option value="">All</option>
            <option value="QUEUED">Queued</option>
            <option value="RUNNING">Capturing</option>
            <option value="DONE">Done</option>
            <option value="FAILED">Failed</option>
          </select>
        </div>
        <div className="min-w-0">
          <Label htmlFor="video-from">From</Label>
          <Input id="video-from" name="from" type="date" defaultValue={filters.from} className="mt-1" />
        </div>
        <div className="min-w-0">
          <Label htmlFor="video-to">To</Label>
          <Input id="video-to" name="to" type="date" defaultValue={filters.to} className="mt-1" />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit" variant="secondary" className="w-full sm:w-auto">
            Filter
          </Button>
          {filtered ? (
            <Link href="/intel/videos" className="inline-flex min-h-10 items-center px-2 text-sm text-muted underline">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {videos.length} video{videos.length === 1 ? "" : "s"}
          {filtered ? " match" : ""}
          {videos.length === 100 ? " (latest 100)" : ""}
        </p>
        <a href={`/intel/export?${exportQuery.toString()}`} className="text-sm text-accent underline">
          Export CSV
        </a>
      </div>

      {videos.length === 0 ? (
        <div className="rounded-xl border border-line bg-white p-6 text-sm text-muted">{filtered ? "No videos match these filters." : "No videos captured yet. Paste a competitor's sales page or video link above."}</div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
          {videos.map((video) => (
            <li key={video.id}>
              <Link href={`/intel/videos/${video.id}`} className="flex min-w-0 gap-3 px-4 py-3 hover:bg-canvas">
                <div className="hidden h-14 w-24 shrink-0 overflow-hidden rounded-md bg-canvas sm:block">
                  {video.hasThumb ? (
                    <img src={`/intel/videos/${video.id}/frames/0`} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 max-w-full truncate text-sm font-semibold text-ink">{video.competitor?.name ?? hostOf(video.url) ?? video.url}</span>
                    <VideoStatusBadge status={video.status} step={video.step} />
                    <TypeBadge type={video.videoType} />
                    {video.platform && video.platform !== "other" ? <Badge>{video.platform}</Badge> : null}
                    {video.durationSec ? <span className="text-xs text-muted">{formatDuration(video.durationSec)}</span> : null}
                    <span className="ml-auto shrink-0 text-xs text-muted">{formatDay(video.createdAt)}</span>
                  </div>
                  <p className="pc-break mt-0.5 text-sm text-ink">{video.title ?? video.url}</p>
                  {video.status === "FAILED" && video.error ? <p className="mt-0.5 line-clamp-2 break-words text-xs text-[#912018]">{video.error}</p> : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
