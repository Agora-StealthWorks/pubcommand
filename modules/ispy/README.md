# ISpy

What every publisher mails, in one shared feed for every organization that has the app. Two feeds: **FinPub** and **Health**. The app is the `intel` module (route `/intel`, permissions `intel.read` / `intel.write`, plan entitlement `intel`), shown as **ISpy**. An organization's own private uploads, Gmail and videos from the old Competitors app live on under **My captures** (see `modules/intel/README.md`).

## Who sees what
- An organization sees the feed that matches its brands' niche (finance or general → FinPub, health → Health). Staff can grant or block a feed per organization in Admin → ISpy → Access.
- Mail from a publication or publisher **linked** to an organization is **Internal** for that organization and External for everyone else (it is public marketing mail). Staff can hide a publisher from other organizations.
- **Affiliate** sends are mail from affiliate marketing files (MarketBeat and others), credited to the advertiser on the landing page.
- Org members read; `intel.write` can also send to Promo Analyzer and report "not a promo" / "duplicate". Everything else (registry, inboxes, rules, approvals) is staff-only in the console (`platform.ispy.manage`, given to OPS and super admins).
- Agents read the same data through the `ispy_*` tools (`docs/AI-AGENTS.md`), limited to the organization's feeds.

## Org app screens (`/intel`)
- **Feed**: tabs Internal / External / Affiliate Lists. Filters: type, publisher, publication, list, guru, topic, dates, "re-sent only", search. Publisher, publication, list and guru narrow each other (picking a guru shows only that guru's lists and publications). Every column sorts: date, type, sender, subject, times seen. Sidebar: this week's numbers and alerts (reused copy, internal → affiliate, frequency spikes, silent lists).
- **Email** (`/intel/mail/<id>`): the email with images always shown through PubCommand's image proxy (tracking pixels removed, publishers never see the reader), "Why is this email here?" (inbox it arrived at, the routing rule, the list), sender and deliverability (email platform, campaign ID, List-Id, SPF/DKIM/DMARC, sending IP, spam score), links, raw provider data.
- **Copy** (`/intel/copies/<id>`): one email body however many times it was sent: send timeline (date, list, kind, subject, new-subject flag, how it matched), key takeaways, offer, topics, the Brain note. Send to Promo Analyzer, Report.
- **Promo** (`/intel/promos/<id>`): the landing page (headline, text, snapshot), why ISpy treats several links as one promo (aliases), transcript link or "not detected", sightings timeline, copies that pushed it, Send to Promo Analyzer, Report.
- **Promo Radar** (`/intel/promos`) and **Trends** (`/intel/trends`): a week's promos (sortable: first seen, days, sends, affiliates…) and niche-wide trends with one short AI paragraph.

## Console screens (`admin.<root>/ispy`)
Overview, Publications (group → publisher → publication → lists → inboxes; link to an organization, brand and Publication Setup record; list type), Affiliate Lists, Gurus, Inboxes & routing (rules, test on the last 200 emails, re-route history, Unsorted), New lists to approve, Reports, Promos (merge, not a promo), Copies (type override, merge), Access, Import, Settings (digest, silence threshold, MachineMail webhook).

## How mail gets in
- **MachineMail** (`api.machinemail.dev/v0`, AgentMail-compatible). Inboxes are permanent. Three levels: an optional **publisher catch-all** (a custom domain with catch-all on; `<publisher>+anything@` addresses are adopted under it), a **publication** inbox, and a **list** inbox. A webhook (`/api/ispy/inbound/machinemail`, signed `X-MachineMail-Signature`) stores new mail at once; `ispy.inbox-poll` catches anything missed. Messages in MachineMail's spam, quarantine and unauthenticated folders are read too.
- **Legacy Gmail**: iSpy's two Gmail inboxes and the MarketBeat seed, until every list has its own inbox (`ispy.gmail-sync`, OAuth through the Intel callback).
- **Generic inbound**: `POST /api/ispy/inbound?to=<address>` with the raw message and `Authorization: Bearer $ISPY_INBOUND_SECRET`, for any inbound-mail service.
- When an organization with ISpy creates a publication in Publication Setup, ISpy adds it to the registry (as Internal, linked to that brand) and creates its publication inbox.

## Routing (which list)
1. Mail to a list's own inbox belongs to that list. Mail to an affiliate seed inbox belongs to that affiliate's marketing file.
2. Otherwise the first enabled **routing rule** that matches, by priority. Conditions (all must match): from address, from domain (subdomains count), from name, subject, masthead / first lines, List-Id, any header, body, the inbox it arrived at, campaign ID. Actions: route to a list, mark as affiliate file, ignore. Staff see each rule's hits, test a rule on the last 200 emails without changing anything, and re-route history.
3. Otherwise an existing list whose name or synonym matches the masthead or sender.
4. Otherwise, if it looks like a new list, a **candidate** waits in New lists to approve; else it is Unsorted. **ISpy never creates a list by itself.** Approving picks the list type (Free editorial, Paid editorial, Hotlist, Marketing file), saves the rule, creates the list's own inbox and moves the waiting mail. Routed mail is moved to its list's inbox (`receivedInboxId` keeps where it arrived).

## Copies: "has this been sent before?"
- Every email is one send of a **copy**. The body is normalised (greeting, names, emails, tracking links, dates and footer removed) and fingerprinted: an exact hash, a SimHash, and a shingle comparison that still matches when an editor's note or P.S. is added. The same ESP campaign ID also means the same copy. The subject is ignored, so a re-send with a new subject is the same copy.
- A copy records first seen (and whether that was internal, external or affiliate), every send date, lists, affiliates and subjects. Alerts: new subject on the same copy, copy that moved from a publisher's own list to an affiliate, frequency spikes.

## Email types
Editorial, Promo, **Internal lift**, **External lift**, Welcome, Other. Decided by who owns the landing page: the sending publication's own product → Promo; another publication of the same publisher or group (an Oxford Club promo on a Trade of the Day list) → Internal lift; another company (a Paradigm lift on an MTA list) → External lift. When the page can't be read, the AI's hint and the promoted brand it names decide. Staff can correct a copy's type; every send of it follows.

## Promos: new by landing page, not by link
Each email's links are followed through every redirect (SSRF-guarded, meta-refresh and JavaScript redirects too) to the landing page. One promo is matched by, in order: the page's canonical URL key or a known alias, its declared `rel=canonical` / `og:url`, its domain + headline, the same VSL video ID, or near-identical page text on the same domain. Per-send URLs, affiliate links and re-sends all add sightings to the same promo; only the first sighting anywhere is **new**. Gated pages keep their URL and are retried nightly. The landing page is also searched (body and footer) for a **transcript / "full page" / text-version** link; a found transcript is fetched once and preferred when sending to Promo Analyzer. Staff "not a promo" and "duplicate" decisions (from the Report tool) stick for future mail.

## Brain
- No review queue. Each **new** copy gets one small AI call (key takeaways, offer as stated, topics, gurus, promoted brand, editor's note). Re-sends reuse it: no AI.
- Each copy has one markdown note (email text + takeaways + offer + topics + send table). A copy from a publication linked to an organization teaches that brand's Brain (`ispy-copy:<id>`, folder "Our publications/<publication>"), which learns up into the Master Brain. Every other copy goes straight into the Master Brain under `ISpy/<FinPub|Health>/<Internal|External|Affiliate>/<publisher>`. A staff edit in the Master Brain is never overwritten.
- Weekly trends (deterministic numbers + one short paragraph per feed) are saved and taught to every brand of that niche (`ispy-trends:<feed>:<week>`).

## Jobs (run on the `ispy` Railway service)
`ispy.inbox-poll` (every 15 min: MachineMail poll, pending promo scans, new-copy extraction and notes, silent inboxes), `ispy.gmail-sync` (every 3 h), `ispy.promo-scan` (hourly; 3 am retries failures), `ispy.trends` (Mondays), `ispy.digest` (daily Slack/email: new promos, reused copy), `ispy.import-legacy` (idle until staff press Import).

## Import from iSpy
Admin → ISpy → Import reads the old iSpy database (`ISPY_LEGACY_DATABASE_URL`, read only) into FinPub: publishers, lists (grouped into publications by masthead), gurus with secondary voices and publishers, topics, the Gmail inboxes with their tokens, advertisers, promos, sightings, blocks and every email with its classification. Old lift notes are re-sorted into internal and external lifts. No AI is used. A dry run only counts; a second import adds nothing.

## Data
Platform tables `ispy_*` with no organization column (row-level security allows only `app.bypass_rls`; code goes through `ispyDb()`), plus `ispy_analyzer_sends` (an organization's Promo Analyzer copies). Raw messages and landing snapshots are stored in the bucket under `platform/ispy/`. Every console change is audited (`appendPlatformAudit`, target types `ispy_publisher`, `ispy_publication`, `ispy_list`, `ispy_inbox`, `ispy_routing_rule`, `ispy_list_candidate`, `ispy_guru`, `ispy_report`, `ispy_promo`, `ispy_copy`, `ispy_feed_access`, `ispy_setting`); org actions use `appendOrgAudit` (`ispy_promo`, `ispy_copy`, `ispy_report`).

## Code
- Pure, unit-tested (`modules/ispy/ispy.test.ts`): `copy.ts` (fingerprints), `promo-links.ts` (link resolution and canonical keys, from iSpy), `page.ts` (canonical URLs, video IDs, transcript links), `routing.ts`, `classify.ts` (sender match, masthead signals, lift rule), `access.ts`, `facets.ts`, `extraction.ts` (the one AI call), `markdown.ts`, `headers.ts`, `trends.ts`, `list-name.ts`.
- Server (`apps/web/src/features/ispy/`): `db.ts`, `ingest.ts`, `promos.ts`, `brain.ts`, `pipeline.ts`, `admin.ts`, `read.ts`, `analyzer.ts`, `trends.ts`, `import-legacy.ts`, `email-view.ts`, `providers/{machinemail,gmail}.ts`, `inboxes.ts`, `provision.ts`, `settings.ts`. DB tests: `ispy.test.ts`.
- Routes: `/api/ispy/inbound/machinemail`, `/api/ispy/inbound`, `/api/ispy/img` (image proxy, signed URLs only).
