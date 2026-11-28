import { appendPlatformAudit, rawPrisma } from "@pubcommand/db";
import { after } from "next/server";
import { weekStartOf } from "../../../../../modules/intel/index";
import { describeConditions, EMAIL_TYPES, FEEDS, parseConditions, type Feed } from "../../../../../modules/ispy/index";
import { sendIspyToAnalyzer } from "../ispy/analyzer";
import { ispyDb } from "../ispy/db";
import { alerts, feedFacets, FEED_SORTS, getCopy, getEmail, getPromo, listFeed, orgFeeds, promoRadar, RADAR_SORTS, trendWeek, type Viewer } from "../ispy/read";
import { agentCan, type AgentContext } from "./context";
import { ToolError, date, limit, oneOf, str, uuid, type Tool } from "./tool-kit";

/**
 * ISpy for AI agents: the shared feed of what every publisher mails. Read-only.
 * - Organization agents: only when ISpy (module "intel") is on and the agent may read it
 *   (intel.read on one of its brands); they see only the feeds their organization sees, and
 *   "Internal" means that organization's own linked publications.
 * - Platform agents: both feeds, plus the Unsorted queue and new-list candidates, and
 *   ispy_send_to_analyzer (into the console workspace's Promo Analyzer, audited).
 * List approval, merges and routing-rule edits stay with people in the console.
 */

const KINDS = ["INTERNAL", "EXTERNAL", "AFFILIATE"] as const;
const DIRS = ["asc", "desc"] as const;
const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);
const day = (value: Date | null | undefined) => (value ? value.toISOString().slice(0, 10) : null);

const orgReadable = (ctx: AgentContext) => ctx.scope === "organization" && ctx.subject.entitledModuleIds.includes("intel") && ctx.brands.some((brand) => agentCan(ctx, "intel.read", brand.id));
const available = (ctx: AgentContext) => ctx.scope === "platform" || orgReadable(ctx);
const platform = (ctx: AgentContext) => ctx.scope === "platform";

async function viewerFor(ctx: AgentContext): Promise<Viewer> {
  if (ctx.scope === "platform") return { orgId: null, feeds: [...FEEDS] };
  if (!orgReadable(ctx)) throw new ToolError("ISpy is not turned on for this organization, or you do not have intel.read. Ask an admin.");
  const feeds = await orgFeeds(ctx.organization.id);
  if (!feeds.length) throw new ToolError("This organization has no ISpy feed. PubCommand staff can grant one.");
  return { orgId: ctx.organization.id, feeds };
}

function feedArg(args: Record<string, unknown>, viewer: Viewer, required: boolean): Feed | null {
  const feed = oneOf(args, "feed", FEEDS);
  if (feed && !viewer.feeds.includes(feed)) throw new ToolError(`Your organization does not see the ${feed} feed. Feeds you see: ${viewer.feeds.join(", ")}.`);
  if (!feed && required) return viewer.feeds[0]!;
  return feed ?? null;
}

function weekArg(args: Record<string, unknown>): Date {
  const value = date(args, "week");
  return weekStartOf(value ?? new Date());
}

function pageArg(args: Record<string, unknown>): number {
  const value = Number(args.page ?? 1);
  return Number.isFinite(value) ? Math.max(1, Math.min(1000, Math.round(value))) : 1;
}

const feedProp = { feed: { type: "string", enum: [...FEEDS], description: "FINPUB or HEALTH (default: every feed you see)." } };
const idProp = (what: string) => ({ id: { type: "string", description: `The ${what} id (from ispy_feed or another ispy_ tool).` } });
const weekProp = { week: { type: "string", description: "Any date in the week (ISO 8601). Default: this week. Weeks start Monday." } };

function ruleText(conditions: unknown): string {
  return describeConditions(parseConditions(conditions));
}

const shared: Tool[] = [
  {
    name: "ispy_feed",
    title: "ISpy feed",
    description:
      "Emails every publisher sent, from ISpy's shared inboxes. Filter by feed, kind (INTERNAL = your organization's own publications, EXTERNAL = other publishers, AFFILIATE = affiliate lists like MarketBeat), type (EDITORIAL, PROMO, INTERNAL_LIFT, EXTERNAL_LIFT, WELCOME, OTHER), publisher, publication, list, guru, topic, text and dates. Sort by date, type, sender, subject or seen (how many times the same copy was detected). Each row has copy_id (for ispy_copy) and promo_id (for ispy_promo).",
    inputSchema: {
      type: "object",
      properties: {
        ...feedProp,
        kind: { type: "string", enum: [...KINDS] },
        type: { type: "string", enum: [...EMAIL_TYPES] },
        publisher_id: { type: "string" },
        publication_id: { type: "string" },
        list_id: { type: "string" },
        guru_id: { type: "string" },
        topic: { type: "string", description: "A topic label, lowercase (e.g. \"ai stocks\")." },
        q: { type: "string", description: "Text search in subject, sender and body." },
        from: { type: "string", description: "Received on or after (ISO 8601)." },
        to: { type: "string", description: "Received on or before (ISO 8601)." },
        resent_only: { type: "boolean", description: "Only copy that was sent more than once." },
        sort: { type: "string", enum: [...FEED_SORTS], description: "Default date." },
        dir: { type: "string", enum: [...DIRS], description: "Default desc." },
        page: { type: "integer", minimum: 1 },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Rows per page (default 25)." },
      },
      additionalProperties: false,
    },
    readOnly: true,
    available,
    run: async (ctx, args) => {
      const viewer = await viewerFor(ctx);
      const result = await listFeed(viewer, {
        feed: feedArg(args, viewer, false),
        kind: oneOf(args, "kind", KINDS) ?? null,
        type: oneOf(args, "type", EMAIL_TYPES) ?? null,
        publisherId: uuid(args, "publisher_id", false) ?? null,
        publicationId: uuid(args, "publication_id", false) ?? null,
        listId: uuid(args, "list_id", false) ?? null,
        guruId: uuid(args, "guru_id", false) ?? null,
        topic: str(args, "topic", 80) ?? null,
        q: str(args, "q", 200) ?? null,
        from: date(args, "from") ?? null,
        to: date(args, "to") ?? null,
        resentOnly: args.resent_only === true,
        sort: oneOf(args, "sort", FEED_SORTS, "date"),
        dir: oneOf(args, "dir", DIRS, "desc"),
        page: pageArg(args),
        pageSize: limit(args, 25),
      });
      return {
        data: {
          total: result.total,
          page: result.page,
          page_size: result.pageSize,
          has_more: result.page * result.pageSize < result.total,
          emails: result.rows.map((r) => ({
            id: r.id,
            received_at: iso(r.receivedAt),
            type: r.emailType,
            kind: r.kind,
            subject: r.subject,
            from: r.fromName ? `${r.fromName} <${r.fromAddress}>` : r.fromAddress,
            publisher: r.publisher,
            publication: r.publication,
            list: r.list,
            advertiser: r.advertiser,
            seen: r.seen,
            subjects: r.subjects,
            reuse: r.reuse,
            new_promo: r.isNewPromo,
            copy_id: r.copyId,
            promo_id: r.promoId,
          })),
        },
      };
    },
  },
  {
    name: "ispy_email",
    title: "ISpy email",
    description: "One email from the ISpy feed: text, links, type, why it was routed to its list (the routing rule), sender and deliverability facts (email platform, campaign id, List-Id, SPF/DKIM/DMARC, spam score), its copy and its promo.",
    inputSchema: { type: "object", properties: { ...idProp("email") }, required: ["id"], additionalProperties: false },
    readOnly: true,
    available,
    run: async (ctx, args) => {
      const viewer = await viewerFor(ctx);
      const e = await getEmail(viewer, uuid(args, "id")!);
      if (!e) throw new ToolError("No email with that id in your feed.");
      const links = Array.isArray(e.links) ? (e.links as { href?: string; text?: string }[]).slice(0, 40).map((l) => ({ href: l.href, text: l.text })) : [];
      const meta = (e.providerMeta ?? null) as Record<string, unknown> | null;
      return {
        data: {
          id: e.id,
          feed: e.feed,
          received_at: iso(e.receivedAt),
          subject: e.subject,
          from: e.fromName ? `${e.fromName} <${e.fromAddress}>` : e.fromAddress,
          type: e.emailType,
          send_kind: e.sendKind,
          publisher: e.publisher?.name ?? null,
          publication: e.publication?.name ?? null,
          list: e.list ? { id: e.list.id, name: e.list.name, type: e.list.category } : null,
          routing: { status: e.routeStatus, reason: e.routeReason, arrived_at: e.receivedInbox?.address ?? null, now_in: e.inbox?.address ?? null, rule: e.rule ? { priority: e.rule.priority, action: e.rule.action, when: ruleText(e.rule.conditions) } : null },
          sender: { email_platform: e.espName, campaign_id: e.campaignId, list_id_header: e.listIdHeader, auth: e.authResults, sending_ip: e.sendingIp, spam_score: e.spamScore, placement: e.placement },
          provider: meta ? { provider: meta.provider ?? null, labels: meta.labels ?? meta.labelIds ?? null, trust_level: meta.trust_level ?? null } : null,
          topics: e.topics,
          gurus: e.gurus,
          copy: e.copy ? { id: e.copy.id, title: e.copy.title, sends: e.copy.sendCount, subjects: e.copy.subjectCount } : null,
          promo: e.promo ? { id: e.promo.id, headline: e.promo.headline, landing_url: e.promo.landingUrl } : null,
          text: e.textBody.slice(0, 20_000),
          text_truncated: e.textBody.length > 20_000,
          links,
        },
        targetType: "ispy_email",
        targetId: e.id,
      };
    },
  },
  {
    name: "ispy_copy",
    title: "ISpy copy (sent before?)",
    description: "One copy: the same email body however many times it was sent and under whatever subjects. Returns every send (date, list, publisher, kind, subject, whether the subject was new, how it matched), key takeaways, the offer, topics and gurus, and the copy text.",
    inputSchema: { type: "object", properties: { ...idProp("copy") }, required: ["id"], additionalProperties: false },
    readOnly: true,
    available,
    run: async (ctx, args) => {
      const viewer = await viewerFor(ctx);
      const found = await getCopy(viewer, uuid(args, "id")!);
      if (!found) throw new ToolError("No copy with that id in your feed.");
      const { copy } = found;
      return {
        data: {
          id: copy.id,
          title: copy.title,
          feed: copy.feed,
          type: copy.emailType,
          first_seen: iso(copy.firstSeenAt),
          first_seen_kind: copy.firstSeenKind,
          last_seen: iso(copy.lastSeenAt),
          sends: copy.sendCount,
          lists: copy.listCount,
          affiliates: copy.affiliateCount,
          subjects: copy.subjectCount,
          promo: found.promo ? { id: found.promo.id, headline: found.promo.headline, advertiser: found.promo.advertiserLabel ?? found.promo.advertiser.label } : null,
          takeaways: copy.extraction?.takeaways ?? [],
          offer: copy.extraction?.offer ?? null,
          topics: copy.extraction?.topics ?? [],
          gurus: copy.extraction?.gurus ?? [],
          promoted_brand: copy.extraction?.promotedBrand ?? null,
          send_timeline: found.sends.map((s) => ({ email_id: s.id, received_at: iso(s.receivedAt), list: s.list, publisher: s.publisher, kind: s.kind, subject: s.subject, new_subject: s.newSubject, match: s.match })),
          text: found.text.slice(0, 20_000),
        },
        targetType: "ispy_copy",
        targetId: copy.id,
      };
    },
  },
  {
    name: "ispy_promo",
    title: "ISpy promo",
    description: "One promo (one landing page, however many tracking links reached it): advertiser, headline, kind (VSL, lead-gen, equity raise, event), first and last seen, days detected, sends, the other URLs merged into it, whether a transcript or text version is linked from the page, every sighting (date, publisher, list, kind, subject) and the copies that pushed it.",
    inputSchema: { type: "object", properties: { ...idProp("promo") }, required: ["id"], additionalProperties: false },
    readOnly: true,
    available,
    run: async (ctx, args) => {
      const viewer = await viewerFor(ctx);
      const found = await getPromo(viewer, uuid(args, "id")!);
      if (!found) throw new ToolError("No promo with that id in your feed.");
      const { promo, landing } = found;
      return {
        data: {
          id: promo.id,
          feed: promo.feed,
          headline: promo.headline,
          advertiser: promo.advertiserLabel ?? promo.advertiser.label,
          advertiser_domain: promo.advertiser.domain,
          kind: promo.kind,
          landing_url: promo.landingUrl,
          first_seen: day(promo.firstSeenOn),
          last_seen: day(promo.lastSeenOn),
          days_detected: promo.daysDetected,
          sends: promo.sendCount,
          affiliates: promo.affiliateCount,
          also_reached_by: found.aliases.map((a) => ({ key: a.key, how: a.source })),
          transcript: landing ? { status: landing.transcriptStatus, url: landing.transcriptUrl, link_text: landing.transcriptLinkText } : { status: "NOT_DETECTED", url: null, link_text: null },
          landing_text: landing?.text ? landing.text.slice(0, 8000) : null,
          copies: found.copies.map((c) => ({ id: c.id, title: c.title, sends: c.sendCount })),
          sightings: found.sightings.slice(-200).map((s) => ({ day: day(s.day), publisher: s.publisher, list: s.list, kind: s.sendKind, subject: s.subject, email_id: s.emailId, first_ever: s.isFirstEver })),
        },
        targetType: "ispy_promo",
        targetId: promo.id,
      };
    },
  },
  {
    name: "ispy_promos",
    title: "ISpy Promo Radar",
    description: "Promo Radar for one week: every promo seen that week (one row per landing page), new ones flagged. Sort by first (first seen), headline, advertiser, kind, days (days detected), sends, affiliates or last (last seen).",
    inputSchema: {
      type: "object",
      properties: { ...feedProp, ...weekProp, sort: { type: "string", enum: [...RADAR_SORTS], description: "Default first." }, dir: { type: "string", enum: [...DIRS] }, only_new: { type: "boolean" }, limit: { type: "integer", minimum: 1, maximum: 100 } },
      additionalProperties: false,
    },
    readOnly: true,
    available,
    run: async (ctx, args) => {
      const viewer = await viewerFor(ctx);
      const feed = feedArg(args, viewer, true)!;
      const weekStart = weekArg(args);
      const radar = await promoRadar(viewer, { feed, weekStart, sort: oneOf(args, "sort", RADAR_SORTS, "first"), dir: oneOf(args, "dir", DIRS, "desc"), onlyNew: args.only_new === true });
      return {
        data: {
          feed,
          week_start: day(weekStart),
          new: radar.newCount,
          running: radar.running,
          promos: radar.promos.slice(0, limit(args, 50)).map((p) => ({ id: p.id, headline: p.headline, advertiser: p.advertiserName, kind: p.kind, first_seen: day(p.firstSeenOn), last_seen: day(p.lastSeenOn), days_detected: p.daysDetected, sends: p.sendCount, affiliates: p.affiliateCount, is_new: p.isNew, landing_url: p.landingUrl })),
        },
      };
    },
  },
  {
    name: "ispy_trends",
    title: "ISpy niche trends",
    description: "Niche-wide trends for one feed and week: hot topics (share of emails, vs the week before), new promos, most-lifted advertisers, affiliate drops, offer and price mix, share of voice by publisher and guru, longest-running promos and most re-sent copy, plus a short written read.",
    inputSchema: { type: "object", properties: { ...feedProp, ...weekProp }, additionalProperties: false },
    readOnly: true,
    available,
    run: async (ctx, args) => {
      const viewer = await viewerFor(ctx);
      const feed = feedArg(args, viewer, true)!;
      const weekStart = weekArg(args);
      const week = await trendWeek(viewer, feed, weekStart);
      if (!week) return { data: { feed, week_start: day(weekStart), ready: false, message: "No trends built for that week yet. They are built on Mondays for the week before." } };
      return { data: { feed, week_start: day(week.weekStart), ready: true, narrative: week.narrative, stats: week.stats } };
    },
  },
  {
    name: "ispy_registry",
    title: "ISpy publishers, lists and gurus",
    description:
      "ISpy's registry. With q: search publishers, publications, lists (with their type: free editorial, paid editorial, hotlist, marketing file) and gurus by name. Without q: the linked dropdowns, narrowed by any of publisher_id, publication_id, list_id, guru_id (picking a guru shows only its lists and publications, and so on). Ids feed ispy_feed's filters.",
    inputSchema: {
      type: "object",
      properties: { q: { type: "string" }, publisher_id: { type: "string" }, publication_id: { type: "string" }, list_id: { type: "string" }, guru_id: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } },
      additionalProperties: false,
    },
    readOnly: true,
    available,
    run: async (ctx, args) => {
      const viewer = await viewerFor(ctx);
      const q = str(args, "q", 100)?.trim();
      const take = limit(args, 25);
      if (!q) {
        const options = await feedFacets(viewer, {
          publisherId: uuid(args, "publisher_id", false) ?? null,
          publicationId: uuid(args, "publication_id", false) ?? null,
          listId: uuid(args, "list_id", false) ?? null,
          guruId: uuid(args, "guru_id", false) ?? null,
        });
        return { data: { publishers: options.publishers.slice(0, take), publications: options.publications.slice(0, take), lists: options.lists.slice(0, take), gurus: options.gurus.slice(0, take) } };
      }
      const name = { contains: q, mode: "insensitive" as const };
      const hidden = viewer.orgId ? { NOT: { hideFromOtherOrgs: true, linkedOrganizationId: { not: viewer.orgId } } } : {};
      const data = await ispyDb(async (tx) => {
        const [publishers, publications, lists, gurus] = await Promise.all([
          tx.ispyPublisher.findMany({ where: { deletedAt: null, feed: { in: viewer.feeds }, name, ...hidden }, take, orderBy: { name: "asc" }, select: { id: true, name: true, type: true, feed: true, domains: true, parent: { select: { name: true } } } }),
          tx.ispyPublication.findMany({ where: { deletedAt: null, name, publisher: { feed: { in: viewer.feeds }, ...hidden } }, take, orderBy: { name: "asc" }, select: { id: true, name: true, publisher: { select: { id: true, name: true } } } }),
          tx.ispyList.findMany({ where: { deletedAt: null, OR: [{ name }, { synonyms: { has: q } }], publisher: { feed: { in: viewer.feeds }, ...hidden } }, take, orderBy: { name: "asc" }, select: { id: true, name: true, category: true, isIgnored: true, publisher: { select: { id: true, name: true } }, publication: { select: { id: true, name: true } } } }),
          tx.ispyGuru.findMany({ where: { feed: { in: viewer.feeds }, OR: [{ name }, { aliases: { has: q } }] }, take, orderBy: { name: "asc" }, select: { id: true, name: true, isIgnored: true, publisher: { select: { name: true } }, publications: { select: { role: true, publication: { select: { id: true, name: true } } } } } }),
        ]);
        return {
          publishers: publishers.map((p) => ({ id: p.id, name: p.name, type: p.type, feed: p.feed, group: p.parent?.name ?? null, domains: p.domains })),
          publications: publications.map((p) => ({ id: p.id, name: p.name, publisher: p.publisher })),
          lists: lists.map((l) => ({ id: l.id, name: l.name, type: l.category, ignored: l.isIgnored, publisher: l.publisher, publication: l.publication })),
          gurus: gurus.map((g) => ({ id: g.id, name: g.name, ignored: g.isIgnored, publisher: g.publisher?.name ?? null, publications: g.publications.map((x) => ({ ...x.publication, role: x.role })) })),
        };
      });
      return { data };
    },
  },
  {
    name: "ispy_routing",
    title: "ISpy routing rules",
    description: "The routing rules that decide which list an email belongs to, for one publisher or publication (first match by priority wins): what each rule checks, what it does, which list it routes to, and how many emails it matched. Read-only; staff edit rules in the console.",
    inputSchema: { type: "object", properties: { publisher_id: { type: "string" }, publication_id: { type: "string" } }, additionalProperties: false },
    readOnly: true,
    available,
    run: async (ctx, args) => {
      const viewer = await viewerFor(ctx);
      const publisherId = uuid(args, "publisher_id", false);
      const publicationId = uuid(args, "publication_id", false);
      if (!publisherId && !publicationId) throw new ToolError("Give publisher_id or publication_id (from ispy_registry).");
      const data = await ispyDb(async (tx) => {
        const publication = publicationId ? await tx.ispyPublication.findUnique({ where: { id: publicationId }, select: { id: true, name: true, publisherId: true } }) : null;
        const pid = publisherId ?? publication?.publisherId ?? null;
        const publisher = pid ? await tx.ispyPublisher.findUnique({ where: { id: pid }, select: { id: true, name: true, feed: true, hideFromOtherOrgs: true, linkedOrganizationId: true } }) : null;
        if (!publisher || !viewer.feeds.includes(publisher.feed as Feed) || (viewer.orgId && publisher.hideFromOtherOrgs && publisher.linkedOrganizationId !== viewer.orgId)) return null;
        const rules = await tx.ispyRoutingRule.findMany({
          where: { OR: [{ publisherId: publisher.id, ...(publication ? { OR: [{ publicationId: null }, { publicationId: publication.id }] } : {}) }, ...(publication ? [{ publicationId: publication.id }] : [])] },
          orderBy: [{ priority: "asc" }, { id: "asc" }],
          take: 200,
        });
        const lists = await tx.ispyList.findMany({ where: { id: { in: rules.map((r) => r.listId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
        const listName = new Map(lists.map((l) => [l.id, l.name]));
        return {
          publisher: { id: publisher.id, name: publisher.name },
          publication: publication ? { id: publication.id, name: publication.name } : null,
          rules: rules.map((r) => ({ id: r.id, priority: r.priority, enabled: r.enabled, when: ruleText(r.conditions), action: r.action, list: r.listId ? listName.get(r.listId) ?? null : null, hits: r.hits, last_hit: iso(r.lastHitAt), origin: r.origin })),
        };
      });
      if (!data) throw new ToolError("No publisher or publication with that id in your feed.");
      return { data };
    },
  },
  {
    name: "ispy_alerts",
    title: "ISpy alerts",
    description: "Recent alerts: copy first sent on a publisher's own list and now mailed through an affiliate, copy re-sent with a new subject, promos with a frequency spike (5+ sends in two days), and inboxes that went silent.",
    inputSchema: { type: "object", properties: { ...feedProp }, additionalProperties: false },
    readOnly: true,
    available,
    run: async (ctx, args) => {
      const viewer = await viewerFor(ctx);
      const a = await alerts(viewer, feedArg(args, viewer, false));
      return {
        data: {
          reused_on_affiliates: a.reusedToAffiliate.map((c) => ({ copy_id: c.id, title: c.title, first_seen_kind: c.firstSeenKind, first_seen: iso(c.firstSeenAt) })),
          new_subjects: a.newSubjects.map((c) => ({ copy_id: c.id, title: c.title, subjects: c.subjectCount, sends: c.sendCount })),
          frequency_spikes: a.spikes.map((p) => ({ promo_id: p.id, headline: p.headline, sends_last_two_days: p.sends })),
          silent_inboxes: viewer.orgId ? undefined : a.silent.map((i) => ({ address: i.address, list: i.list?.name ?? null, publication: i.publication?.name ?? null, last_mail: iso(i.lastMessageAt) })),
        },
      };
    },
  },
];

const platformOnly: Tool[] = [
  {
    name: "ispy_unsorted",
    title: "ISpy Unsorted queue",
    description: "Platform agents: emails ISpy could not place on a list (UNSORTED) or that wait on a new-list candidate (CANDIDATE), newest first, with the reason.",
    inputSchema: { type: "object", properties: { ...feedProp, status: { type: "string", enum: ["UNSORTED", "CANDIDATE"] }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const feed = oneOf(args, "feed", FEEDS);
      const status = oneOf(args, "status", ["UNSORTED", "CANDIDATE"] as const);
      const rows = await ispyDb((tx) =>
        tx.ispyEmail.findMany({
          where: { routeStatus: status ? status : { in: ["UNSORTED", "CANDIDATE"] }, ...(feed ? { feed } : {}) },
          orderBy: { receivedAt: "desc" },
          take: limit(args, 25),
          select: { id: true, receivedAt: true, subject: true, fromAddress: true, fromName: true, routeStatus: true, routeReason: true, feed: true, receivedInbox: { select: { address: true } } },
        }),
      );
      return { data: { emails: rows.map((e) => ({ id: e.id, received_at: iso(e.receivedAt), feed: e.feed, subject: e.subject, from: e.fromName ? `${e.fromName} <${e.fromAddress}>` : e.fromAddress, status: e.routeStatus, reason: e.routeReason, arrived_at: e.receivedInbox?.address ?? null })) } };
    },
  },
  {
    name: "ispy_list_candidates",
    title: "ISpy lists waiting for approval",
    description: "Platform agents: lists ISpy detected but that wait for staff approval (ISpy never creates a list on its own): proposed name and type, publisher, signals, proposed rule and how many emails wait. Staff approve, merge or reject them in the console.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false },
    readOnly: true,
    available: platform,
    run: async (_ctx, args) => {
      const rows = await ispyDb(async (tx) => {
        const candidates = await tx.ispyListCandidate.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: limit(args, 25) });
        const pubs = await tx.ispyPublisher.findMany({ where: { id: { in: candidates.map((c) => c.publisherId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
        const names = new Map(pubs.map((p) => [p.id, p.name]));
        return candidates.map((c) => ({ id: c.id, proposed_name: c.proposedName, proposed_type: c.proposedType, publisher: c.publisherId ? names.get(c.publisherId) ?? null : null, signals: c.signals, proposed_rule: ruleText(c.proposedRule), emails_waiting: c.emailCount, first_seen: iso(c.createdAt) }));
      });
      return { data: { candidates: rows } };
    },
  },
  {
    name: "ispy_send_to_analyzer",
    title: "Send an ISpy promo or copy to Promo Analyzer",
    description: "Platform agents with \"Can make admin changes\": copy an ISpy promo (landing page text, or the linked transcript) or copy (email text) into the console workspace's Promo Analyzer and start the analysis. Sending the same item again returns the first promo. Audited.",
    inputSchema: { type: "object", properties: { target: { type: "string", enum: ["promo", "copy"] }, id: { type: "string" } }, required: ["target", "id"], additionalProperties: false },
    readOnly: false,
    available: (ctx) => ctx.scope === "platform" && ctx.allowAdminActions,
    run: async (ctx, args) => {
      if (ctx.scope !== "platform" || !ctx.allowAdminActions) throw new ToolError("This platform agent cannot make admin changes (read-only).");
      const target = oneOf(args, "target", ["promo", "copy"] as const)!;
      const id = uuid(args, "id")!;
      const brand = ctx.brands[0];
      if (!brand) throw new ToolError("The console workspace has no brand yet.");
      const full = await rawPrisma().$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        return tx.brand.findUnique({ where: { id: brand.id }, select: { id: true, name: true, niche: true, audience: true, complianceNotes: true } });
      });
      if (!full) throw new ToolError("The console workspace brand was not found.");
      const sent = await sendIspyToAnalyzer({ viewer: { orgId: ctx.organization.id, feeds: [...FEEDS] }, brand: full, targetType: target === "promo" ? "PROMO" : "COPY", targetId: id, actorId: ctx.agent.userId });
      if ("error" in sent) throw new ToolError(sent.error);
      after(() => sent.start());
      await appendPlatformAudit({ actorId: ctx.agent.userId, action: "ispy.sent_to_analyzer", targetType: target === "promo" ? "ispy_promo" : "ispy_copy", targetId: id, metadata: { promoId: sent.promoId, agentId: ctx.agent.id } });
      return { data: { promo_id: sent.promoId, message: "Sent to the console's Promo Analyzer. The analysis runs in the background." }, targetType: "promo", targetId: sent.promoId };
    },
  },
];

export const ISPY_TOOLS: Tool[] = [...shared, ...platformOnly];
