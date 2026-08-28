# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies first so a source-only change reuses this layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src ./src
COPY components ./components
COPY config ./config
COPY prompts ./prompts

# Tier 1 config: non-secret values baked in from GitHub Variables at build time.
# Secrets are never passed here — they arrive as runtime environment variables so
# that the published image is safe to make public. See docs/CONFIGURATION.md.
ARG BUILD_SHA=dev
ARG BUILD_TIME
ENV BUILD_SHA=$BUILD_SHA BUILD_TIME=$BUILD_TIME

RUN npm run build

# ---- runtime --------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only: no TypeScript, no Vite, no test tooling.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
# config/ and prompts/ are read from the working directory at runtime, so they can
# be bind-mounted over to change settings or the system prompt without a rebuild.
COPY --from=build /app/config ./config
COPY --from=build /app/prompts ./prompts

ARG BUILD_SHA=dev
ARG BUILD_TIME
ENV BUILD_SHA=$BUILD_SHA BUILD_TIME=$BUILD_TIME
ENV PORT=8080 HOST=0.0.0.0

# Run unprivileged; the image never needs to write anything.
USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server/src/server/index.js"]
