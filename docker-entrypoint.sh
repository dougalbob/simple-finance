#!/bin/sh
# =============================================================================
# Simple Finance container entrypoint (AGENT_APP_BLUEPRINT.md §7):
#   1. prepare the persistent directories under $DATA_DIR (fixed: /data),
#   2. source the trusted, admin-owned /data/.env if present,
#   3. apply pending database migrations (failure prevents startup),
#   4. exec the server so signals reach Next.js correctly.
#
# /data/.env is a trusted configuration file owned by the administrator
# (0600). Shell-sourcing executes shell code: it must never be writable by
# untrusted users (blueprint §7, docs/SPEC.md §18.1). It is never included in
# backup archives.
# =============================================================================
set -eu

DATA_DIR="${DATA_DIR:-/data}"
PORT="${PORT:-3000}"

mkdir -p "$DATA_DIR/documents" "$DATA_DIR/logging"

if [ -f "$DATA_DIR/.env" ]; then
  echo "[entrypoint] loading $DATA_DIR/.env"
  set -a
  . "$DATA_DIR/.env"
  set +a
fi

echo "[entrypoint] applying database migrations..."
if ! node scripts/migrate.cjs; then
  echo "[entrypoint] migration failed - refusing to start (blueprint section 7)" >&2
  exit 1
fi

echo "[entrypoint] starting Simple Finance on port ${PORT}"
exec node_modules/.bin/next start -H 0.0.0.0 -p "$PORT"
