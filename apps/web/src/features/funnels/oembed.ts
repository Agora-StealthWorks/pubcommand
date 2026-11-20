import { tenantDb } from "@pubcommand/db";
import { oembedUrl, readOembed, type VideoMeta, type VideoRef } from "../../../../../modules/funnels/video";

/**
 * A video's title, thumbnail and length from the provider's public oEmbed
 * endpoint (no key). Null when the provider has none (Vidalytics), the video
 * is not found or the network is not reachable.
 */
export async function fetchVideoMeta(video: VideoRef, timeoutMs = 6000): Promise<VideoMeta | null> {
  const url = oembedUrl(video);
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" }, cache: "no-store" });
    if (!response.ok) return null;
    return readOembed(await response.json(), video.provider);
  } catch (error) {
    console.warn("[funnels] oEmbed lookup failed", video.provider, error instanceof Error ? error.message : error);
    return null;
  }
}

/** Fill a day's automatic video details after the response (retry path). Never overwrites a manual value. */
export async function refreshVideoMeta(organizationId: string, dayId: string, video: VideoRef): Promise<void> {
  const meta = await fetchVideoMeta(video);
  if (!meta) return;
  await tenantDb(organizationId).funnelDay.updateMany({
    where: { id: dayId, videoId: video.id },
    data: { videoTitle: meta.title, videoThumbUrl: meta.thumbnailUrl, ...(meta.durationSeconds ? { videoDuration: meta.durationSeconds } : {}) },
  });
}
