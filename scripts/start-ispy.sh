#!/bin/sh
# The ISpy Railway service: the same app and image as the web service, running only the
# ispy.* jobs (inbox polling, Gmail sync, promo scans, trends, digest, import).
# Migrations are applied by the web service (scripts/start-web.sh), not here.
set -eu
export JOBS_INCLUDE="${JOBS_INCLUDE:-ispy.}"
exec pnpm --filter @pubcommand/web start
