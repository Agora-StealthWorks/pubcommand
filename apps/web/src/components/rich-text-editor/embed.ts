/**
 * Video embeds in rich text. Only these players are allowed, both in the
 * editor and in the sanitizer, so pasted embed code can never load anything else.
 */
export const EMBED_HOSTS = ["www.youtube-nocookie.com", "www.youtube.com", "player.vimeo.com", "fast.wistia.net", "www.loom.com"] as const;

/**
 * A share link or embed link → the player URL we embed, or null when it is not
 * a supported video. YouTube becomes youtube-nocookie.
 */
export function embedSrc(input: string): string | null {
  const text = input.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^m\./, "www.");
  const id = (value: string | null | undefined, pattern: RegExp) => (value && pattern.test(value) ? value : null);
  const yt = /^[A-Za-z0-9_-]{11}$/;
  if (host === "youtu.be") {
    const video = id(url.pathname.slice(1).split("/")[0], yt);
    return video ? `https://www.youtube-nocookie.com/embed/${video}` : null;
  }
  if (host === "www.youtube.com" || host === "youtube.com" || host === "www.youtube-nocookie.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const video = parts[0] === "watch" ? id(url.searchParams.get("v"), yt) : ["embed", "shorts", "live", "v"].includes(parts[0] ?? "") ? id(parts[1], yt) : null;
    return video ? `https://www.youtube-nocookie.com/embed/${video}` : null;
  }
  if (host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") {
    const video = url.pathname.split("/").filter(Boolean).find((part) => /^\d{5,12}$/.test(part));
    return video ? `https://player.vimeo.com/video/${video}` : null;
  }
  if (host.endsWith(".wistia.com") || host.endsWith(".wistia.net") || host === "wistia.com") {
    const match = /\/(?:medias|iframe|embed\/iframe)\/([a-z0-9]{6,20})/i.exec(url.pathname);
    return match ? `https://fast.wistia.net/embed/iframe/${match[1]!.toLowerCase()}` : null;
  }
  if (host === "www.loom.com" || host === "loom.com") {
    const match = /\/(?:share|embed)\/([a-f0-9]{16,40})/i.exec(url.pathname);
    return match ? `https://www.loom.com/embed/${match[1]!.toLowerCase()}` : null;
  }
  return null;
}
