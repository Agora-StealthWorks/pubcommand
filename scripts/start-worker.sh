#!/bin/sh
set -eu
exec pnpm --filter @pubcommand/worker start
