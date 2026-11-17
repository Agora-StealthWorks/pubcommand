import { tenantDb } from "@pubcommand/db";
import { oembedUrl, readOembed, type VideoRef } from "../../../../../modules/funnels/video";

/**
 * Fill a day's video title, thumbnail and duration from the provider's public
 * oEmbed endpoint (no key needed). Runs after the response; soft-fails.
 */
export async function refreshVideoMeta(organizationId: string, dayId: string, video: VideoRef): Promise<void> {
  try {
    const response = await fetch(oembedUrl(video), { signal: AbortSignal.timeout(5000), headers: { accept: "application/json" } });
    if (!response.ok) return;
    const meta = readOembed(await response.json());
    await tenantDb(organizationId).funnelDay.updateMany({
      where: { id: dayId, videoId: video.id },
      data: { videoTitle: meta.title, videoThumbUrl: meta.thumbnailUrl, videoDuration: meta.durationSeconds },
    });
  } catch (error) {
    console.warn("[funnels] oEmbed lookup failed", video.provider, error instanceof Error ? error.message : error);
  }
}
