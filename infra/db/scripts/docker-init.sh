#!/usr/bin/env bash
# =============================================================================
# docker-init.sh — runs once on first Postgres container init.
#
# Mounted at /docker-entrypoint-initdb.d/00_init.sh in the postgres container.
# Iterates the migrations and seeds directories that the compose file mounts
# alongside it. Skips seeds when SEED_DATA=false.
# =============================================================================
set -euo pipefail

PSQL=( psql -v ON_ERROR_STOP=1 --quiet --no-psqlrc -U "$POSTGRES_USER" -d "$POSTGRES_DB" )

echo "==> applying migrations"
for f in /docker-entrypoint-initdb.d/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  [ -f "$f" ] || continue
  echo "    → $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done

if [[ "${SEED_DATA:-true}" == "true" ]]; then
  echo "==> seeding sample data (set SEED_DATA=false to skip)"
  for f in /docker-entrypoint-initdb.d/seeds/[0-9][0-9]_*.sql; do
    [ -f "$f" ] || continue
    echo "    → $(basename "$f")"
    "${PSQL[@]}" -f "$f"
  done
else
  echo "==> SEED_DATA=false — skipping seeds"
fi

echo "✓ database initialization complete"
