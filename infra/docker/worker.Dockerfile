# SiteReel worker (crawl, plan, voice, build, QA, render) — §7.3.
# Build from the repo root:  docker build -f infra/docker/worker.Dockerfile -t sitereel-worker .
#
# The Playwright image pins Chromium to the same version the lockfile's
# `playwright` package drives, so keep this tag in step with it.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

# ffmpeg for encode/mix; Noto for scripts the brand fonts don't cover (Devanagari, CJK, emoji).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable

# Dependency layer: only manifests, so source edits don't re-install. Every workspace
# manifest is copied because a frozen install checks all importers in the lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json apps/worker/
COPY apps/backend/package.json apps/backend/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/film-runtime/package.json packages/film-runtime/
COPY packages/llm/package.json packages/llm/
COPY packages/renderer/package.json packages/renderer/
COPY packages/shared/package.json packages/shared/
COPY packages/storage/package.json packages/storage/
COPY packages/test-pglite/package.json packages/test-pglite/
COPY packages/tts/package.json packages/tts/
# Browsers are already in the base image.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN pnpm install --frozen-lockfile --filter "@sitereel/worker..."

# Workspace packages export TypeScript source, so the worker runs through tsx
# (as it does in development) rather than from a compiled dist/.
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
COPY assets ./assets

# The film bundle is (re)built into packages/renderer/public on first use.
RUN chown -R pwuser:pwuser /app/packages/renderer/public
ENV NODE_ENV=production
USER pwuser
WORKDIR /app/apps/worker

# WORKER_ROLE selects the queues: "general" (everything but rendering) or "render".
CMD ["node_modules/.bin/tsx", "src/index.ts"]
