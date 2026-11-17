FROM node:22-alpine AS build
RUN apk add --no-cache openssl libc6-compat
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/market/package.json packages/market/package.json
COPY modules/package.json modules/package.json
RUN pnpm install --frozen-lockfile
COPY . .
ENV DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/pubcommand
ENV AUTH_SECRET=build-time-placeholder-not-a-runtime-secret
ENV ROOT_DOMAIN=pubcommand.com
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @pubcommand/db generate && pnpm --filter @pubcommand/web build

FROM node:22-alpine AS runner
RUN apk add --no-cache openssl libc6-compat
# Intel video capture: ffmpeg (audio, keyframes, HLS remux) and yt-dlp (the downloader).
# yt-dlp is pinned from PyPI because sites change often; bump YTDLP_VERSION to update it.
ARG YTDLP_VERSION=2026.10.26
RUN apk add --no-cache ffmpeg python3 py3-pip \
  && pip3 install --no-cache-dir --break-system-packages "yt-dlp==${YTDLP_VERSION}" \
  && yt-dlp --version && ffmpeg -hide_banner -version | head -n 1
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app /app
EXPOSE 3000
CMD ["sh", "scripts/start-web.sh"]
