#!/bin/bash
# =============================================================================
# seed.sh — Idempotent database seed script for FluidMind platform
#
# Usage:
#   ./seed.sh                          # Use .env.local for DB credentials
#   ./seed.sh --pgconnect "..."        # Override connection string
#   ./seed.sh --dry-run                # Show SQL without executing
# =============================================================================

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEEDS_DIR="${SCRIPT_DIR}/seeds"
DRY_RUN=false
PGCONNECT="${PGCONNECT:-}"
PGCONNECT_ARG=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pgconnect)
      PGCONNECT="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# Load .env if no PGCONNECT provided
if [[ -z "$PGCONNECT" ]]; then
  if [[ -f "${SCRIPT_DIR}/../.env.local" ]]; then
    set -a
    source "${SCRIPT_DIR}/../.env.local"
    set +a
    PGCONNECT="${DATABASE_URL:-}"
  fi
  if [[ -z "$PGCONNECT" ]]; then
    echo "Error: PGCONNECT not set and .env.local not found" >&2
    echo "Set DATABASE_URL in .env.local or pass --pgconnect" >&2
    exit 1
  fi
fi

PGCONNECT_ARG="-c conninfo_string=$PGCONNECT"

# Color output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Helper functions
log_info() {
  echo -e "${GREEN}[INFO]${NC} $*"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $*"
}

# Verify database connection
log_info "Verifying database connection..."
if ! psql "$PGCONNECT" -c "SELECT version();" > /dev/null 2>&1; then
  log_error "Failed to connect to database"
  exit 1
fi
log_info "✓ Database connection OK"

# Execute seed scripts in order
SEED_FILES=(
  "01_users_and_roles.sql"
  "02_materials_and_products.sql"
  "03_formulas.sql"
  "04_experiments_and_tests.sql"
  "05_rd_tasks.sql"
  "06_knowledge_and_rules.sql"
  "07_ml_registry.sql"
  "08_master_data.sql"
  "09_integration.sql"
  "10_cleaning.sql"
  "11_features.sql"
  "12_task_templates.sql"
  "13_evaluation_and_acceptance.sql"
  "14_prediction_and_recommendation.sql"
  "15_tasks_knowledge_qa.sql"
)

log_info "Executing seed scripts..."
for file in "${SEED_FILES[@]}"; do
  filepath="${SEEDS_DIR}/${file}"
  if [[ ! -f "$filepath" ]]; then
    log_warn "Skipping missing file: $file"
    continue
  fi

  log_info "Processing: $file"

  if [[ "$DRY_RUN" == true ]]; then
    log_info "  [DRY RUN] Would execute $(wc -l < "$filepath") lines"
    head -5 "$filepath" | sed 's/^/    /'
    echo "    ..."
  else
    if psql "$PGCONNECT" -f "$filepath" > /dev/null 2>&1; then
      log_info "  ✓ Completed"
    else
      log_error "  Failed to execute $file"
      exit 1
    fi
  fi
done

log_info "✓ Seed script execution completed"

# Summary
if [[ "$DRY_RUN" != true ]]; then
  log_info "Counting seeded records..."

  # Query counts from key tables
  USERS_COUNT=$(psql "$PGCONNECT" -t -c "SELECT COUNT(*) FROM users;" 2>/dev/null || echo "?")
  MATERIALS_COUNT=$(psql "$PGCONNECT" -t -c "SELECT COUNT(*) FROM raw_materials;" 2>/dev/null || echo "?")
  FORMULAS_COUNT=$(psql "$PGCONNECT" -t -c "SELECT COUNT(*) FROM formulas;" 2>/dev/null || echo "?")
  TEST_SETS_COUNT=$(psql "$PGCONNECT" -t -c "SELECT COUNT(*) FROM acceptance_test_sets;" 2>/dev/null || echo "?")
  TASKS_COUNT=$(psql "$PGCONNECT" -t -c "SELECT COUNT(*) FROM tasks;" 2>/dev/null || echo "?")
  KB_DOCS_COUNT=$(psql "$PGCONNECT" -t -c "SELECT COUNT(*) FROM knowledge_documents;" 2>/dev/null || echo "?")

  echo ""
  log_info "Database Statistics:"
  echo "  Users:                  $USERS_COUNT"
  echo "  Raw Materials:          $MATERIALS_COUNT"
  echo "  Formulas:               $FORMULAS_COUNT"
  echo "  Acceptance Test Sets:   $TEST_SETS_COUNT"
  echo "  R&D Tasks:              $TASKS_COUNT"
  echo "  Knowledge Documents:    $KB_DOCS_COUNT"
  echo ""
  log_info "✓ Seed data loaded successfully!"
fi
