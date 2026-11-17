import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  checkPublicUrl,
  decodeHtmlBytes,
  isHtmlContentType,
  parseProbeJson,
  revAiTranscribe,
  sttConfig,
  whisperTranscribe,
  type AudioChunk,
  type CaptureDeps,
  type HttpLike,
  type VideoLimits,
  type VideoStep,
} from "../../../../../modules/intel/index";
import { fetchPublic, resolveHost } from "./net";

/**
 * The real tools behind the capture pipeline: yt-dlp and ffmpeg (installed in
 * the Docker image with apk), a guarded page fetch, and the optional
 * speech-to-text service. Everything runs in a private temp folder that is
 * deleted when the capture ends; the video file is never stored.
 */

const YT_DLP = process.env.INTEL_YTDLP_PATH?.trim() || "yt-dlp";
const FFMPEG = process.env.INTEL_FFMPEG_PATH?.trim() || "ffmpeg";

/** Audio is cut into 20-minute parts: at 32 kbit/s mono that is under 5 MB, well inside Whisper's 25 MB cap. */
const AUDIO_SEGMENT_SEC = 20 * 60;
const MAX_FRAME_BYTES = 250 * 1024;

export class ToolMissingError extends Error {}

type RunResult = { stdout: string; stderr: string };

function run(command: string, args: string[], options: { timeoutMs: number; maxOutput?: number; signal?: AbortSignal; cwd?: string }): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONUNBUFFERED: "1" } });
    const max = options.maxOutput ?? 1024 * 1024;
    let stdout = "";
    let stderr = "";
    let done = false;
    const finish = (error: Error | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`${path.basename(command)} took longer than ${Math.round(options.timeoutMs / 60_000)} min.`));
    }, options.timeoutMs);
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(new Error("The capture was stopped."));
    };
    options.signal?.addEventListener("abort", onAbort);
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < max) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 20_000) stderr += chunk.toString("utf8");
    });
    child.on("error", (error: Error & { code?: string }) =>
      finish(error.code === "ENOENT" ? new ToolMissingError(`${path.basename(command)} is not installed on this server.`) : error),
    );
    child.on("close", (code) => {
      if (code === 0) return finish(null);
      const reason = stderr
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /error/i.test(line))
        .pop();
      finish(new Error((reason ?? stderr.trim().split("\n").pop() ?? `exit code ${code}`).replace(/^ERROR:\s*/i, "").slice(0, 300)));
    });
  });
}

/** Options every yt-dlp call shares: no config files, no playlists, short network timeouts. */
function ytBase(): string[] {
  return ["--ignore-config", "--no-playlist", "--no-warnings", "--no-progress", "--no-cache-dir", "--socket-timeout", "20", "--retries", "2", "--restrict-filenames"];
}

/** Which tools this server has, for the Videos page. */
export async function toolStatus(): Promise<{ ytDlp: string | null; ffmpeg: boolean }> {
  const [yt, ff] = await Promise.all([
    run(YT_DLP, ["--version"], { timeoutMs: 10_000 }).then((result) => result.stdout.trim() || "installed", () => null),
    run(FFMPEG, ["-hide_banner", "-version"], { timeoutMs: 10_000 }).then(() => true, () => false),
  ]);
  return { ytDlp: yt, ffmpeg: ff };
}

const http: HttpLike = async (url, init) => {
  const response = await fetch(url, { method: init.method ?? "GET", headers: init.headers, body: init.body, signal: AbortSignal.timeout(10 * 60_000), redirect: "error" });
  return response;
};

export type CaptureWorkspace = { dir: string; deps: CaptureDeps; cleanup: () => Promise<void> };

/** A temp folder plus the real pipeline dependencies bound to it. */
export async function createWorkspace(input: { limits: VideoLimits; onStep: (step: VideoStep) => Promise<void>; signal: AbortSignal }): Promise<CaptureWorkspace> {
  const dir = await mkdtemp(path.join(tmpdir(), "intel-video-"));
  const { limits, signal } = input;

  const guard = async (url: string) => {
    const check = await checkPublicUrl(url, resolveHost);
    if (!check.ok) throw new Error(check.reason);
    return check.url.toString();
  };

  const stt = sttConfig(process.env);
  const deps: CaptureDeps = {
    step: input.onStep,
    async fetchPage(url) {
      const result = await fetchPublic(url, { maxBytes: 4 * 1024 * 1024, timeoutMs: 20_000 });
      if (!result.ok || result.status >= 400 || !isHtmlContentType(result.contentType)) return null;
      return { finalUrl: result.finalUrl, html: decodeHtmlBytes(result.body, result.contentType) };
    },
    async probe(mediaUrl) {
      const url = await guard(mediaUrl);
      const result = await run(YT_DLP, [...ytBase(), "-J", "--skip-download", "--", url], { timeoutMs: 90_000, maxOutput: 30 * 1024 * 1024, signal });
      return parseProbeJson(result.stdout);
    },
    async captions(mediaUrl) {
      const url = await guard(mediaUrl);
      const subs = path.join(dir, "subs");
      await run(
        YT_DLP,
        [...ytBase(), "--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", "en.*,en", "--sub-format", "vtt/best", "-o", `${subs}.%(ext)s`, "--", url],
        { timeoutMs: 120_000, signal },
      );
      const files = (await readdir(dir)).filter((name) => name.startsWith("subs.") && /\.(vtt|srt)$/i.test(name));
      // Prefer hand-made English tracks (subs.en.vtt, subs.en-US.vtt) over the auto "-orig" ones.
      files.sort((a, b) => Number(/orig/i.test(a)) - Number(/orig/i.test(b)) || a.length - b.length);
      if (!files[0]) return null;
      return readFile(path.join(dir, files[0]), "utf8");
    },
    async download(mediaUrl) {
      const url = await guard(mediaUrl);
      await run(
        YT_DLP,
        [
          ...ytBase(),
          "-f",
          "b[height<=480]/bv*[height<=480]+ba/w/b",
          "--max-filesize",
          String(limits.maxDownloadBytes),
          "--merge-output-format",
          "mp4",
          "--ffmpeg-location",
          FFMPEG,
          "-o",
          path.join(dir, "video.%(ext)s"),
          "--",
          url,
        ],
        { timeoutMs: 20 * 60_000, signal },
      );
      const file = (await readdir(dir)).find((name) => name.startsWith("video.") && !/\.(part|ytdl)$/.test(name));
      if (!file) throw new Error(`The video is larger than ${Math.round(limits.maxDownloadBytes / 1024 / 1024)} MB, or no file was saved.`);
      const full = path.join(dir, file);
      return { path: full, bytes: (await stat(full)).size };
    },
    async audio(videoPath, maxSec) {
      await run(
        FFMPEG,
        ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", videoPath, "-t", String(maxSec), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "32k", "-f", "segment", "-segment_time", String(AUDIO_SEGMENT_SEC), "-reset_timestamps", "1", path.join(dir, "audio-%03d.mp3")],
        { timeoutMs: 15 * 60_000, signal },
      );
      const names = (await readdir(dir)).filter((name) => /^audio-\d{3}\.mp3$/.test(name)).sort();
      if (!names.length) throw new Error("The video has no audio track.");
      const chunks: AudioChunk[] = [];
      for (const name of names) chunks.push({ name, data: new Uint8Array(await readFile(path.join(dir, name))), mime: "audio/mpeg" });
      return chunks;
    },
    transcribe: stt
      ? async (chunks) => {
          const text = stt.provider === "whisper" ? await whisperTranscribe(http, stt, chunks) : await revAiTranscribe(http, stt, chunks);
          return { text, source: stt.provider };
        }
      : null,
    async frames(videoPath, times) {
      const out: { atSec: number; data: Uint8Array }[] = [];
      for (const [index, atSec] of times.entries()) {
        const file = path.join(dir, `frame-${index}.jpg`);
        try {
          await run(FFMPEG, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-ss", String(atSec), "-i", videoPath, "-frames:v", "1", "-vf", "scale='min(640,iw)':-2", "-q:v", "6", file], { timeoutMs: 60_000, signal });
          const data = await readFile(file);
          if (data.byteLength > 0 && data.byteLength <= MAX_FRAME_BYTES) out.push({ atSec, data: new Uint8Array(data) });
        } catch {
          // A frame past the real end of the video: skip it.
        }
      }
      return out;
    },
  };
  return { dir, deps, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

