import { describe, expect, it } from "vitest";
import {
  CaptureError,
  buildDigest,
  captionsToText,
  checkPublicUrl,
  checkUrlShape,
  cleanRevTranscript,
  csvCell,
  detectPlatform,
  emailExportCsv,
  entityKey,
  extractionPrompt,
  findEmbeddedVideos,
  guardedFetch,
  isPrivateAddress,
  isSlackWebhookUrl,
  keyframeTimes,
  matchVideoCompetitor,
  landingPromptBlock,
  maskWebhook,
  nameConflict,
  normalizeEntityInput,
  parseDigestEmails,
  parseLandingHtml,
  parseProbeJson,
  planMerge,
  planRefMove,
  resolveList,
  resolveNames,
  revAiTranscribe,
  runCapturePipeline,
  sttConfig,
  toCsv,
  videoExtractionPrompt,
  videoLimits,
  whisperTranscribe,
  type CaptureDeps,
  type FetchOnce,
  type HttpLike,
  type RadarSummary,
  type RegistryEntry,
  type VideoStep,
} from "./index";

// ── URL guard ───────────────────────────────────────────────────────────────

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "fc12:3456::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:a9fe:a9fe",
    "64:ff9b::10.0.0.1",
    "2002:c0a8:0101::1",
    "ff02::1",
    "not-an-ip",
  ])("blocks %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "2001:4860:4860::8888"])("allows %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe("checkUrlShape", () => {
  it.each([
    ["ftp://example.com/file", "Only http"],
    ["javascript:alert(1)", "Only http"],
    ["http://localhost:3000/", "non-standard port"],
    ["http://localhost/", "private host"],
    ["http://intranet/", "private host"],
    ["http://db.railway.internal/", "private host"],
    ["http://printer.local/", "private host"],
    ["http://127.0.0.1/", "private address"],
    ["http://[::1]/", "private address"],
    ["http://2130706433/", "private address"],
    ["http://0x7f000001/", "private address"],
    ["https://user:pw@example.com/", "user name"],
    ["https://example.com:8443/", "non-standard port"],
    ["not a url", "not a valid URL"],
  ])("refuses %s", (url, reason) => {
    const result = checkUrlShape(url);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(reason);
  });

  it("accepts ordinary public URLs", () => {
    expect(checkUrlShape("https://www.example.com/offer?a=1").ok).toBe(true);
    expect(checkUrlShape("http://example.com:80/").ok).toBe(true);
    expect(checkUrlShape("https://8.8.8.8/").ok).toBe(true);
  });
});

describe("checkPublicUrl", () => {
  it("refuses a public-looking name that resolves to a private address", async () => {
    const result = await checkPublicUrl("https://evil.example.com/", async () => ["93.184.216.34", "10.0.0.5"]);
    expect(result).toEqual({ ok: false, reason: "That link points at a private address." });
  });

  it("refuses names that do not resolve", async () => {
    const result = await checkPublicUrl("https://nope.example.com/", async () => {
      throw new Error("ENOTFOUND");
    });
    expect(result.ok).toBe(false);
  });

  it("accepts names that resolve publicly", async () => {
    expect((await checkPublicUrl("https://example.com/", async () => ["93.184.216.34"])).ok).toBe(true);
  });
});

describe("guardedFetch", () => {
  const resolve = async (host: string) => (host === "internal.example.com" ? ["192.168.0.10"] : ["93.184.216.34"]);
  const page = (body: string) => ({ status: 200, headers: { "content-type": "text/html" }, body: new TextEncoder().encode(body), truncated: false });

  it("follows redirects and checks every hop", async () => {
    const seen: string[] = [];
    const fetchOnce: FetchOnce = async (url) => {
      seen.push(url.toString());
      if (url.hostname === "track.example.com") return { status: 302, headers: { location: "https://offer.example.com/vsl" }, body: new Uint8Array(), truncated: false };
      return page("<title>Offer</title>");
    };
    const result = await guardedFetch("https://track.example.com/c/123", { fetchOnce, resolve });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.finalUrl).toBe("https://offer.example.com/vsl");
      expect(result.redirects).toEqual(["https://offer.example.com/vsl"]);
    }
    expect(seen).toEqual(["https://track.example.com/c/123", "https://offer.example.com/vsl"]);
  });

  it("stops a redirect into a private network before requesting it", async () => {
    const seen: string[] = [];
    const fetchOnce: FetchOnce = async (url) => {
      seen.push(url.hostname);
      return { status: 301, headers: { location: "http://169.254.169.254/latest/meta-data/" }, body: new Uint8Array(), truncated: false };
    };
    const result = await guardedFetch("https://track.example.com/x", { fetchOnce, resolve });
    expect(result.ok).toBe(false);
    expect(seen).toEqual(["track.example.com"]);
  });

  it("stops at a host that resolves privately, and after too many redirects", async () => {
    const blocked = await guardedFetch("https://internal.example.com/", { fetchOnce: async () => page("x"), resolve });
    expect(blocked.ok).toBe(false);
    let n = 0;
    const loop = await guardedFetch("https://a.example.com/", {
      fetchOnce: async () => ({ status: 302, headers: { location: `/next-${(n += 1)}` }, body: new Uint8Array(), truncated: false }),
      resolve,
    });
    expect(loop).toMatchObject({ ok: false, reason: "Too many redirects." });
  });
});

// ── Landing pages ───────────────────────────────────────────────────────────

describe("parseLandingHtml", () => {
  const html = `<html><head><title>The 3-Day Retirement Fix &amp; More</title><meta name="description" content="A free briefing."><script>var x = "<h1>no</h1>";</script></head>
  <body><nav><a href="/home">Home</a></nav><h1>Retire on <em>your</em> terms</h1><h2>Order today</h2><h2>Order today</h2>
  <p>Join for just $49 a year.</p><a href="/order?src=vsl">Yes, I want it</a><footer>© Company</footer></body></html>`;

  it("keeps the title, description, headings, text and absolute links, and drops scripts, nav and footer", () => {
    const page = parseLandingHtml(html, "https://offer.example.com/vsl");
    expect(page.title).toBe("The 3-Day Retirement Fix & More");
    expect(page.description).toBe("A free briefing.");
    expect(page.headings).toEqual(["Retire on your terms", "Order today"]);
    expect(page.text).toContain("Join for just $49 a year.");
    expect(page.text).not.toContain("var x");
    expect(page.text).not.toContain("© Company");
    expect(page.links.map((link) => link.href)).toEqual(["https://offer.example.com/order?src=vsl"]);
  });

  it("adds a landing block to the email extraction prompt only when a page was captured", () => {
    const base = { brandContext: "Brand", competitorName: "Rival", fromName: null, fromAddress: "a@rival.com", subject: "S", receivedAt: new Date("2026-11-02T00:00:00Z"), text: "Body", links: [] };
    expect(extractionPrompt(base)).not.toContain("landing page it links to");
    const page = parseLandingHtml(html, "https://offer.example.com/vsl");
    const prompt = extractionPrompt({ ...base, landing: { url: "https://t.example.com/1", finalUrl: "https://offer.example.com/vsl", ...page } });
    expect(prompt).toContain("The landing page it links to (fetched by us, text only):");
    expect(prompt).toContain("URL: https://offer.example.com/vsl");
    expect(prompt).toContain("Headings: Retire on your terms | Order today");
  });

  it("truncates long landing text", () => {
    const block = landingPromptBlock({ url: "https://x.example.com", finalUrl: null, title: null, headings: [], text: "a".repeat(20_000) });
    expect(block).toContain("[…page truncated]");
    expect(block.length).toBeLessThan(9_000);
  });
});

// ── Registries ──────────────────────────────────────────────────────────────

const entries: RegistryEntry[] = [
  { id: "e1", kind: "expert", name: "Dr. Jane O'Neil", aliases: ["Jane Oneil"] },
  { id: "e2", kind: "expert", name: "Sam Lee", aliases: [] },
  { id: "t1", kind: "topic", name: "retirement", aliases: ["retiring"] },
  { id: "l1", kind: "list", name: "The Morning Edge", aliases: ["edge@rival.com"] },
  { id: "l2", kind: "list", name: "Rival Alerts", aliases: [] },
];

describe("registry", () => {
  it("keys names without case, accents or punctuation", () => {
    expect(entityKey("Dr. Jane O'Neil")).toBe("dr jane oneil");
    expect(entityKey("  José   Núñez ")).toBe("jose nunez");
    expect(entityKey("edge@Rival.com")).toBe("edge@rival.com");
  });

  it("resolves extraction names to entries and lists the new ones once", () => {
    const result = resolveNames(entries, "expert", ["dr jane o’neil", "JANE ONEIL", "Sam Lee", "New Person", "new person", " "]);
    expect(result).toEqual({ ids: ["e1", "e2"], create: ["New Person"] });
    expect(resolveNames(entries, "topic", ["Retiring", "Gold Coins"])).toEqual({ ids: ["t1"], create: ["gold coins"] });
  });

  it("matches a list by sender address first, then by display name, else proposes one", () => {
    expect(resolveList(entries, { fromName: "Someone Else", fromAddress: "Edge@Rival.com" })).toEqual({ id: "l1" });
    expect(resolveList(entries, { fromName: "\"Rival Alerts\"", fromAddress: "alerts@rival.com" })).toEqual({ id: "l2" });
    expect(resolveList(entries, { fromName: "Gold Weekly", fromAddress: "gold@rival.com" })).toEqual({ create: { name: "Gold Weekly", aliases: ["gold@rival.com"] } });
    expect(resolveList(entries, { fromName: null, fromAddress: "x@rival.com" })).toEqual({ create: { name: "x@rival.com", aliases: ["x@rival.com"] } });
    expect(resolveList(entries, { fromName: "A", fromAddress: "not an address" })).toBeNull();
  });

  it("plans a merge that folds the source's names into the target", () => {
    const plan = planMerge(entries[1]!, { ...entries[0]!, aliases: ["Jane Oneil", "sam lee"] });
    expect(plan).toEqual({ aliases: ["Jane Oneil", "sam lee"] });
    expect(planMerge({ ...entries[1]!, aliases: ["Samuel Lee"] }, entries[0]!)).toEqual({ aliases: ["Jane Oneil", "Sam Lee", "Samuel Lee"] });
    expect(planMerge(entries[0]!, entries[0]!)).toEqual({ error: "Pick a different entry to merge into." });
    expect(planMerge(entries[2]!, entries[0]!)).toEqual({ error: "Only entries of the same kind can be merged." });
  });

  it("after a merge the old spelling resolves to the target, not a new entry", () => {
    const plan = planMerge(entries[1]!, entries[0]!);
    if ("error" in plan) throw new Error(plan.error);
    const merged = entries.filter((entry) => entry.id !== "e2").map((entry) => (entry.id === "e1" ? { ...entry, aliases: plan.aliases } : entry));
    expect(resolveNames(merged, "expert", ["Sam Lee"])).toEqual({ ids: ["e1"], create: [] });
  });

  it("moves refs without duplicating an email the target already has", () => {
    const plan = planRefMove(
      [
        { id: "r1", emailId: "m1", videoId: null },
        { id: "r2", emailId: "m2", videoId: null },
        { id: "r3", emailId: null, videoId: "v1" },
      ],
      [{ emailId: "m2", videoId: null }],
    );
    expect(plan).toEqual({ move: ["r1", "r3"], drop: ["r2"] });
  });

  it("cleans the edit form and spots names another entry uses", () => {
    const input = normalizeEntityInput("list", { name: "  Gold   Weekly ", aliases: "Gold@Rival.com, gold weekly\nGW", category: "hotlist", notes: "" });
    expect(input).toEqual({ name: "Gold Weekly", aliases: ["gold@rival.com", "GW"], category: "hotlist", notes: null });
    expect(normalizeEntityInput("topic", { name: "Gold", aliases: "", category: "paid", notes: "x" })).toMatchObject({ name: "gold", category: null });
    expect(nameConflict(entries, { id: "e2", kind: "expert", name: "Sam Lee", aliases: ["jane oneil"] })).toContain("Dr. Jane O'Neil");
    expect(nameConflict(entries, { id: "e2", kind: "expert", name: "Samuel", aliases: [] })).toBeNull();
  });
});

// ── Video capture ───────────────────────────────────────────────────────────

describe("video helpers", () => {
  it("detects platforms by host", () => {
    expect(detectPlatform("https://youtu.be/abcdefghijk")).toBe("youtube");
    expect(detectPlatform("https://www.youtube.com/watch?v=abcdefghijk")).toBe("youtube");
    expect(detectPlatform("https://vimeo.com/123456789")).toBe("vimeo");
    expect(detectPlatform("https://fast.wistia.net/embed/iframe/abc123xyz")).toBe("wistia");
    expect(detectPlatform("https://cdn.example.com/vsl.mp4?x=1")).toBe("file");
    expect(detectPlatform("https://offer.example.com/vsl")).toBe("other");
  });

  it("finds embedded players on a sales page, best first", () => {
    const html = `
      <div class="wistia_embed wistia_async_ab12cd34ef videoFoam=true"></div>
      <iframe src="//www.youtube.com/embed/dQw4w9WgXcQ?rel=0"></iframe>
      <iframe src="https://player.vimeo.com/video/76979871?h=8272103f6e&amp;title=0"></iframe>
      <script src="https://fast.vidalytics.com/embeds/AbC123/XyZ789/player.js"></script>
      <video-js data-account="1234567890" data-player="HJx" data-video-id="6300000000001"></video-js>
      <video src="/media/promo.mp4"></video>`;
    const found = findEmbeddedVideos(html, "https://offer.example.com/vsl");
    expect(found.map((video) => video.platform)).toEqual(["youtube", "vimeo", "wistia", "vidalytics", "brightcove", "file"]);
    expect(found[0]!.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(found[1]!.url).toBe("https://player.vimeo.com/video/76979871?h=8272103f6e");
    expect(found[2]!.url).toBe("https://fast.wistia.net/embed/iframe/ab12cd34ef");
    expect(found[4]!.url).toBe("https://players.brightcove.net/1234567890/HJx_default/index.html?videoId=6300000000001");
    expect(found[5]!.url).toBe("https://offer.example.com/media/promo.mp4");
    expect(findEmbeddedVideos("<p>No video here</p>", "https://x.example.com")).toEqual([]);
  });

  it("turns auto-captions into readable text without the rolling repeats", () => {
    const vtt = `WEBVTT
Kind: captions

00:00:00.000 --> 00:00:02.000 align:start position:0%
welcome<00:00:00.500><c> to</c><c> the</c>

00:00:02.000 --> 00:00:04.000
welcome to the

00:00:02.000 --> 00:00:04.000
show &amp; tell

1
00:00:04,000 --> 00:00:05,000
[Music]`;
    expect(captionsToText(vtt)).toBe("welcome to the show & tell");
  });

  it("spaces keyframes through the video", () => {
    expect(keyframeTimes(600, 6)).toEqual([5, 123, 241, 359, 477, 595]);
    expect(keyframeTimes(6, 6)).toEqual([3]);
    expect(keyframeTimes(null, 6)).toEqual([0]);
  });

  it("reads yt-dlp's JSON", () => {
    const probe = parseProbeJson(JSON.stringify({ title: " The Big Reset ", channel: "Rival TV", duration: 1834.6, thumbnail: "https://i.ytimg.com/x.jpg", description: "Order: https://offer.rival.com", automatic_captions: { "en-orig": [{}] } }));
    expect(probe).toEqual({ title: "The Big Reset", uploader: "Rival TV", durationSec: 1835, thumbnailUrl: "https://i.ytimg.com/x.jpg", description: "Order: https://offer.rival.com", hasCaptions: true });
    expect(parseProbeJson(JSON.stringify({ subtitles: { fr: [{}] } })).hasCaptions).toBe(false);
  });

  it("matches a video to a competitor by page host, then by channel name", () => {
    const competitors = [
      { id: "c1", name: "Rival Media", products: ["Rival TV"], websites: ["https://rival.com"], senderDomains: [] },
      { id: "c2", name: "Other", products: [], websites: [], senderDomains: ["offers.rival.com"] },
    ];
    expect(matchVideoCompetitor({ pageUrl: "https://go.offers.rival.com/vsl", uploader: null }, competitors)).toEqual({ competitorId: "c2", matchedBy: "website" });
    expect(matchVideoCompetitor({ pageUrl: "https://www.rival.com/watch", uploader: null }, competitors)).toEqual({ competitorId: "c1", matchedBy: "website" });
    expect(matchVideoCompetitor({ pageUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", uploader: "rival tv" }, competitors)).toEqual({ competitorId: "c1", matchedBy: "channel" });
    expect(matchVideoCompetitor({ pageUrl: "https://elsewhere.com/", uploader: "Nobody" }, competitors)).toBeNull();
  });

  it("reads limits from the environment with safe caps", () => {
    expect(videoLimits({})).toEqual({ maxDurationSec: 7200, maxDownloadBytes: 600 * 1024 * 1024, frames: 6 });
    expect(videoLimits({ INTEL_VIDEO_MAX_MINUTES: "999", INTEL_VIDEO_MAX_MB: "-1" }).maxDurationSec).toBe(240 * 60);
  });

  it("picks a speech-to-text service from the environment", () => {
    expect(sttConfig({})).toBeNull();
    expect(sttConfig({ INTEL_WHISPER_URL: "http://whisper:8000/v1/audio/transcriptions" })).toEqual({ provider: "whisper", url: "http://whisper:8000/v1/audio/transcriptions", apiKey: null, model: "whisper-1" });
    expect(sttConfig({ OPENAI_API_KEY: "sk" })).toMatchObject({ provider: "whisper", url: "https://api.openai.com/v1/audio/transcriptions", apiKey: "sk" });
    expect(sttConfig({ REVAI_ACCESS_TOKEN: "rev" })).toEqual({ provider: "revai", token: "rev" });
    expect(sttConfig({ OPENAI_API_KEY: "sk", REVAI_ACCESS_TOKEN: "rev", INTEL_STT_PROVIDER: "revai" })).toEqual({ provider: "revai", token: "rev" });
    expect(sttConfig({ OPENAI_API_KEY: "sk", INTEL_STT_PROVIDER: "captions" })).toBeNull();
  });
});

describe("speech-to-text clients", () => {
  const chunk = { name: "part-000.mp3", data: new Uint8Array([1, 2, 3]), mime: "audio/mpeg" };
  const reply = (status: number, body: unknown) => ({
    ok: status < 400,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
  });

  it("posts each chunk to a Whisper-compatible endpoint and joins the text", async () => {
    const calls: { url: string; auth?: string; model?: unknown }[] = [];
    const http: HttpLike = async (url, init) => {
      calls.push({ url, auth: init.headers?.Authorization, model: (init.body as FormData).get("model") });
      return reply(200, calls.length === 1 ? "Part one." : '{"text":"Part two."}');
    };
    const text = await whisperTranscribe(http, { provider: "whisper", url: "http://whisper.test/v1/audio/transcriptions", apiKey: null, model: "small" }, [chunk, { ...chunk, name: "part-001.mp3" }]);
    expect(text).toBe("Part one.\n\nPart two.");
    expect(calls).toEqual([
      { url: "http://whisper.test/v1/audio/transcriptions", auth: undefined, model: "small" },
      { url: "http://whisper.test/v1/audio/transcriptions", auth: undefined, model: "small" },
    ]);
    const failing: HttpLike = async () => reply(429, "slow down");
    await expect(whisperTranscribe(failing, { provider: "whisper", url: "http://w", apiKey: "k", model: "m" }, [chunk])).rejects.toThrow("returned 429: slow down");
  });

  it("uploads to Rev AI, polls and reads the plain transcript", async () => {
    const seen: string[] = [];
    let polls = 0;
    const http: HttpLike = async (url, init) => {
      seen.push(`${init.method} ${url.replace("https://api.rev.ai/speechtotext/v1", "")}`);
      if (url.endsWith("/jobs")) return reply(200, { id: "job1", status: "in_progress" });
      if (url.endsWith("/transcript")) return reply(200, "Speaker 0    00:00:01    Hello there.\nSpeaker 0    00:01:05    Buy now.");
      polls += 1;
      return reply(200, { status: polls < 2 ? "in_progress" : "transcribed" });
    };
    const text = await revAiTranscribe(http, { provider: "revai", token: "t" }, [chunk], { sleep: async () => undefined });
    expect(text).toBe("Hello there.\n\nBuy now.");
    expect(seen).toEqual(["POST /jobs", "GET /jobs/job1", "GET /jobs/job1", "GET /jobs/job1/transcript"]);
    expect(cleanRevTranscript("Speaker 1    1:02:03    Hi")).toBe("Hi");
  });
});

function fakeDeps(overrides: Partial<CaptureDeps> = {}) {
  const steps: VideoStep[] = [];
  const calls: string[] = [];
  const deps: CaptureDeps = {
    fetchPage: async (url) => {
      calls.push(`page ${url}`);
      return { finalUrl: url, html: '<iframe src="https://fast.wistia.net/embed/iframe/abc123def"></iframe><h1>Watch</h1>' };
    },
    probe: async (url) => {
      calls.push(`probe ${url}`);
      return { title: "VSL", uploader: null, durationSec: 1200, thumbnailUrl: null, description: null, hasCaptions: false };
    },
    captions: async () => {
      calls.push("captions");
      return "WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nThis is the caption transcript of the promo, long enough to keep.";
    },
    download: async () => {
      calls.push("download");
      return { path: "/tmp/v.mp4", bytes: 1000 };
    },
    audio: async () => {
      calls.push("audio");
      return [{ name: "a.mp3", data: new Uint8Array([1]), mime: "audio/mpeg" }];
    },
    transcribe: async () => {
      calls.push("transcribe");
      return { text: "Spoken words from the speech service.", source: "whisper" };
    },
    frames: async (_path, times) => {
      calls.push(`frames ${times.length}`);
      return times.map((atSec) => ({ atSec, data: new Uint8Array([0xff, 0xd8]) }));
    },
    step: async (step) => {
      steps.push(step);
    },
    ...overrides,
  };
  return { deps, steps, calls };
}

const limits = { maxDurationSec: 3600, maxDownloadBytes: 1e9, frames: 3 };

describe("runCapturePipeline", () => {
  it("reads a sales page, finds the embed, transcribes speech and takes keyframes", async () => {
    const { deps, steps, calls } = fakeDeps();
    const result = await runCapturePipeline(deps, { url: "https://offer.example.com/vsl", limits });
    expect(steps).toEqual(["page", "probe", "download", "audio", "transcribe", "frames"]);
    expect(calls).toEqual(["page https://offer.example.com/vsl", "probe https://fast.wistia.net/embed/iframe/abc123def", "download", "audio", "transcribe", "frames 3"]);
    expect(result).toMatchObject({ mediaUrl: "https://fast.wistia.net/embed/iframe/abc123def", platform: "wistia", transcript: "Spoken words from the speech service.", transcriptSource: "whisper", warnings: [] });
    expect(result.frames.map((frame) => frame.atSec)).toEqual([5, 600, 1195]);
    expect(result.page?.html).toContain("<h1>Watch</h1>");
  });

  it("uses captions when the platform has them and never calls the speech service", async () => {
    const { deps, steps, calls } = fakeDeps({ probe: async () => ({ title: "Talk", uploader: "Rival", durationSec: 300, thumbnailUrl: null, description: null, hasCaptions: true }) });
    const result = await runCapturePipeline(deps, { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", limits });
    expect(steps).toEqual(["probe", "captions", "download", "frames"]);
    expect(calls).not.toContain("transcribe");
    expect(result.transcriptSource).toBe("captions");
    expect(result.transcript).toContain("caption transcript");
  });

  it("refuses a video over the length limit before downloading", async () => {
    const { deps, calls } = fakeDeps({ probe: async () => ({ title: null, uploader: null, durationSec: 4000, thumbnailUrl: null, description: null, hasCaptions: false }) });
    await expect(runCapturePipeline(deps, { url: "https://vimeo.com/123456789", limits })).rejects.toBeInstanceOf(CaptureError);
    expect(calls).not.toContain("download");
  });

  it("finishes without a transcript (and says why) when there are no captions and no speech service", async () => {
    const { deps } = fakeDeps({ transcribe: null });
    const result = await runCapturePipeline(deps, { url: "https://vimeo.com/123456789", limits });
    expect(result.transcript).toBe("");
    expect(result.frames).toHaveLength(3);
    expect(result.warnings[0]).toContain("no speech-to-text service");
  });

  it("keeps the captions when the download fails, and fails when there is nothing", async () => {
    const download = async () => {
      throw new Error("HTTP 403");
    };
    const withCaptions = fakeDeps({ download, probe: async () => ({ title: null, uploader: null, durationSec: 60, thumbnailUrl: null, description: null, hasCaptions: true }) });
    const result = await runCapturePipeline(withCaptions.deps, { url: "https://youtu.be/dQw4w9WgXcQ", limits });
    expect(result.transcriptSource).toBe("captions");
    expect(result.frames).toEqual([]);
    expect(result.warnings[0]).toContain("no keyframes");
    const without = fakeDeps({ download });
    await expect(runCapturePipeline(without.deps, { url: "https://youtu.be/dQw4w9WgXcQ", limits })).rejects.toThrow("could not be downloaded: HTTP 403");
  });

  it("falls back to the page URL when the page has no player, and reports probe failures plainly", async () => {
    const { deps, calls } = fakeDeps({ fetchPage: async (url) => ({ finalUrl: url, html: "<p>text only</p>" }) });
    const result = await runCapturePipeline(deps, { url: "https://offer.example.com/vsl", limits });
    expect(calls[0]).toBe("probe https://offer.example.com/vsl");
    expect(result.warnings[0]).toContain("No video player was found");
    const failing = fakeDeps({
      probe: async () => {
        throw new Error("Unsupported URL");
      },
    });
    await expect(runCapturePipeline(failing.deps, { url: "https://offer.example.com/vsl", limits })).rejects.toThrow("No downloadable video was found: Unsupported URL");
  });

  it("builds the video extraction prompt from the transcript and page links", () => {
    const prompt = videoExtractionPrompt({
      brandContext: "Brand",
      competitorName: "Rival",
      title: "The Reset",
      uploader: null,
      url: "https://offer.example.com/vsl",
      durationSec: 1830,
      transcript: "Hello",
      links: [{ href: "https://offer.example.com/order", text: "Order", count: 1 }],
    });
    expect(prompt).toContain("Length: 31 minutes");
    expect(prompt).toContain('1. "Order" → https://offer.example.com/order');
    expect(prompt).toContain("Transcript:\nHello");
  });
});

// ── Digest ──────────────────────────────────────────────────────────────────

const summary: RadarSummary = {
  weekStart: "2026-11-09",
  weekEnd: "2026-11-15",
  totals: { emails: 14, classified: 12, promos: 3, newPromos: 2, competitors: 2 },
  competitors: [
    {
      key: "c:1",
      competitorId: "1",
      name: "Rival <Media>",
      emails: 9,
      types: { promo: 6 },
      promos: [
        { key: "a", headline: "The *Big* Reset", product: "Reset Report", offer: null, priceText: "$49/yr", experts: ["Jane"], landingUrl: "https://offer.rival.com/reset?a=1&b=2", angles: ["fear"], emailIds: ["m1"], sends: 3, firstSent: "2026-11-09", isNew: true },
        { key: "b", headline: "Old Faithful", product: null, offer: null, priceText: null, experts: [], landingUrl: null, angles: [], emailIds: ["m2"], sends: 1, firstSent: "2026-11-10", isNew: false },
      ],
    },
    {
      key: "c:2",
      competitorId: "2",
      name: "Other Pub",
      emails: 5,
      types: { promo: 1 },
      promos: [{ key: "c", headline: "Gold Rush", product: null, offer: null, priceText: null, experts: [], landingUrl: null, angles: [], emailIds: ["m3"], sends: 1, firstSent: "2026-11-12", isNew: true }],
    },
  ],
  angles: [{ angle: "fear", count: 3, competitors: ["Other Pub", "Rival <Media>"] }],
};

describe("buildDigest", () => {
  it("lists new promos first with stated prices, and escapes Slack and HTML", () => {
    const digest = buildDigest({
      brandName: "Gazette",
      summary,
      narrative: { overview: "Fear & urgency dominated.", themes: [], watch: ["Test a reset angle"] },
      radarUrl: "https://gazette.pubcommand.com/intel/radar?week=2026-11-09",
      videos: [{ title: "VSL", competitorName: "Rival <Media>", type: "promo", headline: "Reset VSL", url: "https://gazette.pubcommand.com/intel/videos/v1" }],
    });
    expect(digest.subject).toBe("Promo Radar for Gazette: Nov 9 – Nov 15, 2026");
    expect(digest.text.split("\n").filter((line) => line.startsWith("- ")).slice(0, 3)).toEqual([
      "- Rival <Media>: The *Big* Reset (new; 3 sends; price as stated: $49/yr; Jane) https://offer.rival.com/reset?a=1&b=2",
      "- Other Pub: Gold Rush (new)",
      "- Rival <Media>: Old Faithful",
    ]);
    expect(digest.text).toContain("Worth watching:\n- Test a reset angle");
    const slack = JSON.stringify(digest.slack.blocks);
    expect(slack).toContain("Rival &lt;Media&gt;");
    expect(slack).toContain("<https://offer.rival.com/reset?a=1&amp;b=2|offer.rival.com>");
    expect(slack).toContain("Fear &amp; urgency dominated.");
    expect(digest.html).toContain("Rival &lt;Media&gt;");
    expect(digest.html).not.toContain("<Media>");
    expect(digest.html).toContain("Reset VSL");
  });

  it("caps the promo list and counts the rest", () => {
    const digest = buildDigest({ brandName: "G", summary, narrative: null, radarUrl: "https://x.example.com", maxPromos: 1 });
    expect(digest.text).toContain("…and 2 more.");
    expect(digest.text).not.toContain("Worth watching");
  });

  it("only accepts Slack incoming webhook URLs and masks them", () => {
    expect(isSlackWebhookUrl("https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXX")).toBe(true);
    expect(isSlackWebhookUrl("http://hooks.slack.com/services/T000/B000/XXXX")).toBe(false);
    expect(isSlackWebhookUrl("https://hooks.slack.com.evil.com/services/T000/B000/XXXXXXXX")).toBe(false);
    expect(isSlackWebhookUrl("https://169.254.169.254/services/T000/B000/XXXXXXXX")).toBe(false);
    expect(maskWebhook("https://hooks.slack.com/services/T000/B000/abcd1234")).toBe("https://hooks.slack.com/…1234");
    expect(parseDigestEmails("a@x.com, A@X.com; bad, b@y.org")).toEqual(["a@x.com", "b@y.org"]);
  });
});

// ── CSV ─────────────────────────────────────────────────────────────────────

describe("csv", () => {
  it("quotes, escapes and defuses formulas", () => {
    expect(csvCell('He said "hi", then left')).toBe('"He said ""hi"", then left"');
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+1 800")).toBe("'+1 800");
    expect(csvCell(["a", "b"])).toBe("a; b");
    expect(csvCell(null)).toBe("");
    expect(csvCell(new Date("2026-11-02T10:00:00Z"))).toBe("2026-11-02T10:00:00.000Z");
    expect(toCsv(["a", "b"], [[1, "x\ny"]])).toBe('﻿a,b\r\n1,"x\ny"\r\n');
  });

  it("exports an email row with its extraction", () => {
    const csv = emailExportCsv([
      {
        id: "m1",
        receivedAt: new Date("2026-11-02T10:00:00Z"),
        competitor: "Rival",
        list: "Morning Edge",
        fromName: "Jane",
        fromAddress: "jane@rival.com",
        subject: "Last chance",
        source: "gmail",
        placement: "PROMOTIONS",
        landingUrl: "https://offer.rival.com",
        landingTitle: "Order",
        extraction: {
          type: "promo",
          summary: "Sells a report.",
          headline: "Reset",
          bigIdea: null,
          hook: null,
          product: "Report",
          offer: null,
          priceText: "$49",
          discount: null,
          guarantee: null,
          experts: ["Jane", "Sam"],
          cta: "Order",
          urgency: { level: "high", tactics: ["deadline"], deadline: "Friday" },
          landingUrl: null,
          angles: ["fear"],
          topics: ["retirement"],
          takeaway: null,
        },
        link: "https://g.example.com/intel/emails/m1",
      },
    ]);
    const [header, row] = csv.replace("﻿", "").trim().split("\r\n");
    expect(header!.split(",").slice(0, 9)).toEqual(["received_at", "competitor", "list", "from_name", "from_address", "subject", "source", "placement", "type"]);
    expect(row).toContain("Jane; Sam");
    expect(row).toContain("https://offer.rival.com");
    expect(row).toContain("high,deadline,Friday");
  });
});
