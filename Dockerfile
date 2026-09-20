# syntax=docker/dockerfile:1
# =============================================================================
# Simple Finance — multi-stage production image (AGENT_APP_BLUEPRINT.md §7).
#
# Builder and runtime stages use the SAME base image and Node major so native
# modules (better-sqlite3) compiled/built in the builder remain valid after
# being copied into the runtime stage.
#
# Documented trade-off (to revisit at the Phase 5 security review): the
# container runs as root, matching the reference application's installation
# simplicity; /data is admin-owned. Least-privilege execution is a candidate
# improvement for v0.1.0 hardening, decided then, not silently inherited.
# =============================================================================

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
# Keep only production dependencies; native modules are already present.
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATA_DIR=/data \
    PORT=3000
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh && mkdir -p /data
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
