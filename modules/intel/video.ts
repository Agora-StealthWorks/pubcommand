/**
 * Video capture (the old VidRipper): a page URL in, a transcript, a few
 * keyframes and the page text out. Pure: the pipeline takes every side effect
 * (page fetch, yt-dlp, ffmpeg, speech-to-text) as an injected dependency, so it
 * is unit-tested with fakes. The real tools live in apps/web/src/features/intel/video-tools.ts.
 */
import { decodeEntities } from "./mime";

export const VIDEO_PLATFORMS = ["youtube", "vimeo", "wistia", "vidalytics", "brightcove", "jwplayer", "file", "other"] as const;
export type VideoPlatform = (typeof VIDEO_PLATFORMS)[number];

export const VIDEO_STEPS = ["page", "probe", "captions", "download", "audio", "transcribe", "frames", "extract"] as const;
export type VideoStep = (typeof VIDEO_STEPS)[number];

export const VIDEO_STEP_LABELS: Record<VideoStep, string> = {
  page: "Reading the page",
  probe: "Finding the video",
  captions: "Looking for captions",
  download: "Downloading",
  audio: "Extracting audio",
  transcribe: "Transcribing",
  frames: "Taking keyframes",
  extract: "AI extraction",
};

export type VideoLimits = {
  /** Longer videos are refused before downloading. */
  maxDurationSec: number;
  /** yt-dlp --max-filesize. */
  maxDownloadBytes: number;
  frames: number;
};

export function videoLimits(env: Record<string, string | undefined>): VideoLimits {
  const minutes = Number(env.INTEL_VIDEO_MAX_MINUTES);
  const megabytes = Number(env.INTEL_VIDEO_MAX_MB);
  return {
    maxDurationSec: Math.round((Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 240) : 120) * 60),
    maxDownloadBytes: Math.round((Number.isFinite(megabytes) && megabytes > 0 ? Math.min(megabytes, 2000) : 600) * 1024 * 1024),
    frames: 6,
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Which platform a URL belongs to, by host. */
export function detectPlatform(url: string): VideoPlatform {
  const host = hostOf(url);
  if (!host) return "other";
  if (hostIs(host, "youtube.com") || hostIs(host, "youtu.be") || hostIs(host, "youtube-nocookie.com")) return "youtube";
  if (hostIs(host, "vimeo.com")) return "vimeo";
  if (hostIs(host, "wistia.com") || hostIs(host, "wistia.net") || hostIs(host, "wi.st")) return "wistia";
  if (hostIs(host, "vidalytics.com")) return "vidalytics";
  if (hostIs(host, "brightcove.net") || hostIs(host, "brightcove.com") || hostIs(host, "bcove.video")) return "brightcove";
  if (hostIs(host, "jwplayer.com") || hostIs(host, "jwplatform.com") || hostIs(host, "jwpcdn.com")) return "jwplayer";
  if (/\.(mp4|m4v|mov|webm|m3u8)(\?|#|$)/i.test(url)) return "file";
  return "other";
}

/** A platform URL is handed straight to the downloader; any other page is read first to find its embed. */
export function isDirectVideoUrl(url: string): boolean {
  return detectPlatform(url) !== "other";
}

export type EmbeddedVideo = { url: string; platform: VideoPlatform };

/**
 * Video embeds on a page, best first: YouTube, Vimeo, Wistia, Vidalytics,
 * Brightcove and JW Player players, then <video>/og:video sources and direct
 * .mp4/.m3u8 links. Relative URLs resolve against the page.
 */
export function findEmbeddedVideos(html: string, pageUrl: string, max = 6): EmbeddedVideo[] {
  const found: EmbeddedVideo[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined, platform?: VideoPlatform) => {
    if (!raw) return;
    let url: string;
    try {
      url = new URL(decodeEntities(raw.trim()).replace(/^\/\//, "https://"), pageUrl).toString();
    } catch {
      return;
    }
    if (!/^https?:/i.test(url) || seen.has(url)) return;
    seen.add(url);
    found.push({ url, platform: platform ?? detectPlatform(url) });
  };
  const source = html.slice(0, 4 * 1024 * 1024);

  for (const match of source.matchAll(/(?:https?:)?\/\/(?:www\.)?(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/gi)) {
    add(`https://www.youtube.com/watch?v=${match[1]}`, "youtube");
  }
  for (const match of source.matchAll(/(?:https?:)?\/\/(?:player\.)?vimeo\.com\/(?:video\/)?(\d{6,12})(?:[^"'\s<>]*?[?&]h=([0-9a-f]+))?/gi)) {
    add(`https://player.vimeo.com/video/${match[1]}${match[2] ? `?h=${match[2]}` : ""}`, "vimeo");
  }
  const wistia = [
    ...source.matchAll(/wistia_async_([a-z0-9]{6,})/gi),
    ...source.matchAll(/(?:fast\.)?wistia\.(?:net|com)\/(?:embed\/(?:iframe|medias)\/|medias\/)([a-z0-9]{6,})/gi),
    ...source.matchAll(/data-wistia-id\s*=\s*["']([a-z0-9]{6,})/gi),
  ];
  for (const match of wistia) add(`https://fast.wistia.net/embed/iframe/${match[1]!.toLowerCase()}`, "wistia");
  for (const match of source.matchAll(/(?:https?:)?\/\/(?:fast|quick)\.vidalytics\.com\/(?:embeds|video)\/([\w-]+)\/([\w-]+)/gi)) {
    add(`https://fast.vidalytics.com/embeds/${match[1]}/${match[2]}/`, "vidalytics");
  }
  for (const match of source.matchAll(/(?:https?:)?\/\/players\.brightcove\.net\/(\d+)\/([\w-]+)_[\w-]+\/index\.html\?videoId=(\d+)/gi)) {
    add(`https://players.brightcove.net/${match[1]}/${match[2]}_default/index.html?videoId=${match[3]}`, "brightcove");
  }
  for (const tag of source.matchAll(/<(?:video-js|video)\b[^>]*\bdata-account\s*=\s*["'](\d+)["'][^>]*>/gi)) {
    const account = tag[1];
    const videoId = tag[0].match(/\bdata-video-id\s*=\s*["'](\d+)["']/i)?.[1];
    const player = tag[0].match(/\bdata-player\s*=\s*["']([\w-]+)["']/i)?.[1] ?? "default";
    if (account && videoId) add(`https://players.brightcove.net/${account}/${player}_default/index.html?videoId=${videoId}`, "brightcove");
  }
  for (const match of source.matchAll(/(?:https?:)?\/\/(?:cdn|content)\.jwplayer\.com\/(?:players|v2\/media|previews)\/([a-z0-9]{8})/gi)) {
    add(`https://cdn.jwplayer.com/v2/media/${match[1]}`, "jwplayer");
  }
  for (const match of source.matchAll(/<meta\b[^>]*property\s*=\s*["']og:video(?::secure_url|:url)?["'][^>]*>/gi)) {
    add(match[0].match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1]);
  }
  for (const match of source.matchAll(/<(?:video|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    if (!/^(blob|data):/i.test(match[1]!)) add(match[1]);
  }
  for (const match of source.matchAll(/["'(\s](https?:\/\/[^"'()\s<>]+?\.(?:mp4|m3u8|m4v|webm)(?:\?[^"'()\s<>]*)?)["')\s]/gi)) add(match[1]);

  return found.slice(0, max);
}

/**
 * Plain text from a WebVTT (or SRT) caption file. Cue timings, tags and
 * numbering go; the rolling duplicates of auto-captions (each cue repeating the
 * previous line) collapse.
 */
export function captionsToText(vtt: string): string {
  const lines: string[] = [];
  const blocks = vtt.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const rows = block.split("\n");
    const timing = rows.findIndex((row) => /-->/.test(row));
    if (timing < 0) continue;
    for (const row of rows.slice(timing + 1)) {
      const text = decodeEntities(row.replace(/<[^>]+>/g, "").replace(/\{\\[^}]*\}/g, ""))
        .replace(/\s+/g, " ")
        .trim();
      if (!text || /^\[(music|applause|laughter|silence)\]$/i.test(text)) continue;
      if (lines[lines.length - 1] === text) continue;
      lines.push(text);
    }
  }
  // Join into paragraphs of roughly 600 characters so the transcript reads well.
  const paragraphs: string[] = [];
  let current = "";
  for (const line of lines) {
    current = current ? `${current} ${line}` : line;
    if (current.length > 600 && /[.!?]["')\]]?$/.test(line)) {
      paragraphs.push(current);
      current = "";
    }
  }
  if (current) paragraphs.push(current);
  return paragraphs.join("\n\n");
}

/** Evenly spaced keyframe times, skipping the first and last few seconds. */
export function keyframeTimes(durationSec: number | null, count: number): number[] {
  if (!durationSec || durationSec < 2 || count < 1) return [0];
  if (durationSec < 10) return [Math.floor(durationSec / 2)];
  const start = Math.min(5, durationSec * 0.05);
  const end = durationSec - Math.min(5, durationSec * 0.05);
  const step = (end - start) / Math.max(1, count - 1);
  const times = Array.from({ length: count }, (_, index) => Math.floor(start + step * index));
  return [...new Set(times)];
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

// ── Speech-to-text ──────────────────────────────────────────────────────────

/**
 * Transcription when a video has no captions:
 * - whisper: any OpenAI-compatible /v1/audio/transcriptions endpoint. Set
 *   INTEL_WHISPER_URL to a self-hosted server (faster-whisper-server, speaches,
 *   whisper.cpp server: free) or leave it blank with OPENAI_API_KEY set to use OpenAI.
 * - revai: Rev AI (what the old app used), REVAI_ACCESS_TOKEN.
 * INTEL_STT_PROVIDER picks one when both are configured. Captions always win and cost nothing.
 */
export type SttConfig =
  | { provider: "whisper"; url: string; apiKey: string | null; model: string }
  | { provider: "revai"; token: string };

export const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";

export function sttConfig(env: Record<string, string | undefined>): SttConfig | null {
  const pick = env.INTEL_STT_PROVIDER?.trim().toLowerCase();
  const whisperUrl = env.INTEL_WHISPER_URL?.trim();
  const openAiKey = env.INTEL_WHISPER_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || "";
  const whisper: SttConfig | null =
    whisperUrl || openAiKey
      ? { provider: "whisper", url: whisperUrl || OPENAI_TRANSCRIPTIONS_URL, apiKey: openAiKey || null, model: env.INTEL_WHISPER_MODEL?.trim() || "whisper-1" }
      : null;
  const revToken = env.REVAI_ACCESS_TOKEN?.trim();
  const rev: SttConfig | null = revToken ? { provider: "revai", token: revToken } : null;
  if (pick === "revai") return rev;
  if (pick === "whisper") return whisper;
  if (pick === "none" || pick === "captions") return null;
  return whisper ?? rev;
}

export function sttLabel(config: SttConfig | null): string {
  if (!config) return "captions only";
  if (config.provider === "revai") return "Rev AI";
  return config.url === OPENAI_TRANSCRIPTIONS_URL ? "OpenAI Whisper" : "Whisper (self-hosted)";
}

/** A fetch that can send multipart bodies (FormData) and read text or JSON. */
export type HttpLike = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: FormData | string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

export type AudioChunk = { name: string; data: Uint8Array; mime: string };

function blobOf(chunk: AudioChunk): Blob {
  return new Blob([chunk.data as unknown as ArrayBuffer], { type: chunk.mime });
}

async function errorText(response: { status: number; text(): Promise<string> }, what: string): Promise<string> {
  const body = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
  return `${what} returned ${response.status}${body ? `: ${body}` : ""}`;
}

/** Transcribe audio chunks in order with an OpenAI-compatible endpoint. */
export async function whisperTranscribe(http: HttpLike, config: Extract<SttConfig, { provider: "whisper" }>, chunks: readonly AudioChunk[]): Promise<string> {
  const parts: string[] = [];
  for (const chunk of chunks) {
    const form = new FormData();
    form.append("file", blobOf(chunk), chunk.name);
    form.append("model", config.model);
    form.append("response_format", "text");
    const response = await http(config.url, { method: "POST", headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}, body: form });
    if (!response.ok) throw new Error(await errorText(response, "The transcription service"));
    const text = (await response.text()).trim();
    // Some servers ignore response_format and answer JSON.
    parts.push(text.startsWith("{") ? String((JSON.parse(text) as { text?: string }).text ?? "").trim() : text);
  }
  return parts.filter(Boolean).join("\n\n");
}

export const REVAI_API = "https://api.rev.ai/speechtotext/v1";

/** Transcribe with Rev AI: upload each chunk, poll until done, read the plain-text transcript. */
export async function revAiTranscribe(
  http: HttpLike,
  config: Extract<SttConfig, { provider: "revai" }>,
  chunks: readonly AudioChunk[],
  options: { sleep: (ms: number) => Promise<void>; pollMs?: number; maxPolls?: number } = { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
): Promise<string> {
  const auth = { Authorization: `Bearer ${config.token}` };
  const parts: string[] = [];
  for (const chunk of chunks) {
    const form = new FormData();
    form.append("media", blobOf(chunk), chunk.name);
    form.append("options", JSON.stringify({ skip_diarization: true, language: "en" }));
    const created = await http(`${REVAI_API}/jobs`, { method: "POST", headers: auth, body: form });
    if (!created.ok) throw new Error(await errorText(created, "Rev AI"));
    const job = (await created.json()) as { id?: string };
    if (!job.id) throw new Error("Rev AI did not return a job id.");
    let status = "in_progress";
    for (let poll = 0; poll < (options.maxPolls ?? 180) && status === "in_progress"; poll += 1) {
      await options.sleep(options.pollMs ?? 10_000);
      const check = await http(`${REVAI_API}/jobs/${job.id}`, { method: "GET", headers: auth });
      if (!check.ok) throw new Error(await errorText(check, "Rev AI"));
      const body = (await check.json()) as { status?: string; failure_detail?: string };
      status = body.status ?? "failed";
      if (status === "failed") throw new Error(`Rev AI could not transcribe it${body.failure_detail ? `: ${body.failure_detail}` : "."}`);
    }
    if (status !== "transcribed") throw new Error("Rev AI took too long.");
    const transcript = await http(`${REVAI_API}/jobs/${job.id}/transcript`, { method: "GET", headers: { ...auth, Accept: "text/plain" } });
    if (!transcript.ok) throw new Error(await errorText(transcript, "Rev AI"));
    parts.push(cleanRevTranscript(await transcript.text()));
  }
  return parts.filter(Boolean).join("\n\n");
}

/** Rev AI's text format prefixes every paragraph with "Speaker 0    00:00:01    ". */
export function cleanRevTranscript(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^Speaker \d+\s+\d{1,2}:\d{2}(?::\d{2})?\s+/, "").trim())
    .filter(Boolean)
    .join("\n\n");
}

// ── The pipeline ────────────────────────────────────────────────────────────

export type ProbeResult = {
  title: string | null;
  uploader: string | null;
  durationSec: number | null;
  thumbnailUrl: string | null;
  /** The platform's description (YouTube descriptions often link the sales page). */
  description: string | null;
  /** Caption tracks the platform has (manual or automatic). */
  hasCaptions: boolean;
};

export type CaptureDeps = {
  /** Guarded page fetch. Null when the page could not be read (the URL may still be a video). */
  fetchPage: (url: string) => Promise<{ finalUrl: string; html: string } | null>;
  probe: (mediaUrl: string) => Promise<ProbeResult>;
  /** WebVTT text of the best English caption track, or null. */
  captions: (mediaUrl: string) => Promise<string | null>;
  download: (mediaUrl: string) => Promise<{ path: string; bytes: number }>;
  /** Audio as chunks small enough for the speech-to-text service. */
  audio: (videoPath: string, maxSec: number) => Promise<AudioChunk[]>;
  /** Null when no speech-to-text service is configured. */
  transcribe: ((chunks: AudioChunk[]) => Promise<{ text: string; source: string }>) | null;
  frames: (videoPath: string, times: number[]) => Promise<{ atSec: number; data: Uint8Array }[]>;
  /** Called as each step starts (the page shows it). */
  step: (step: VideoStep) => Promise<void>;
};

export type CaptureResult = {
  mediaUrl: string;
  platform: VideoPlatform;
  title: string | null;
  uploader: string | null;
  durationSec: number | null;
  thumbnailUrl: string | null;
  description: string | null;
  transcript: string;
  transcriptSource: string | null;
  frames: { atSec: number; data: Uint8Array }[];
  page: { finalUrl: string; html: string } | null;
  /** Things that went wrong without stopping the capture. */
  warnings: string[];
};

export class CaptureError extends Error {}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** The whole capture. Throws CaptureError when nothing useful could be captured. */
export async function runCapturePipeline(deps: CaptureDeps, input: { url: string; limits: VideoLimits }): Promise<CaptureResult> {
  const warnings: string[] = [];
  let mediaUrl = input.url;
  let page: CaptureResult["page"] = null;

  if (!isDirectVideoUrl(input.url)) {
    await deps.step("page");
    page = await deps.fetchPage(input.url);
    if (page) {
      const embeds = findEmbeddedVideos(page.html, page.finalUrl);
      if (embeds[0]) mediaUrl = embeds[0].url;
      else warnings.push("No video player was found on the page, so the page URL itself was tried.");
    } else {
      warnings.push("The page could not be read, so the URL itself was tried as a video.");
    }
  }

  await deps.step("probe");
  let probe: ProbeResult;
  try {
    probe = await deps.probe(mediaUrl);
  } catch (error) {
    throw new CaptureError(`No downloadable video was found: ${message(error, "the downloader could not read it")}`);
  }
  if (probe.durationSec && probe.durationSec > input.limits.maxDurationSec) {
    throw new CaptureError(`The video is ${formatDuration(probe.durationSec)} long; the limit is ${formatDuration(input.limits.maxDurationSec)}.`);
  }

  let transcript = "";
  let transcriptSource: string | null = null;
  if (probe.hasCaptions) {
    await deps.step("captions");
    try {
      const vtt = await deps.captions(mediaUrl);
      const text = vtt ? captionsToText(vtt) : "";
      if (text.length >= 40) {
        transcript = text;
        transcriptSource = "captions";
      }
    } catch (error) {
      warnings.push(`Captions could not be read: ${message(error, "unknown error")}`);
    }
  }

  await deps.step("download");
  let video: { path: string; bytes: number } | null = null;
  try {
    video = await deps.download(mediaUrl);
  } catch (error) {
    if (!transcript) throw new CaptureError(`The video could not be downloaded: ${message(error, "unknown error")}`);
    warnings.push(`The video could not be downloaded, so there are no keyframes: ${message(error, "unknown error")}`);
  }

  if (!transcript && video) {
    if (!deps.transcribe) {
      warnings.push("This video has no captions and no speech-to-text service is set up, so there is no transcript. Set INTEL_WHISPER_URL, OPENAI_API_KEY or REVAI_ACCESS_TOKEN.");
    } else {
      await deps.step("audio");
      const chunks = await deps.audio(video.path, input.limits.maxDurationSec);
      await deps.step("transcribe");
      try {
        const result = await deps.transcribe(chunks);
        transcript = result.text.trim();
        transcriptSource = result.source;
        if (!transcript) warnings.push("The transcription came back empty (the video may have no speech).");
      } catch (error) {
        warnings.push(`Transcription failed: ${message(error, "unknown error")}`);
      }
    }
  }

  let frames: CaptureResult["frames"] = [];
  if (video) {
    await deps.step("frames");
    try {
      frames = await deps.frames(video.path, keyframeTimes(probe.durationSec, input.limits.frames));
    } catch (error) {
      warnings.push(`Keyframes failed: ${message(error, "unknown error")}`);
    }
  }

  return {
    mediaUrl,
    platform: detectPlatform(mediaUrl),
    title: probe.title,
    uploader: probe.uploader,
    durationSec: probe.durationSec,
    thumbnailUrl: probe.thumbnailUrl,
    description: probe.description,
    transcript,
    transcriptSource,
    frames,
    page,
    warnings,
  };
}

/** The useful fields of `yt-dlp -J` output. */
export function parseProbeJson(json: string): ProbeResult {
  const data = JSON.parse(json) as Record<string, unknown>;
  const text = (value: unknown, max = 300) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
  const tracks = (value: unknown) =>
    Boolean(value && typeof value === "object" && Object.keys(value as object).some((lang) => /^en(\b|[-_])/i.test(lang) || lang === "en"));
  const duration = typeof data.duration === "number" && Number.isFinite(data.duration) ? Math.round(data.duration) : null;
  return {
    title: text(data.title),
    uploader: text(data.uploader) ?? text(data.channel) ?? text(data.uploader_id, 120),
    durationSec: duration,
    thumbnailUrl: text(data.thumbnail, 2000),
    description: text(data.description, 20_000),
    hasCaptions: tracks(data.subtitles) || tracks(data.automatic_captions),
  };
}

/**
 * Which competitor put out a video: the page's host against their websites and
 * sender domains (most specific wins), else the channel name against their
 * name and products. Null when unknown.
 */
export function matchVideoCompetitor(
  input: { pageUrl: string; uploader: string | null },
  competitors: readonly { id: string; name: string; products: readonly string[]; websites: readonly string[]; senderDomains: readonly string[] }[],
): { competitorId: string; matchedBy: "website" | "channel" } | null {
  const host = hostOf(input.pageUrl);
  if (host && detectPlatform(input.pageUrl) === "other") {
    let best: { id: string; length: number } | null = null;
    for (const competitor of competitors) {
      for (const entry of [...competitor.websites, ...competitor.senderDomains]) {
        const domain = hostOf(/^[a-z]+:\/\//i.test(entry) ? entry : `https://${entry.replace(/^.*@/, "")}`);
        if (domain && hostIs(host, domain) && (!best || domain.length > best.length)) best = { id: competitor.id, length: domain.length };
      }
    }
    if (best) return { competitorId: best.id, matchedBy: "website" };
  }
  const channel = input.uploader?.trim().toLowerCase();
  if (channel) {
    for (const competitor of competitors) {
      if ([competitor.name, ...competitor.products].some((name) => name.trim().toLowerCase() === channel)) return { competitorId: competitor.id, matchedBy: "channel" };
    }
  }
  return null;
}
