# Multi-stage Dockerfile for the llmmeter collector + dashboard.
# Builds the monorepo, prunes to just the CLI subgraph, runs `llmmeter serve`.

# ---- builder ----
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++ libc6-compat
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy workspace manifests first for better layer caching.
COPY pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY examples ./examples

RUN pnpm install --frozen-lockfile=false
RUN pnpm -r build

# ---- runtime ----
FROM node:20-alpine AS runtime
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

ENV NODE_ENV=production
ENV LLMMETER_DB_PATH=/data/llmmeter.db

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/turbo.json ./
COPY --from=builder /app/packages ./packages
RUN pnpm install --prod --frozen-lockfile=false

RUN mkdir -p /data
VOLUME /data
EXPOSE 8080

# Default command: serve with SQLite at /data/llmmeter.db.
# Override with env LLMMETER_DB_URL for Postgres, or pass --pg URL directly.
ENTRYPOINT ["node", "/app/packages/cli/dist/cli.js"]
CMD ["serve", "--host", "0.0.0.0", "--port", "8080"]
