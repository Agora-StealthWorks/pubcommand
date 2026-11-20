/**
 * Video references for launch-funnel days: Wistia (the default), YouTube and
 * Vidalytics. This is the ONE place that knows the providers: how to read a
 * pasted link, id or embed snippet, how to embed each one, where its public
 * metadata lives, and which hosts its player may load from.
 *
 * Ids are validated against strict patterns, so an id can be placed into an
 * embed URL or a DOM id without escaping problems.
 */
export const VIDEO_PROVIDERS = ["wistia", "youtube", "vidalytics"] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];
/** Vidalytics ids are "<account>/<embed>" (both parts appear in its embed URL). */
export type VideoRef = { provider: VideoProvider; id: string };

export const PROVIDER_LABELS: Record<VideoProvider, string> = { wistia: "Wistia", youtube: "YouTube", vidalytics: "Vidalytics" };

/** Wistia hashed media ids: 10 lowercase letters and digits (older ones are shorter). */
const WISTIA_ID = /^[a-z0-9]{6,20}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIDALYTICS_PART = /^[A-Za-z0-9_-]{4,40}$/;

/** Hosts each provider's player loads from (scripts, iframes, images). Nothing else is embedded. */
export const PROVIDER_HOSTS: Record<VideoProvider, readonly string[]> = {
  wistia: ["fast.wistia.com", "fast.wistia.net", "embed-ssl.wistia.com", "embedwistia-a.akamaihd.net"],
  youtube: ["www.youtube.com", "www.youtube-nocookie.com", "i.ytimg.com", "img.youtube.com"],
  vidalytics: ["fast.vidalytics.com", "quick.vidalytics.com", "stats.vidalytics.com"],
};

function isProvider(value: unknown): value is VideoProvider {
  return typeof value === "string" && (VIDEO_PROVIDERS as readonly string[]).includes(value);
}

function vidalyticsRef(account: string, embed: string): VideoRef | null {
  return VIDALYTICS_PART.test(account) && VIDALYTICS_PART.test(embed) ? { provider: "vidalytics", id: `${account}/${embed}` } : null;
}

function wistiaRef(id: string): VideoRef | null {
  const lower = id.toLowerCase();
  return WISTIA_ID.test(lower) ? { provider: "wistia", id: lower } : null;
}

/** Read a URL. Null when it is not a known provider's video. */
function fromUrl(text: string): VideoRef | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/")[1] ?? "";
    return YOUTUBE_ID.test(id) ? { provider: "youtube", id } : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
    const fromQuery = url.searchParams.get("v");
    if (fromQuery && YOUTUBE_ID.test(fromQuery)) return { provider: "youtube", id: fromQuery };
    const match = /^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})(?:[/?#]|$)/.exec(url.pathname);
    return match ? { provider: "youtube", id: match[1]! } : null;
  }
  if (host === "wistia.com" || host.endsWith(".wistia.com") || host === "wistia.net" || host.endsWith(".wistia.net") || host === "wi.st") {
    const match = /\/(?:medias|embed\/iframe|embed\/medias|iframe)\/([a-z0-9]{6,20})(?:[/.?#]|$)/i.exec(url.pathname);
    if (match) return wistiaRef(match[1]!);
    const wvideo = url.searchParams.get("wvideo");
    return wvideo ? wistiaRef(wvideo) : null;
  }
  if (host === "vidalytics.com" || host.endsWith(".vidalytics.com")) {
    const match = /^\/embeds\/([A-Za-z0-9_-]{4,40})\/([A-Za-z0-9_-]{4,40})(?:[/?#]|$)/.exec(url.pathname);
    return match ? vidalyticsRef(match[1]!, match[2]!) : null;
  }
  return null;
}

/**
 * Accepts a bare id, a share / watch / embed link, or a pasted embed snippet
 * (Wistia, YouTube iframe, Vidalytics script). `hint` is the admin's provider
 * choice: it decides ambiguous bare ids and rejects links of another provider.
 * Null when it is none of the providers.
 */
export function parseVideo(input: string | null | undefined, hint?: string | null): VideoRef | null {
  const text = (input ?? "").trim().slice(0, 20_000);
  if (!text) return null;
  const wanted = isProvider(hint) ? hint : null;
  const accept = (ref: VideoRef | null) => (ref && (!wanted || ref.provider === wanted) ? ref : null);

  // Embed snippets: find the first provider address or marker inside.
  if (/[<\s]/.test(text)) {
    const vidalytics = /fast\.vidalytics\.com\/embeds\/([A-Za-z0-9_-]{4,40})\/([A-Za-z0-9_-]{4,40})\//.exec(text);
    if (vidalytics) return accept(vidalyticsRef(vidalytics[1]!, vidalytics[2]!));
    const wistiaAsync = /wistia_async_([a-z0-9]{6,20})\b/i.exec(text);
    if (wistiaAsync) return accept(wistiaRef(wistiaAsync[1]!));
    const urls = text.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
    for (const candidate of urls) {
      const ref = fromUrl(candidate);
      if (ref) return accept(ref);
    }
    return null;
  }

  if (/^https?:\/\//i.test(text)) return accept(fromUrl(text));

  // Bare ids.
  if (wanted === "vidalytics") {
    const [account, embed, extra] = text.split("/");
    return extra === undefined && account && embed ? vidalyticsRef(account, embed) : null;
  }
  if (wanted === "youtube") return YOUTUBE_ID.test(text) ? { provider: "youtube", id: text } : null;
  if (wanted === "wistia") return wistiaRef(text);
  if (/^[a-z0-9]{10}$/i.test(text)) return wistiaRef(text);
  if (YOUTUBE_ID.test(text)) return { provider: "youtube", id: text };
  const parts = text.split("/");
  if (parts.length === 2) return vidalyticsRef(parts[0]!, parts[1]!);
  return wistiaRef(text);
}

/** Vidalytics: the account and embed ids of a reference. */
export function vidalyticsParts(video: VideoRef): { account: string; embed: string } | null {
  if (video.provider !== "vidalytics") return null;
  const [account, embed] = video.id.split("/");
  return account && embed && VIDALYTICS_PART.test(account) && VIDALYTICS_PART.test(embed) ? { account, embed } : null;
}

/** The iframe address (Wistia, YouTube). Vidalytics embeds with a script instead: see `vidalyticsScriptBase`. */
export function embedUrl(video: VideoRef): string {
  if (video.provider === "youtube") return `https://www.youtube-nocookie.com/embed/${video.id}?rel=0&modestbranding=1&playsinline=1&enablejsapi=1`;
  if (video.provider === "vidalytics") return vidalyticsScriptBase(video) ?? "";
  return `https://fast.wistia.net/embed/iframe/${video.id}?videoFoam=true`;
}

/** Vidalytics: the folder its loader and player scripts come from. */
export function vidalyticsScriptBase(video: VideoRef): string | null {
  const parts = vidalyticsParts(video);
  return parts ? `https://fast.vidalytics.com/embeds/${parts.account}/${parts.embed}/` : null;
}

/** A link the builder shows and that parses back to the same video. */
export function watchUrl(video: VideoRef): string {
  if (video.provider === "youtube") return `https://www.youtube.com/watch?v=${video.id}`;
  if (video.provider === "vidalytics") return vidalyticsScriptBase(video) ?? "";
  return `https://home.wistia.com/medias/${video.id}`;
}

/** Public oEmbed (no key). Vidalytics has none: its title, thumbnail and length are entered by hand. */
export function oembedUrl(video: VideoRef): string | null {
  if (video.provider === "youtube") return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(video))}`;
  if (video.provider === "wistia") return `https://fast.wistia.com/oembed?embedType=async&url=${encodeURIComponent(watchUrl(video))}`;
  return null;
}

/** A thumbnail that needs no lookup (YouTube only). */
export function fallbackThumbnail(video: VideoRef): string | null {
  return video.provider === "youtube" ? `https://img.youtube.com/vi/${video.id}/hqdefault.jpg` : null;
}

/**
 * How watched % is measured. Wistia and YouTube report it through their
 * player APIs. Vidalytics renders a normal <video> in the page, which is read
 * directly; if that cannot be found, time spent on the page is used.
 */
export const PROGRESS_SOURCE: Record<VideoProvider, string> = {
  wistia: "Watched % comes from the Wistia player.",
  youtube: "Watched % comes from the YouTube player.",
  vidalytics: "Watched % comes from the Vidalytics player in the page. If the player can't be read (blocked or changed), time on the page is used instead. Add the length below so that fallback is right.",
};

export type VideoMeta = { title: string | null; thumbnailUrl: string | null; durationSeconds: number | null };

/** Read the fields we use from an oEmbed JSON body. Only https thumbnails are kept; Wistia's are asked for at nav size. */
export function readOembed(body: unknown, provider: VideoProvider = "youtube"): VideoMeta {
  const source = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const title = typeof source.title === "string" ? source.title.slice(0, 200) : null;
  let thumb = typeof source.thumbnail_url === "string" && /^https:\/\//i.test(source.thumbnail_url) ? source.thumbnail_url.slice(0, 500) : null;
  if (thumb && provider === "wistia") thumb = `${thumb.split("?")[0]}?image_crop_resized=640x360`;
  const duration = typeof source.duration === "number" && Number.isFinite(source.duration) ? Math.round(source.duration) : null;
  return { title, thumbnailUrl: thumb, durationSeconds: duration };
}

/** "12:34" or "1:02:03" → seconds; null when it is not a time. */
export function parseDuration(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^\d{1,6}$/.test(trimmed)) return Number(trimmed);
  const match = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number(match[3]) < 60 ? seconds : null;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
