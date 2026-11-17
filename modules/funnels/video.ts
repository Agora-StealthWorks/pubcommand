/**
 * Video references for launch-funnel days. Wistia and YouTube only. Both have a
 * public oEmbed endpoint that needs no key, so the builder can fill in a title
 * and thumbnail from just a link.
 */
export type VideoProvider = "wistia" | "youtube";
export type VideoRef = { provider: VideoProvider; id: string };

const WISTIA_ID = /^[a-z0-9]{10}$/i;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** Accepts a bare id, a share link or an embed link. Null when it is neither provider. */
export function parseVideo(input: string | null | undefined, hint?: string | null): VideoRef | null {
  const text = (input ?? "").trim();
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) {
    if (hint === "youtube" && YOUTUBE_ID.test(text)) return { provider: "youtube", id: text };
    if (hint === "wistia" && WISTIA_ID.test(text)) return { provider: "wistia", id: text.toLowerCase() };
    if (WISTIA_ID.test(text) && hint !== "youtube") return { provider: "wistia", id: text.toLowerCase() };
    if (YOUTUBE_ID.test(text)) return { provider: "youtube", id: text };
    return null;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/")[1] ?? "";
    return YOUTUBE_ID.test(id) ? { provider: "youtube", id } : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const fromQuery = url.searchParams.get("v");
    if (fromQuery && YOUTUBE_ID.test(fromQuery)) return { provider: "youtube", id: fromQuery };
    const match = /^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
    return match ? { provider: "youtube", id: match[1]! } : null;
  }
  if (host.endsWith("wistia.com") || host.endsWith("wistia.net") || host.endsWith("wi.st")) {
    const match = /\/(?:medias|embed\/iframe|embed\/medias|iframe)\/([a-z0-9]{10})/i.exec(url.pathname);
    if (match) return { provider: "wistia", id: match[1]!.toLowerCase() };
    const wvideo = url.searchParams.get("wvideo");
    return wvideo && WISTIA_ID.test(wvideo) ? { provider: "wistia", id: wvideo.toLowerCase() } : null;
  }
  return null;
}

export function embedUrl(video: VideoRef): string {
  if (video.provider === "youtube") return `https://www.youtube-nocookie.com/embed/${video.id}?rel=0&modestbranding=1&playsinline=1&enablejsapi=1`;
  return `https://fast.wistia.net/embed/iframe/${video.id}?videoFoam=true&playerColor=1d4ed8`;
}

export function watchUrl(video: VideoRef): string {
  return video.provider === "youtube" ? `https://www.youtube.com/watch?v=${video.id}` : `https://home.wistia.com/medias/${video.id}`;
}

export function oembedUrl(video: VideoRef): string {
  if (video.provider === "youtube") return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(video))}`;
  return `https://fast.wistia.com/oembed?url=${encodeURIComponent(watchUrl(video))}`;
}

/** A thumbnail that needs no lookup (YouTube only). */
export function fallbackThumbnail(video: VideoRef): string | null {
  return video.provider === "youtube" ? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg` : null;
}

export type VideoMeta = { title: string | null; thumbnailUrl: string | null; durationSeconds: number | null };

/** Read the fields we use from an oEmbed JSON body. Only https thumbnails are kept. */
export function readOembed(body: unknown): VideoMeta {
  const source = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const title = typeof source.title === "string" ? source.title.slice(0, 200) : null;
  const thumb = typeof source.thumbnail_url === "string" && /^https:\/\//i.test(source.thumbnail_url) ? source.thumbnail_url.slice(0, 500) : null;
  const duration = typeof source.duration === "number" && Number.isFinite(source.duration) ? Math.round(source.duration) : null;
  return { title, thumbnailUrl: thumb, durationSeconds: duration };
}
