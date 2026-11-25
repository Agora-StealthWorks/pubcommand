import { stripContentAd } from "../../../../../modules/miniblog/ads";
import { tenantDb } from "@pubcommand/db";
import { teachBrain } from "@/features/brain/teach";
import { postBrainNote } from "../../../../../modules/miniblog/site";
import { formatZoned } from "../../../../../modules/miniblog/time";
import { orgTimezone } from "./data";

/**
 * The Brain key for a post. It stays "tletter-post:<id>" (from when Mini-Blogs
 * were text-letter sites), so re-saving a post refreshes the note it already
 * has instead of writing a duplicate.
 */
export function postSourceRef(postId: string): string {
  return `tletter-post:${postId}`;
}

/** Teach the brand Brain about a published Mini-Blog post. Never phone numbers. Soft-fails. */
export async function teachPost(input: { organizationId: string; postId: string; actorId: string | null }): Promise<void> {
  try {
    const db = tenantDb(input.organizationId);
    const post = await db.textPost.findFirst({ where: { id: input.postId, deletedAt: null } });
    if (!post || post.status !== "published") return;
    const site = await db.textSite.findFirst({ where: { id: post.siteId, deletedAt: null } });
    if (!site || !site.brainSyncEnabled) return;
    const [optins, views, timeZone] = await Promise.all([
      db.textOptin.count({ where: { siteId: site.id } }),
      db.textView.count({ where: { postId: post.id } }),
      orgTimezone(input.organizationId),
    ]);
    const note = postBrainNote({
      siteName: site.name,
      title: post.title,
      publishLabel: formatZoned(post.publishAt, timeZone, { year: true }),
      bodyHtml: stripContentAd(post.bodyHtml),
      actionToTake: post.actionToTake,
      siteOptins: optins,
      postViews: views,
    });
    await teachBrain({
      organizationId: input.organizationId,
      brandId: site.brandId,
      sourceRef: postSourceRef(post.id),
      title: note.title,
      body: note.body,
      folder: "Mini-Blog",
      source: "miniblog",
      actorId: input.actorId,
    });
  } catch (error) {
    console.error("[miniblog] teach post failed", input.postId, error);
  }
}
