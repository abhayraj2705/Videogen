# SiteReel API (Fastify). Build from the repo root:
#   docker build -f infra/docker/backend.Dockerfile -t sitereel-backend .
FROM node:22-slim

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Every workspace manifest: a frozen install checks all importers in the lockfile.
COPY apps/backend/package.json apps/backend/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/film-runtime/package.json packages/film-runtime/
COPY packages/llm/package.json packages/llm/
COPY packages/renderer/package.json packages/renderer/
COPY packages/shared/package.json packages/shared/
COPY packages/storage/package.json packages/storage/
COPY packages/test-pglite/package.json packages/test-pglite/
COPY packages/tts/package.json packages/tts/
RUN pnpm install --frozen-lockfile --filter "@sitereel/backend..."

# Workspace packages export TypeScript source, so the API runs through tsx.
COPY tsconfig.base.json ./
COPY packages/db ./packages/db
COPY packages/shared ./packages/shared
COPY packages/storage ./packages/storage
COPY packages/test-pglite ./packages/test-pglite
COPY apps/backend ./apps/backend

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
USER node
WORKDIR /app/apps/backend

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node_modules/.bin/tsx", "src/server.ts"]
