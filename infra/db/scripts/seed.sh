#!/usr/bin/env bash
# =============================================================================
# seed.sh — load seed data after migrations.
#
# Idempotent: every INSERT uses ON CONFLICT DO NOTHING so reseeding is safe.
#
# Usage:
#   DATABASE_URL=postgresql://... ./seed.sh
# =============================================================================
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-}"
SEEDS_DIR="${SEEDS_DIR:-$(dirname "$0")/../seeds}"

if [[ -z "$DATABASE_URL" ]]; then
  echo "ERROR: DATABASE_URL not set" >&2
  exit 1
fi

count=0
for f in $(ls "$SEEDS_DIR"/[0-9][0-9]_*.sql | sort); do
  base=$(basename "$f" .sql)
  echo "→ seeding $base"
  PGOPTIONS='--client-min-messages=warning' \
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --quiet --no-psqlrc -f "$f"
  count=$((count + 1))
done

echo "✓ applied $count seed file(s)"
