#!/bin/sh
set -eu
pnpm --filter @pubcommand/db migrate:deploy
pnpm --filter @pubcommand/db ensure-plans
pnpm --filter @pubcommand/db ensure-superadmin
exec pnpm --filter @pubcommand/web start
