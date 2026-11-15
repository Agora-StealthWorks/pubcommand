# PubCommand

Multi-tenant publishing command hub for One Nation Financial. This repository is Phase 1: the foundation. Product modules are manifests and empty routes. Knowledge, editorial, promo, forms, and the rest are not implemented yet.

Owner: Stephen Prior. The seeded super admin is `Stephen@onenationfinancial.com`. The account has no password. The first login is a magic link, then staff must enroll an authenticator before the platform console opens.

## Local

```bash
cp .env.example .env
# Keep ROOT_DOMAIN=localhost for this machine.
# Set AUTH_SECRET to a long random string.
pnpm install
pnpm db:generate
docker compose up -d   # Postgres on localhost:5432, or use your own DATABASE_URL
pnpm db:migrate
pnpm db:seed           # example organizations only; the super admin is also ensured on web boot
pnpm dev
```

Open:

- http://localhost:3000 marketing and login
- http://localhost:3000/?site=app organization picker
- http://localhost:3000/?site=admin platform console (staff + 2FA)
- http://localhost:3000/?org=example-gazette an example organization

With `AUTH_DEV_EXPOSE_LINKS=true` (the local example) the login page shows the magic link. That flag is ignored in production.

The worker listens on port 3001 and serves `GET /health`. Redis is optional locally. A queue is not attached.

## Scripts

- `pnpm dev` web and worker
- `pnpm lint` `pnpm typecheck` `pnpm test` `pnpm build`
- `pnpm db:migrate` apply SQL migrations
- `pnpm db:seed` example orgs, brands, users, and roles

## Layout

- `apps/web` Next.js App Router
- `apps/worker` process that boots and lists declared jobs
- `packages/db` Prisma, tenancy, RLS
- `packages/auth` Lucia sessions, magic link, password, staff TOTP, SSO hooks
- `packages/core` `can()`, platform roles, host routing, module types
- `packages/ui` light-theme primitives
- `packages/ai` Anthropic provider stub
- `modules/` example stub plus the product and settings manifests

See `docs/ARCHITECTURE.md`, `docs/MODULES.md`, and `DEPLOY.md`.
