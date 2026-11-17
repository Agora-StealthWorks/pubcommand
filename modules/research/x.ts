/**
 * X (Twitter) posts and threads: recognizing the link, reading X's public
 * embed data, and turning a post or thread into source text. No network here.
 */

const STATUS = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter|fixupx|vxtwitter|fxtwitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/i;

export function parsePostUrl(raw: string): { id: string; handle: string; canonical: string } | null {
  const m = STATUS.exec(raw.trim());
  if (!m) return null;
  return { id: m[2]!, handle: m[1]!, canonical: `https://x.com/${m[1]}/status/${m[2]}` };
}

/** X's public embed endpoint wants a token derived from the post id. */
export function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

export function syndicationUrl(id: string): string {
  return `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(id)}&lang=en&token=${syndicationToken(id)}`;
}

export type XPost = {
  id: string;
  text: string;
  author: string;
  handle: string;
  createdAt: string | null;
  /** The post this one replies to, when the embed data includes it. */
  parent: XPost | null;
  /** Long posts come back cut off at the classic length. */
  truncated: boolean;
};

const str = (value: unknown) => (typeof value === "string" ? value : "");

/** Read the embed endpoint's JSON. Returns null when it is not a usable post (deleted, private, blocked). */
export function postFromSyndication(raw: unknown, depth = 0): XPost | null {
  if (!raw || typeof raw !== "object" || depth > 30) return null;
  const j = raw as Record<string, unknown>;
  const user = (j.user && typeof j.user === "object" ? j.user : {}) as Record<string, unknown>;
  const note = j.note_tweet && typeof j.note_tweet === "object" ? (j.note_tweet as Record<string, unknown>) : null;
  const results = note?.note_tweet_results && typeof note.note_tweet_results === "object" ? (note.note_tweet_results as Record<string, unknown>) : null;
  const result = results?.result && typeof results.result === "object" ? (results.result as Record<string, unknown>) : null;
  const noteText = str(result?.text);
  const text = (noteText || str(j.text)).trim();
  const id = str(j.id_str) || str(j.id);
  if (!text || !id) return null;
  return {
    id,
    text,
    author: str(user.name) || "Unknown",
    handle: str(user.screen_name),
    createdAt: str(j.created_at) || null,
    parent: postFromSyndication(j.parent, depth + 1),
    truncated: Boolean(note) && !noteText,
  };
}

/**
 * A thread is the author replying to themselves. Walk up through parents by
 * the same author and return them oldest first; replies to other people stop
 * the walk (they are context, not the author's thread).
 */
export function threadPosts(post: XPost, max = 25): XPost[] {
  const chain: XPost[] = [post];
  let current = post.parent;
  while (current && chain.length < max && current.handle.toLowerCase() === post.handle.toLowerCase()) {
    chain.unshift(current);
    current = current.parent;
  }
  return chain;
}

/** Source text for card extraction: who, when, then the posts in order. */
export function postSourceText(posts: readonly XPost[]): string {
  const first = posts[0]!;
  const when = first.createdAt && !Number.isNaN(Date.parse(first.createdAt)) ? new Date(first.createdAt).toISOString().slice(0, 10) : null;
  const head = [`Author: ${first.author}${first.handle ? ` (@${first.handle})` : ""}`, when ? `Posted: ${when}` : "", posts.length > 1 ? `Thread of ${posts.length} posts` : "", posts.some((p) => p.truncated) ? "Note: part of a long post may be cut off." : ""]
    .filter(Boolean)
    .join("\n");
  const body = posts.length === 1 ? first.text : posts.map((p, i) => `[${i + 1}/${posts.length}] ${p.text}`).join("\n\n");
  return `${head}\n\n${body}`;
}

export function postTitle(post: Pick<XPost, "author" | "handle">, count: number): string {
  return `${post.author}${post.handle ? ` (@${post.handle})` : ""} on X${count > 1 ? ` (thread, ${count} posts)` : ""}`.slice(0, 200);
}

export const X_BLOCKED =
  "We could not read that X post (it may be deleted, private or age-restricted, or X blocked the request). Paste the post or thread text below and add it again.";
