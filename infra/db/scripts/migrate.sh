#!/usr/bin/env bash
# =============================================================================
# migrate.sh — apply all SQL migrations in order.
#
# Idempotent: each migration logs its version into schema_migrations and uses
# `ON CONFLICT DO NOTHING` for the ledger row. Re-running is safe.
#
# Usage:
#   DATABASE_URL=postgresql://... ./migrate.sh
#   ./migrate.sh --target 0006   # apply up to 0006_*
#
# Environment:
#   DATABASE_URL  full Postgres connection string (required)
#   MIGRATIONS_DIR  defaults to ./infra/db/migrations
# =============================================================================
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$(dirname "$0")/../migrations}"
TARGET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$DATABASE_URL" ]]; then
  echo "ERROR: DATABASE_URL not set" >&2
  exit 1
fi

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "ERROR: migrations directory not found: $MIGRATIONS_DIR" >&2
  exit 1
fi

count=0
for f in $(ls "$MIGRATIONS_DIR"/[0-9][0-9][0-9][0-9]_*.sql | sort); do
  base=$(basename "$f" .sql)
  if [[ -n "$TARGET" ]] && [[ "${base%%_*}" > "$TARGET" ]]; then
    echo "→ skipping $base (past --target $TARGET)"
    continue
  fi
  echo "→ applying $base"
  PGOPTIONS='--client-min-messages=warning' \
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --quiet --no-psqlrc -f "$f"
  count=$((count + 1))
done

echo "✓ applied $count migration file(s)"
