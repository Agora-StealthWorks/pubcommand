# Usage

Admin console → **Usage** (`admin.<root>/usage`). Tabs: **Dashboard**, **Activity**, **Audit**
and **Jobs** (Audit and Jobs used to be sidebar items; `/audit` and `/jobs` redirect). The
**Operations Brain** is a tab of the Master Brain (`/brain/ops`). Every number here is also
available to platform AI agents (`docs/AI-AGENTS.md`). Code: `apps/web/src/features/usage`.

## What is recorded

| Table | What | Written by |
| --- | --- | --- |
| `usage_logins` | Every sign-in: method (magic link, password, reset, registration), host, organization, user agent, IP | `establishSession()` |
| `usage_daily` | Per day (New York), person, site and page area: views, active seconds, bytes downloaded | the browser heartbeat (`beacon.tsx` → `POST /api/usage/beacon`) |
| `usage_activities` | One row per organization audit entry: who, app, verb, title and a text snapshot of what they made | job `usage.capture` (every 10 min) |
| `usage_server_samples` | Memory (RSS, heap) and CPU of each web process | every 5 min from `instrumentation.ts` |
| `ops_brain_notes` | The Operations Brain | job `usage.insights`, staff, platform agents |

All five are platform tables: no `organizationId` field (the tenant client cannot reach them)
and row-level security that only allows `platformTx`.

**Time** counts only while the tab is visible and the person had input in the last minute.
**Bandwidth** is what people's browsers downloaded (navigation and resources). **Storage** is the
database size and its largest tables.

## What people made

Every action that already writes the organization audit log (about 250 places: forms, funnels,
promos, Mini-Blog, Websites, Calendar, Research…) is picked up automatically. The capture job
finds the target's table from `targetType` (`form` → `forms`), reads only its String and Json
columns (plus a few child tables: form fields, package components, funnel days and emails, the
latest promo analysis) and keeps the copy: titles, labels, body text, headlines. Secrets, contact
details, ids, URLs and styling are dropped (`contentSnapshot()` in `packages/core/src/usage.ts`),
and private targets are never read (`SNAPSHOT_SKIP_TARGETS`: members, opt-ins, responses, keys,
connections). A new app gets this for free by calling `appendOrgAudit()` with a real `targetType`.

## Operations Brain

A separate area of the Master Brain about how the business runs, not about the software. Every
night (`usage.insights`, 02:35 New York) the AI reads yesterday's activity and numbers and writes
a **daily read**: marketing tactics, copy and messaging (with quotes), strategy trends, how people
work, opportunities and notable work. On Mondays it also writes a **weekly strategy note** from the
week's daily reads, compared with the previous week. Without an AI key it writes a factual digest.
A note staff edit is never rewritten. These notes are never pushed to brands.

**Funnel traffic.** The daily read and the weekly note also learn from visitors to every
organization's public funnel pages (`features/usage/funnel-traffic.ts`, text built by
`modules/funnels/brain-traffic.ts`). Only totals counted in the database are passed on: per funnel,
visitors, page views, opt-ins and opt-in rate, offer clickers, device mix, how many viewers reached
each module or episode, and visitors and opt-ins per tracked URL parameter value (utm_source,
utm_campaign…). Automated traffic is left out. No visitor ids, emails, IP addresses or page URLs
reach the Brain, and parameter values that look like an email address or a phone number are
dropped. The figures appear under **The numbers → Funnel traffic** in each note.

## How PubCommand works (reference notes)

The Operations Brain also holds the app's own documentation as **reference** notes, so the Brain
and the platform agents know how PubCommand works today. On every boot and every night
(`features/usage/reference.ts`) it syncs `README.md`, `docs/*.md`, `DEPLOY.md` and every
`modules/<app>/README.md` into folders (Start here, Platform, Apps, AI agents, Usage & insights)
with a start-here index. New docs appear on their own; removed docs are retired; a note staff edit
is left alone. Keeping those docs current is a rule for every change (`CLAUDE.md`).

## Idle sign-out

Default 12 hours without activity. Console admins (`platform.users.manage`) change it per person
on the user page. When a session ends this way, the open tab's next heartbeat gets 401 and the
page reloads to the sign-in page.

## Retention

`usage.cleanup` (daily): server samples 30 days, activities and sign-ins 400 days, daily totals
kept. It also removes sessions idle longer than the longest timeout.
