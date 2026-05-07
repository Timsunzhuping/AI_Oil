# Database Seeding Guide

The FluidMind platform includes comprehensive seed data to bootstrap development and demonstrate full system capabilities across all 13 backend modules.

## Overview

The seed data covers:

- **Users & RBAC**: Admin, scientist, reviewer, analyst, viewer roles with permissions
- **Master Data**: Raw materials (PAO, GIII, additives, packages), product categories
- **R&D Workflows**: Formulas, experiments, test results, R&D tasks
- **ML Registry**: Model versions for prediction + recommendation engines
- **Prediction**: Historical prediction results with actual BOM → metric outputs
- **Recommendation**: Candidate generation examples showing cost-optimized + premium variants
- **Knowledge Base**: 3 comprehensive articles on base oils, VIIs, detergent packages + QA pairs
- **Evaluation**: Acceptance test sets (forward / inverse / stability) for model validation
- **Tasks**: R&D tasks with templates demonstrating development workflows
- **Integration**: ERP task mappings, LIMS test requests (when available)

## Quick Start

### 1. Using the Shell Script (Recommended)

```bash
cd infra/db

# Seed using DATABASE_URL from .env.local
./seed.sh

# Or provide explicit connection
./seed.sh --pgconnect "postgres://user:pwd@localhost/fluidmind"

# Dry-run: show what would execute without applying
./seed.sh --dry-run
```

### 2. Using Docker Compose (Development)

```bash
docker-compose up -d postgres
docker-compose exec postgres ./seed.sh
```

### 3. Manual SQL Execution

```bash
psql -f 01_users_and_roles.sql
psql -f 02_materials_and_products.sql
# ... continue through 15_tasks_knowledge_qa.sql
```

## Seed Data Composition

### Phase 1: Identity + RBAC (01 - 01)

- **Users**: admin, scientist-001 (Dr. Li), scientist-002, analyst, viewer
- **Roles**: Administrator, R&D Scientist, Reviewer, Analyst, Viewer
- **Permissions**: 20+ granular permissions (formula:write, experiment:read, audit:read, etc.)

**Use Case**: Demonstrates three-tier authorization (menu-level, action-level, data-scope) in security module.

### Phase 2: Master Data (02 - 08)

**Materials**:

- Base oils: PAO-6, PAO-8, GIII-4cSt, GIII-6cSt
- VIIs: OCP, PMA variants
- Packages: Package A (TBN 9), Package B (TBN 10-11), Package C (TBN 8-9)
- Specification data: pour point, flash point, density, etc.

**Products**:

- 5W-30 PCMO (SAE J300)
- 15W-40 HDEO (SAE J300)
- ISO VG 220 Industrial Gear Oil (ISO 3104)

**Formulas**:

- 4 published formulas (PCMO, HDEO, gear oil variants)
- Versioning + approval workflow metadata

**Experiments & Tests**:

- 5 completed experiments (viscosity benchmarking, oxidation aging)
- Test results with detailed analytics

**Features**:

- Extracted features (cost_share, complexity_entropy, viscosity_range, etc.)

**Use Case**: Full product development lifecycle with material sourcing + formula management.

### Phase 3: ML & Prediction (07, 14)

**Models**:

- `pred-viscosity-v1`: Single-output regression (KV@100C)
- `pred-multioutput-v1`: Multi-output (KV@40C, KV@100C, VI, TBN, TAN)
- `rec-formula-gen-v1`: Recommendation engine (Bayesian optimization)

**Versions**:

- 3 production model versions with training metadata, evaluation metrics, deployment timestamps

**Prediction History**:

- 2 sample forward predictions showing predictor output

**Use Case**: Demonstrates ML registry, model versioning, and prediction module integration.

### Phase 4: Recommendation (14)

**Requests**:

- Cost-optimized: KV_100C=11.5 cSt @ <$35/L
- Premium: KV_100C=12.0 + VI=165 + TBN=10 @ <$50/L

**Candidates**:

- 3 generated BOM candidates with cost, confidence, risk warnings
- Demonstrates Jacobi feasibility scoring + constraint satisfaction

**Use Case**: Full inverse workflow: target spec → ranked candidates → evaluation.

### Phase 5: Evaluation & Acceptance (13)

**Test Sets**:

- **Forward** (TS-2026-0001): PCMO forward acceptance (3 cases, 4 metrics each)
- **Forward** (TS-2026-0002): Gear oil forward acceptance (1 case, 4 metrics)
- **Inverse** (TS-2026-0003): PCMO recommendation acceptance (2 cases, multi-constraint)
- **Stability** (TS-2026-0004): Predictor determinism (5 runs, pairwise cosine > 0.99)

**Use Case**: Demonstrates all three acceptance runner types with realistic tolerances.

### Phase 6: Knowledge & QA (15)

**Knowledge Documents**:

1. **PAO Base Oils**: Properties, grades, selection guidance, cost/availability
2. **Viscosity Improvers**: Function, dosing, supplier info
3. **Detergent-Dispersant Packages**: TBN targets, supplier matrix, selection criteria

**QA Pairs**:

- 3 expert Q&A pairs linked to knowledge docs
- Confidence scores (0.88-0.94)
- Source references for traceability

**Use Case**: Populated knowledge base for workbench discovery + expert QA integration.

### Phase 7: R&D Tasks (15)

**Templates**:

- Formula Development (7-day, medium priority)
- Bench Testing (3-day, high priority)
- Knowledge Audit (2-day, low priority)

**Task Instances**:

- TASK-2026-001: Develop 5W-30 PCMO variant (in_progress, due in 5 days)
- TASK-2026-002: Bench test Draft Formula A (assigned, due in 3 days)
- TASK-2026-003: Gear oil ISO VG 220 (draft, due in 10 days)
- TASK-2026-004: Knowledge audit (pending, due in 7 days)

**Use Case**: Task center collaboration workflows with status tracking + metadata.

## Data Volume & Performance

| Entity          | Count | Notes                                        |
| --------------- | ----- | -------------------------------------------- |
| Users           | 8     | 1 admin + 2 scientists + analyst + 3 viewers |
| Roles           | 5     | Admin, Scientist, Reviewer, Analyst, Viewer  |
| Permissions     | 20+   | Resource:action pairs                        |
| Raw Materials   | ~35   | PAO grades, GIII, additives, packages        |
| Products        | 5     | PCMO 5W-30/15W-40, HDEO, Gear Oil variants   |
| Formulas        | 8     | Approved + draft versions                    |
| Experiments     | 5     | Completed with test results                  |
| ML Models       | 3     | Prediction + recommendation                  |
| Model Versions  | 3     | Production deployments                       |
| Predictions     | 2     | Sample forward predictions                   |
| Recommendations | 2     | Requests + 3 candidates each                 |
| Test Sets       | 4     | Forward (2) + Inverse (1) + Stability (1)    |
| Tasks           | 4     | Various lifecycle stages                     |
| Knowledge Docs  | 3     | Technical articles                           |
| QA Pairs        | 3     | Expert Q&A                                   |

**Disk Space**: ~2-3 MB (compressed)
**Load Time**: ~200-500 ms on localhost
**Query Complexity**: Safe for dev/staging; production benchmarks needed for 1M+ records

## Idempotency & Re-seeding

All seed scripts use `ON CONFLICT DO NOTHING` or `INSERT ... WHERE NOT EXISTS`:

```sql
INSERT INTO users (...) VALUES (...)
ON CONFLICT (email) DO NOTHING;
```

This means:

- ✅ Safe to re-run multiple times
- ✅ Existing data is preserved
- ✅ New records are added if missing
- ⚠️ If you manually edited a seeded record, re-running the script won't overwrite it

To **completely reset** the database:

```bash
psql -d fluidmind -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
# Run all migrations from scratch
pnpm run migrate:latest
# Re-seed
./seed.sh
```

## Extending the Seed Data

To add more scenarios:

1. **Create new seed file**: `infra/db/seeds/16_custom_scenario.sql`
2. **Follow the same pattern**:
   ```sql
   INSERT INTO your_table (...) VALUES (...)
   ON CONFLICT DO NOTHING;
   ```
3. **Add to seed.sh**:
   ```bash
   SEED_FILES=(
     ...
     "16_custom_scenario.sql"
   )
   ```
4. **Run**: `./seed.sh`

## Accessing Seeded Data via API

After seeding, the workbench frontend can query the API directly:

### User Login

```bash
curl -X POST http://localhost:3000/v1/security/login \
  -d '{"email": "scientist001@fluidmind.local", "password": "initial123"}' \
  -H "Content-Type: application/json"
```

### List Formulas

```bash
curl http://localhost:3000/v1/formulas?status=published
```

### Get Recommendation Candidates

```bash
curl http://localhost:3000/v1/recommend/requests/<request_id>/candidates
```

### List Acceptance Test Sets

```bash
curl http://localhost:3000/v1/evaluation/test-sets?test_type=forward
```

### Run Forward Acceptance

```bash
curl -X POST http://localhost:3000/v1/evaluation/runs \
  -d '{"test_set_id": "22222222-2222-2222-2222-222222222201"}' \
  -H "Content-Type: application/json"
```

## Programmatic Seeding (TypeScript)

For integration tests or automated workflows:

```typescript
import { Pool } from 'pg';
import { readFileSync } from 'fs';

async function seed(connectionString: string) {
  const pool = new Pool({ connectionString });
  const seedFiles = [
    '01_users_and_roles.sql',
    // ... up to 15_tasks_knowledge_qa.sql
  ];

  for (const file of seedFiles) {
    const sql = readFileSync(`infra/db/seeds/${file}`, 'utf-8');
    await pool.query(sql);
  }

  await pool.end();
}

// Usage in tests
beforeAll(() => seed(process.env.DATABASE_URL!));
```

## Troubleshooting

### "Role already exists"

Idempotent seed files use `ON CONFLICT DO NOTHING`. If you see this error, one of the seed files is not idempotent. Check for missing conflict clauses.

### "Foreign key violation"

Seed files must be executed in order (01 → 15). If you skip a file, dependent records won't exist. Re-run the full sequence.

### "Permission denied: roles"

Ensure your database user has superuser or DDL privileges. Seed data creation requires `CREATE` permissions on tables.

### "Database is locked"

Another connection is holding a lock. Close all other sessions:

```bash
psql -d fluidmind -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='fluidmind' AND pid != pg_backend_pid();"
```

## Next Steps

- **Development**: Seed locally, start the backend server, connect the frontend workbench
- **CI/CD**: Run seeding in test environment before running acceptance tests
- **Staging**: Seed staging DB weekly; monitor for stale data
- **Production**: Use seeding sparingly; prefer explicit data migration scripts for production changes

## References

- Migration guide: [`infra/db/migrations/README.md`](./migrations/README.md)
- Backend modules: [`apps/backend/src/modules/`](../../apps/backend/src/modules/)
- API spec: TBD (OpenAPI/Swagger when available)
