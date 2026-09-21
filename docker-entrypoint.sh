#!/bin/sh
# =============================================================================
# Simple Finance container entrypoint (AGENT_APP_BLUEPRINT.md §7):
#   1. source the trusted, admin-owned /data/.env if present,
#   2. prepare the persistent directories under $DATA_DIR (fixed: /data),
#   3. align ownership with PUID/PGID and drop privileges (least privilege),
#   4. apply pending database migrations (failure prevents startup),
#   5. exec the server so signals reach Next.js correctly.
#
# /data/.env is a trusted configuration file owned by the administrator
# (0600). Shell-sourcing executes shell code: it must never be writable by
# untrusted users (blueprint §7, docs/SPEC.md §18.1). It is never included in
# backup archives.
#
# Least privilege (Phase 5 security review, plan decision 32): the container
# starts as root only to take ownership of the data directory exactly once,
# then execs the server as PUID:PGID — Unraid's nobody:users (99:100) by
# default, which matches how appdata is owned on the host. Set PUID=0 to keep
# the historical root behaviour deliberately.
# =============================================================================
set -eu

DATA_DIR="${DATA_DIR:-/data}"

if [ -f "$DATA_DIR/.env" ]; then
  echo "[entrypoint] loading $DATA_DIR/.env"
  set -a
  . "$DATA_DIR/.env"
  set +a
fi

DATA_DIR="${DATA_DIR:-/data}"
PORT="${PORT:-3000}"
PUID="${PUID:-99}"
PGID="${PGID:-100}"
START_COMMAND="node_modules/.bin/next start -H 0.0.0.0 -p $PORT"

mkdir -p "$DATA_DIR/documents" "$DATA_DIR/logging"

RUN_AS=""
if [ "$(id -u)" = "0" ]; then
  # One-time ownership alignment. Only recursive when the root of the tree is
  # not already owned correctly: every file the app itself writes afterwards is
  # created by the unprivileged user and needs no fixing.
  if [ "$PUID" = "0" ]; then
    echo "[entrypoint] PUID=0 requested - running as root (documented trade-off)"
  else
    if [ "$(stat -c %u "$DATA_DIR")" != "$PUID" ] || [ "$(stat -c %g "$DATA_DIR")" != "$PGID" ]; then
      echo "[entrypoint] taking ownership of $DATA_DIR as $PUID:$PGID"
      chown -R "$PUID:$PGID" "$DATA_DIR"
    fi
    if [ -d /app/.next ] && [ "$(stat -c %u /app/.next)" != "$PUID" ]; then
      # Next.js writes its runtime cache next to the build output.
      chown -R "$PUID:$PGID" /app/.next
    fi
    RUN_AS="$PUID:$PGID"
  fi
else
  echo "[entrypoint] already running unprivileged as $(id -u):$(id -g)"
fi

echo "[entrypoint] applying database migrations..."
if [ -n "$RUN_AS" ]; then
  if ! gosu "$RUN_AS" node scripts/migrate.cjs; then
    echo "[entrypoint] migration failed - refusing to start (blueprint section 7)" >&2
    exit 1
  fi
else
  if ! node scripts/migrate.cjs; then
    echo "[entrypoint] migration failed - refusing to start (blueprint section 7)" >&2
    exit 1
  fi
fi

echo "[entrypoint] starting Simple Finance on port ${PORT}${RUN_AS:+ as $RUN_AS}"
if [ -n "$RUN_AS" ]; then
  # gosu execs, so the server becomes PID 1 and receives signals directly.
  exec gosu "$RUN_AS" sh -c "exec $START_COMMAND"
fi
exec sh -c "exec $START_COMMAND"
