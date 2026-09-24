# syntax=docker/dockerfile:1
# =============================================================================
# Simple Finance — multi-stage production image (AGENT_APP_BLUEPRINT.md §7).
#
# Builder and runtime stages use the SAME base image and Node major so native
# modules (better-sqlite3) compiled/built in the builder remain valid after
# being copied into the runtime stage.
#
# Least privilege (Phase 5 security review, plan decision 32): the image ships
# `gosu` and the entrypoint drops to PUID:PGID (default 99:100 = Unraid
# nobody:users) after aligning /data ownership. Nothing in the application
# needs root at runtime. Set PUID=0/PGID=0 only if an installation deliberately
# wants the historical root behaviour.
# =============================================================================

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Native module toolchain: better-sqlite3 compiles from source during npm ci
# (the slim base ships no compiler; libstdc++6 needed at runtime is included
# in the base image). Blueprint §7: build in a compatible stage, carry the
# result into the runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
# Keep only production dependencies; native modules are already built above.
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATA_DIR=/data \
    PORT=3000 \
    PUID=99 \
    PGID=100
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates gosu \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY docker-entrypoint.sh ./docker-entrypoint.sh
# The default runtime user owns the build output (Next writes its cache there)
# and the data volume mount point; the entrypoint re-chowns when PUID differs.
RUN chmod +x docker-entrypoint.sh \
    && mkdir -p /data/documents /data/logging \
    && chown -R 99:100 /app/.next /data
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
