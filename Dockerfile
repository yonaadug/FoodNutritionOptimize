# syntax=docker/dockerfile:1
# NutriCompare web app: Next.js standalone server with the SQLite DB bundled read-only.
#
#   git lfs pull                       # the DB must be the real file, not an LFS pointer
#   docker build -t nutricompare .
#   docker run --rm -p 3000:3000 nutricompare
#
# Build on (or with --platform for) the target arch: the better-sqlite3 binary
# traced into the standalone bundle is the one for the build platform.

ARG NODE_VERSION=26

# ---- deps: install exactly what the lockfile says ---------------------------
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
COPY food-nutrition-app/package.json food-nutrition-app/package-lock.json ./
# --ignore-scripts: better-sqlite3 ships N-API prebuilds; without it some npm
# versions run node-gyp from binding.gyp (needs python/make, absent in -slim).
RUN npm ci --no-audit --no-fund --ignore-scripts

# ---- build: produce .next/standalone ---------------------------------------
FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY food-nutrition-app/ ./
RUN [ "$(head -c 15 nutrition.db)" = "SQLite format 3" ] \
    || { echo "nutrition.db is not a SQLite file (Git LFS pointer?). Run 'git lfs pull' first." >&2; exit 1; }
RUN npm run build && mkdir -p public

# ---- runtime: only the standalone bundle, as a non-root user ---------------
FROM node:${NODE_VERSION}-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NUTRITION_DB_PATH=/app/nutrition.db

# Files stay root-owned, so the app user can read but not modify the code or DB.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/search?q=apple').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server.js"]
