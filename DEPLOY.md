# Deploy

Project **divine-nourishment**, environment **production**. Do not create services, variables, or domains from this repository. Stephen already provisioned the project. Jeff adds the custom domains on the existing **pubcommand** service. This file is the map.

## Services

| Railway name | What it is | Repo config |
| --- | --- | --- |
| `pubcommand` | Web. Already connected to this repo at the repository root. | `railway.json`, `Dockerfile` |
| `Postgres` | Official Postgres plugin. | `DATABASE_URL=${{Postgres.DATABASE_URL}}` |
| `Redis` | Redis plugin. Present for a later queue. Phase 1 does not attach one. | `REDIS_URL=${{Redis.REDIS_URL}}` |
| `pubcommand-files` | S3-compatible bucket. | `S3_*` below |

The web start command is `sh scripts/start-web.sh`. It applies migrations, ensures the super admin exists, then starts Next.js. The super admin has no password unless `SUPERADMIN_PASSWORD_HASH` is set. When that bcrypt hash is set, every boot writes it onto the super admin user and leaves staff TOTP enrollment unchanged.

The worker is not a second service yet. Add one in the same project from this repository and set its config file to `railway.worker.json` (root of the repo). It uses the same image and `sh scripts/start-worker.sh`. Do not point the existing `pubcommand` service at the worker file.

## Environment variables

Set these on the **pubcommand** web service. Reference syntax is copied into the service variables. Do not paste secret values into git.

| App variable | Required | Railway value |
| --- | --- | --- |
| `DATABASE_URL` | yes | `${{Postgres.DATABASE_URL}}` |
| `AUTH_SECRET` | yes | long random string Stephen generates |
| `ROOT_DOMAIN` | yes | `pubcommand.com` |
| `SUPERADMIN_EMAIL` | yes for boot | `Stephen@onenationfinancial.com` |
| `SUPERADMIN_PASSWORD_HASH` | no | bcrypt hash (`$2a$` or `$2b$`). When set, every boot writes it onto that user. |
| `RESEND_API_KEY` | no | Resend API key. When unset, magic links are written to server logs as `[magic-link]` and are not shown on the page. |
| `EMAIL_FROM` | no | From address for those emails. Defaults to `login@pubcommand.com`. |
| `EMAIL_LOGIN_ENABLED` | no | `true` shows "Email me a link" on the login page. Unset (the default) means password login only; invite links still work. |
| `REDIS_URL` | no, read if set | `${{Redis.REDIS_URL}}` |
| `S3_ENDPOINT` | no, read if the whole set is present | `${{pubcommand-files.ENDPOINT}}` |
| `S3_BUCKET` | same | `${{pubcommand-files.BUCKET}}` |
| `S3_ACCESS_KEY_ID` | same | `${{pubcommand-files.ACCESS_KEY_ID}}` |
| `S3_SECRET_ACCESS_KEY` | same | `${{pubcommand-files.SECRET_ACCESS_KEY}}` |
| `S3_REGION` | same | `${{pubcommand-files.REGION}}` |

`APP_URL` is optional. Magic links use the request host. `AUTH_DEV_EXPOSE_LINKS` must stay unset in production; the login page never shows the link when `NODE_ENV` is production. Set `RESEND_API_KEY` so those links are emailed. `ANTHROPIC_API_KEY` is not required; the provider does not call Anthropic.

Worker service, when added:

| Variable | Required |
| --- | --- |
| `REDIS_URL` | no. Set to `${{Redis.REDIS_URL}}` so the boot probe can see Redis. |
| `PORT` | Railway sets this. |

The worker does not need `DATABASE_URL`, `AUTH_SECRET`, or the `S3_*` variables in Phase 1.

## ISpy service

ISpy's background work (MachineMail polling, legacy Gmail sync, following email links to landing pages, trends, digest, the iSpy import) runs on its own Railway service so it never slows the web app. Same repository, same image, same Postgres and bucket.

1. In project **divine-nourishment**, add a service from this repository named `ispy` and set its config file to `railway.ispy.json`. It starts with `sh scripts/start-ispy.sh` (the web app with only `ispy.*` jobs; migrations stay on the web service). It needs no public domain.
2. Variables on **ispy** (reference syntax where shown):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `AUTH_SECRET` | `${{pubcommand.AUTH_SECRET}}` (must match the web service: it encrypts Gmail tokens and signs image URLs) |
| `ROOT_DOMAIN` | `${{pubcommand.ROOT_DOMAIN}}` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | the same references as the web service |
| `ANTHROPIC_API_KEY` | `${{pubcommand.ANTHROPIC_API_KEY}}` (one small call per new email copy; one paragraph per feed per week) |
| `MACHINEMAIL_API_KEY` | the MachineMail API key (`mm_live_…`) |
| `MACHINEMAIL_DOMAIN` | optional: the custom inbox domain added in MachineMail (catch-all on). Unset = `machinemail.dev` addresses |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | copied from the old iSpy service, so the imported Gmail tokens keep working |
| `ISPY_LEGACY_DATABASE_URL` | the old iSpy service's `DATABASE_URL` (read only; only needed for the import) |
| `JOBS_INCLUDE` | `ispy.` (start-ispy.sh sets it by default) |

3. On the **pubcommand** web service add `MACHINEMAIL_API_KEY` (and `MACHINEMAIL_DOMAIN` if used), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, and `JOBS_EXCLUDE=ispy.` once the `ispy` service is running. Until then the web service runs the ISpy jobs itself. The web service serves the MachineMail webhook (`https://app.<ROOT_DOMAIN>/api/ispy/inbound/machinemail`) and the image proxy; it only stores mail, and the `ispy` service does the rest.
4. In Admin → ISpy → Settings press **Register MachineMail webhook** (it stores the signing secret), or set `MACHINEMAIL_WEBHOOK_SECRET` to a webhook you created yourself.
5. Optional: `ISPY_INBOUND_SECRET` (16+ characters) enables `POST /api/ispy/inbound` for another inbound-mail service; `ISPY_INBOX_DOMAIN` names the domain of inboxes created without MachineMail.

MachineMail's free plan allows 100 messages a day (3,000 a month) and one custom domain; ISpy's volume needs a paid plan.

## DNS

One wildcard and the apex, both on the **pubcommand** service. A new organization slug does not need a Railway change and this app does not call the Railway API per organization.

Railway creates the target hostname and the TXT verification token when the domain is added. Those values are not stable in git. Jeff copies them out of the service after adding `pubcommand.com` and `*.pubcommand.com`. Stephen creates these records at the registrar:

**Apex `pubcommand.com`**

- CNAME flattening, ALIAS, or ANAME at the apex (`@`). Railway does not publish a static IP, so an `A` record is not the record to add.
- Value: the Railway target shown for `pubcommand.com`.
- TXT record: the host and token Railway shows for this domain. Both the routing record and the TXT are required. Without the TXT, Railway returns 404.

**Wildcard `*.pubcommand.com`**

- CNAME `*` to the Railway target shown for `*.pubcommand.com`.
- CNAME `_acme-challenge` to the Railway `_acme-challenge` target shown for the wildcard. If DNS is proxied (Cloudflare orange cloud), this record stays DNS-only.
- TXT record: the verification token Railway shows for the wildcard.

`www`, `app`, `admin`, and every organization slug are one label under `pubcommand.com`, so the wildcard covers them. The apex is not covered by the wildcard, which is why it has its own record.

## pgvector

`packages/db/prisma/migrations/20251115120100_rls/migration.sql` runs `CREATE EXTENSION IF NOT EXISTS vector` and, if the extension is missing, records a notice and continues. The official Railway Postgres image often does not ship pgvector, and Phase 1 has no vector columns. Before a later phase adds one, switch the **Postgres** service to a pgvector image such as `pgvector/pgvector:pg16`.

## Row-level security

Policies are installed. The Railway `postgres` user is a superuser and bypasses them. The Prisma tenant client still scopes every tenant query by organization. A non-owner database role would also be stopped by the policies. Phase 1 deploys with `DATABASE_URL` from the Postgres plugin as provisioned.

## Phase 6 custom domains

Not built. A later phase can let an organization attach its own hostname, for example `hub.agora.com`, from inside the hub by calling the Railway API, then show DNS verification status. That is the only planned use of the Railway API for domains. Phase 1 does not call it.

## Object storage

Keys, when uploads exist, are `org/{organizationId}/brand/{brandId}/workspace/{workspaceId}/{moduleId}/{object}`. The helper is `storagePrefix` in `@pubcommand/core`. Nothing is uploaded in this phase.
