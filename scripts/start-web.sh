#!/bin/sh
set -eu
pnpm --filter @pubcommand/db migrate:deploy
pnpm --filter @pubcommand/db ensure-plans
pnpm --filter @pubcommand/db ensure-superadmin
pnpm --filter @pubcommand/db ensure-roles
# Never blocks boot: themes and Mini-Blogs also update the next time their brand's branding is saved.
pnpm --filter @pubcommand/db ensure-brand-look || echo "[boot] brand look sync failed; continuing"
exec pnpm --filter @pubcommand/web start
