import { aiConfigured } from "@pubcommand/ai";
import { Badge, Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { canUsePromoAnalyzer, intelAccess } from "@/features/intel/context";
import { competitorOptions } from "@/features/intel/data";
import { assignVideoCompetitor, deleteVideo, extractVideoAction, retryVideo, sendVideoToAnalyzer } from "@/features/intel/more-actions";
import { entitiesFor } from "@/features/intel/registry";
import { AiMissingNotice, EntityChips, ExtractionState, ExtractionView, LandingCard, TypeBadge, VideoStatusBadge, formatDate } from "@/features/intel/ui";
import { loadVideo } from "@/features/intel/video-data";
import { AutoRefresh } from "@/features/promos/auto-refresh";
import { VIDEO_STEPS, VIDEO_STEP_LABELS, formatDuration, isCommercial, type VideoStep } from "../../../../../../../../../../modules/intel/index";

const SOURCE_LABELS: Record<string, string> = { captions: "the platform's captions", whisper: "Whisper speech-to-text", revai: "Rev AI speech-to-text" };

export default async function IntelVideoPage({ params, searchParams }: { params: Promise<{ slug: string; videoId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug, videoId } = await params;
  const search = await searchParams;
  const access = await intelAccess("read", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const { scope } = access;
  const video = await loadVideo(scope.organizationId, scope.brand.id, videoId);
  if (!video) notFound();
  const [competitors, promoAllowed, entities] = await Promise.all([
    competitorOptions(scope.organizationId, scope.brand.id),
    canUsePromoAnalyzer(slug),
    entitiesFor(scope.organizationId, { videoId: video.id }),
  ]);
  const ai = aiConfigured();
  const capturing = video.status === "QUEUED" || video.status === "RUNNING";
  const extracting = video.extractionStatus === "QUEUED" || video.extractionStatus === "RUNNING";
  const stepIndex = video.step ? VIDEO_STEPS.indexOf(video.step as VideoStep) : -1;
  const base = `/ispy/videos/${video.id}`;

  return (
    <div className="min-w-0">
      <Link href="/ispy/videos" className="text-sm text-accent underline">
        ← Videos
      </Link>
      <div className="mt-3">
        <Flash error={search.error} notice={search.notice} />
      </div>

      <header className="mb-4 rounded-xl border border-line bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <VideoStatusBadge status={video.status} step={video.step} />
          <TypeBadge type={video.videoType} />
          {video.platform ? <Badge>{video.platform}</Badge> : null}
          {video.durationSec ? <Badge>{formatDuration(video.durationSec)}</Badge> : null}
        </div>
        <h2 className="pc-break mt-2 text-xl font-semibold tracking-tight text-ink">{video.title ?? "Untitled video"}</h2>
        <dl className="mt-2 grid gap-1 text-sm">
          <div className="flex min-w-0 flex-wrap gap-x-2">
            <dt className="text-muted">Page</dt>
            <dd className="pc-break min-w-0">
              <a href={video.url} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline">
                {video.url}
              </a>
            </dd>
          </div>
          {video.mediaUrl && video.mediaUrl !== video.url ? (
            <div className="flex min-w-0 flex-wrap gap-x-2">
              <dt className="text-muted">Video found</dt>
              <dd className="pc-break min-w-0 text-xs">{video.mediaUrl}</dd>
            </div>
          ) : null}
          {video.uploader ? (
            <div className="flex min-w-0 flex-wrap gap-x-2">
              <dt className="text-muted">Channel</dt>
              <dd className="pc-break min-w-0">{video.uploader}</dd>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted">Captured</dt>
            <dd>{formatDate(video.createdAt)}</dd>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2">
            <dt className="text-muted">Competitor</dt>
            <dd className="min-w-0">
              {video.competitor ? (
                <Link href={`/ispy/competitors/${video.competitor.id}`} className="text-accent underline">
                  {video.competitor.name}
                </Link>
              ) : (
                <span className="text-muted">Not matched</span>
              )}
              {video.matchedBy ? <span className="ml-1 text-xs text-muted">(by {video.matchedBy})</span> : null}
            </dd>
          </div>
        </dl>
        <EntityChips entities={entities} base="/ispy" />
        {scope.canWrite ? (
          <form action={assignVideoCompetitor} className="mt-3 flex flex-wrap items-center gap-2">
            <input type="hidden" name="videoId" value={video.id} />
            <label htmlFor="assign-video-competitor" className="sr-only">
              Set competitor
            </label>
            <select id="assign-video-competitor" name="competitorId" defaultValue={video.competitorId ?? ""} className="pc-control min-w-0 max-w-full flex-1 sm:max-w-xs">
              <option value="">No competitor</option>
              {competitors.map((competitor) => (
                <option key={competitor.id} value={competitor.id}>
                  {competitor.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary" size="sm">
              Set competitor
            </Button>
          </form>
        ) : null}
      </header>

      {capturing ? (
        <div className="mb-4 rounded-xl border border-[#fedf89] bg-[#fffaeb] p-4 text-sm text-[#93370d]">
          <p className="font-semibold">
            {video.status === "QUEUED" ? "Waiting for its turn (one capture runs at a time)" : VIDEO_STEP_LABELS[(video.step as VideoStep) ?? "page"] ?? "Capturing"} · <AutoRefresh everyMs={5000} />
          </p>
          <ol className="mt-2 flex flex-wrap gap-1 text-xs">
            {VIDEO_STEPS.filter((step) => step !== "extract").map((step, index) => (
              <li key={step} className={`rounded-full px-2 py-0.5 ${index < stepIndex ? "bg-[#abefc6] text-[#067647]" : index === stepIndex ? "bg-[#fedf89]" : "bg-white text-muted"}`}>
                {VIDEO_STEP_LABELS[step]}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {video.status === "FAILED" ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#fecdca] bg-[#fef3f2] p-4 text-sm text-[#912018]">
          <p className="pc-break min-w-0">{video.error ?? "The capture failed."}</p>
          {scope.canWrite ? (
            <form action={retryVideo}>
              <input type="hidden" name="videoId" value={video.id} />
              <Button type="submit" variant="secondary" size="sm">
                Try again
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
      {video.status === "DONE" && video.error ? <p className="mb-4 rounded-md border border-line bg-canvas px-3 py-2 text-sm text-muted">Note: {video.error}</p> : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0 space-y-4">
          {video.frames.length ? (
            <div className="rounded-xl border border-line bg-white p-4">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Keyframes</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {video.frames.map((frame) => (
                  <figure key={frame.position} className="min-w-0">
                    <img src={`${base}/frames/${frame.position}`} alt={`Frame at ${formatDuration(frame.atSec)}`} className="w-full rounded-md border border-line" loading="lazy" />
                    <figcaption className="mt-0.5 text-xs text-muted">{formatDuration(frame.atSec) || "0:00"}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ) : null}
          <div className="rounded-xl border border-line bg-white p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Transcript</h3>
              {video.transcript ? (
                <a href={`${base}/transcript`} className="text-sm text-accent underline">
                  Download .txt
                </a>
              ) : null}
            </div>
            {video.transcript ? (
              <>
                <p className="mb-2 text-xs text-muted">
                  From {SOURCE_LABELS[video.transcriptSource ?? ""] ?? "the video"} · {video.transcript.split(/\s+/).length.toLocaleString("en-US")} words. Machine transcripts can mishear names and numbers.
                </p>
                <div className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-canvas p-3 text-sm text-ink">{video.transcript}</div>
              </>
            ) : (
              <p className="text-sm text-muted">{capturing ? "Not ready yet." : "No transcript."}</p>
            )}
          </div>
        </section>

        <aside className="min-w-0 space-y-4">
          <div className="rounded-xl border border-line bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Extraction</h3>
              {scope.canWrite && ai && video.status === "DONE" && !extracting ? (
                <form action={extractVideoAction}>
                  <input type="hidden" name="videoId" value={video.id} />
                  <Button type="submit" variant="secondary" size="sm">
                    {video.extraction ? "Run again" : "Extract"}
                  </Button>
                </form>
              ) : null}
            </div>
            {!ai && !video.extraction && video.status === "DONE" ? <AiMissingNotice what="this video has not been extracted" /> : null}
            <ExtractionState status={video.extractionStatus} error={ai ? video.extractionError : null} />
            {video.extraction ? (
              <>
                <ExtractionView extraction={video.extraction} source="video" />
                <p className="mt-3 text-xs text-muted">
                  Read by AI ({video.extractionModel}){video.extractedAt ? ` on ${formatDate(video.extractedAt)}` : ""} from the transcript and page. Prices and names are as stated; check before reusing.
                  {isCommercial(video.extraction.type) ? " Saved to this brand's Brain." : ""}
                </p>
              </>
            ) : null}
          </div>

          <LandingCard landing={video.landing} />

          <div className="rounded-xl border border-line bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Promo Analyzer</h3>
            {video.promo ? (
              <p className="text-sm">
                <Link href={`/promo-studio/${video.promo.id}`} className="text-accent underline">
                  Open the full analysis
                </Link>{" "}
                <span className="text-muted">({video.promo.analysisStatus.toLowerCase()})</span>
              </p>
            ) : scope.canWrite && promoAllowed ? (
              video.transcript.length >= 200 ? (
                <form action={sendVideoToAnalyzer} className="space-y-2">
                  <input type="hidden" name="videoId" value={video.id} />
                  <p className="text-sm text-muted">Run the full copy analysis on the transcript. It is saved as a promo in {scope.brand.name}.</p>
                  <Button type="submit" className="w-full sm:w-auto">
                    Send transcript to Promo Analyzer
                  </Button>
                </form>
              ) : (
                <p className="text-sm text-muted">Available once there is a transcript.</p>
              )
            ) : (
              <p className="text-sm text-muted">Sending to Promo Analyzer needs Promo Analyzer turned on and promo.write.</p>
            )}
          </div>

          {scope.canWrite && !capturing ? (
            <div className="flex flex-wrap gap-2">
              {video.status === "DONE" ? (
                <form action={retryVideo}>
                  <input type="hidden" name="videoId" value={video.id} />
                  <Button type="submit" variant="secondary" size="sm">
                    Capture again
                  </Button>
                </form>
              ) : null}
              <form action={deleteVideo}>
                <input type="hidden" name="videoId" value={video.id} />
                <Button type="submit" variant="danger" size="sm">
                  Delete video
                </Button>
              </form>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
