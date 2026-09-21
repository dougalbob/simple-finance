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

# --- Ownership alignment -----------------------------------------------------
# The server writes as PUID:PGID, so every path it must write has to belong to
# PUID:PGID. Checking $DATA_DIR alone is NOT enough (bug found in the field on
# v0.1.1): on a bind mount such as Unraid's appdata folder the mount root is
# very often already 99:100 while `documents/` is still root-owned - either
# created by the `mkdir` above, which runs as root, or left behind by an older
# container that ran as root. The recursive chown was then skipped and the first
# receipt upload failed with EACCES (SPEC §23.2). So every path the application
# writes is checked individually, and the tree is walked recursively only when
# something inside it is genuinely still wrong.
owned_by_app() {
  # True when $1 does not exist (nothing to fix) or is already PUID:PGID.
  [ -e "$1" ] || return 0
  [ "$(stat -c %u "$1")" = "$PUID" ] && [ "$(stat -c %g "$1")" = "$PGID" ]
}

take_ownership() {
  # take_ownership <path> [-R]
  echo "[entrypoint] taking ownership of $1 as $PUID:$PGID"
  chown ${2:-} "$PUID:$PGID" "$1"
}

RUN_AS=""
if [ "$(id -u)" = "0" ]; then
  if [ "$PUID" = "0" ]; then
    echo "[entrypoint] PUID=0 requested - running as root (documented trade-off)"
  else
    for target in "$DATA_DIR" "$DATA_DIR/documents" "$DATA_DIR/logging"; do
      owned_by_app "$target" || take_ownership "$target"
    done
    # The database and its WAL sidecars (any name: DATABASE_PATH may be
    # overridden in /data/.env). A root-owned database makes the migration below
    # fail, and the container then refuses to start.
    for dbfile in "$DATA_DIR"/*.sqlite*; do
      owned_by_app "$dbfile" || take_ownership "$dbfile"
    done
    # Files an older root-running container wrote *inside* an otherwise correctly
    # owned directory would be unreadable to the app (a 404 from the receipt
    # viewer), so repair those two trees as well. `find` stops at the first
    # mismatch, which keeps this cheap on every start.
    #
    # Deliberately scoped to documents/ and logging/ rather than a recursive
    # chown of $DATA_DIR: /data/.env is the trusted, admin-owned configuration
    # (SPEC §18.1, sourced as root above) and the application must never be able
    # to write it. A root-owned .env is correct, not a fault to "repair".
    for target in "$DATA_DIR/documents" "$DATA_DIR/logging"; do
      [ -d "$target" ] || continue
      if command -v find >/dev/null 2>&1; then
        stray="$(
          find "$target" \( ! -user "$PUID" -o ! -group "$PGID" \) -print -quit 2>/dev/null || true
        )"
      else
        stray="unknown (find is unavailable - repairing to be safe)"
      fi
      if [ -n "$stray" ]; then
        echo "[entrypoint] not owned by $PUID:$PGID inside $target: $stray"
        take_ownership "$target" -R
      fi
    done
    if [ -d /app/.next ] && ! owned_by_app /app/.next; then
      # Next.js writes its runtime cache next to the build output.
      take_ownership /app/.next -R
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

# Prove the receipts directory is genuinely writable by the server user. Not
# fatal - everything except uploads still works - but an opaque EACCES from the
# first receipt upload is much harder to diagnose than this line in the log.
if [ -n "$RUN_AS" ]; then
  PROBE_DIR="$DATA_DIR/documents"
  if ! gosu "$RUN_AS" sh -c 'touch "$1/.simple-finance-write-probe" && rm -f "$1/.simple-finance-write-probe"' _ "$PROBE_DIR"; then
    echo "[entrypoint] WARNING: $PROBE_DIR is not writable by $RUN_AS - receipt/invoice uploads will fail." >&2
    echo "[entrypoint] WARNING: on the host, run: chown -R $PUID:$PGID $PROBE_DIR" >&2
  fi
fi

echo "[entrypoint] starting Simple Finance on port ${PORT}${RUN_AS:+ as $RUN_AS}"
if [ -n "$RUN_AS" ]; then
  # gosu execs, so the server becomes PID 1 and receives signals directly.
  exec gosu "$RUN_AS" sh -c "exec $START_COMMAND"
fi
exec sh -c "exec $START_COMMAND"
