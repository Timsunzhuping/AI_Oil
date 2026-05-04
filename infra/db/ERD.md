# FluidMind Database — Entity-Relationship Reference

> PostgreSQL 16 + pgvector. Schema lives in `infra/db/migrations/`, sample data in `infra/db/seeds/`.

## Domain map

```
┌──────────────────────┐  ┌─────────────────────┐  ┌──────────────────┐
│ Identity & Security  │  │ Master Data         │  │ Audit            │
│  users, roles,       │  │  raw_materials,     │  │  audit_logs      │
│  permissions,        │  │  suppliers,         │  │  (partitioned)   │
│  sessions            │  │  products           │  └──────────────────┘
└─────────────────────┬┘  └──────────┬──────────┘
                      │              │
            ┌─────────▼──────────────▼─────────┐
            │ Formulas (core domain)           │
            │  formulas → formula_versions →   │
            │             formula_items        │
            │  formula_approvals               │
            └─────────┬────────────────────────┘
                      │
        ┌─────────────┼──────────────────────┐
        │             │                      │
┌───────▼────────┐ ┌──▼───────────┐ ┌────────▼─────────┐
│ Experiments &  │ │ R&D Tasks    │ │ Knowledge &      │
│ Tests          │ │              │ │ Rules            │
│  experiments,  │ │ projects,    │ │  knowledge_docs, │
│  test_methods, │ │ tasks,       │ │  knowledge_chunks│
│  test_results  │ │ comments     │ │  expert_rules    │
└────────────────┘ └──────────────┘ └──────────────────┘

                  ┌──────────────────────────────────┐
                  │ ML Lifecycle                     │
                  │  datasets → training_jobs →      │
                  │  model_registry → model_versions │
                  │  → inference_endpoints           │
                  └──────────────────────────────────┘
```

## Naming and column conventions

Every entity table uses the same skeleton:

| Column            | Type           | Purpose |
|-------------------|----------------|---------|
| `id`              | `UUID`         | Primary key, `gen_random_uuid()` |
| `code`            | `TEXT`         | Human-readable unique key (where applicable) |
| `name`            | `TEXT`         | Display label |
| `status` / type   | `TEXT + CHECK` | State machine value (CHECK constraint, not native ENUM — easier to extend) |
| `metadata`        | `JSONB`        | Free-form extensibility |
| `tags`            | `TEXT[]`       | Tagging (GIN-indexed) |
| `created_at`      | `TIMESTAMPTZ`  | `DEFAULT NOW()` |
| `updated_at`      | `TIMESTAMPTZ`  | Maintained by `set_updated_at_and_version()` trigger |
| `created_by`      | `UUID`         | FK to `users` |
| `updated_by`      | `UUID`         | FK to `users` |
| `deleted_at`      | `TIMESTAMPTZ`  | Soft delete; `NULL` means active |
| `version`         | `INTEGER`      | Optimistic-locking counter; trigger increments on UPDATE |

Other conventions:

- **Snake_case** everywhere. Plural table names. FK columns use `<entity>_id`.
- **Booleans** prefixed `is_*` (`is_active`, `is_critical`).
- **Money columns** are `NUMERIC(14,4)` paired with `*_currency CHAR(3)`.
- **Quantity columns** carry an explicit `unit_of_measure TEXT`.
- **Dates** distinguish `*_date` (DATE) from `*_at` (TIMESTAMPTZ).
- **Status enums** are `TEXT + CHECK (... IN ('a','b'))` rather than native ENUM types — adding a new value never requires `ALTER TYPE`.
- **Partial indexes** `WHERE deleted_at IS NULL` are used liberally so soft-deleted rows don't bloat hot indexes.
- **JSONB** for extensibility, with **GIN** indexes when frequently queried.
- **GIN trigram** indexes on free-text columns the UI searches (`raw_materials.name`, `formulas.name`, etc.).
- **pgvector** `vector(1536)` columns for embedding-driven semantic search.

## Domain ERDs

### 1. Identity & RBAC

```mermaid
erDiagram
    users {
      uuid id PK
      text email UK
      text username UK
      bool is_active
    }
    roles {
      uuid id PK
      text code UK
      bool is_system
    }
    permissions {
      uuid id PK
      text code UK
      text resource
      text action
    }
    role_permissions {
      uuid role_id PK,FK
      uuid permission_id PK,FK
    }
    user_roles {
      uuid user_id PK,FK
      uuid role_id PK,FK
    }
    user_sessions {
      uuid id PK
      uuid user_id FK
      text token_hash UK
    }

    users ||--o{ user_roles : has
    roles ||--o{ user_roles : grants
    roles ||--o{ role_permissions : binds
    permissions ||--o{ role_permissions : grants
    users ||--o{ user_sessions : owns
```

### 2. Master Data — Raw Materials

```mermaid
erDiagram
    material_categories {
      uuid id PK
      text code UK
      uuid parent_id FK
      text path
    }
    suppliers {
      uuid id PK
      text code UK
      text qualification_status
      numeric rating
    }
    raw_materials {
      uuid id PK
      text code UK
      text cas_number
      uuid category_id FK
      uuid default_supplier_id FK
      text status
    }
    material_supplier_specs {
      uuid id PK
      uuid raw_material_id FK
      uuid supplier_id FK
      bool is_primary
    }

    material_categories ||--o{ material_categories : parent
    material_categories ||--o{ raw_materials : groups
    suppliers ||--o{ raw_materials : sources
    raw_materials ||--o{ material_supplier_specs : has
    suppliers ||--o{ material_supplier_specs : provides
```

### 3. Products

```mermaid
erDiagram
    product_categories {
      uuid id PK
      text code UK
      uuid parent_id FK
    }
    products {
      uuid id PK
      text code UK
      text product_type
      uuid category_id FK
      uuid current_formula_version_id FK
      text status
    }
    product_specifications {
      uuid id PK
      uuid product_id FK
      text spec_code
      numeric target_value
      numeric min_value
      numeric max_value
    }

    product_categories ||--o{ products : groups
    products ||--o{ product_specifications : defines
```

### 4. Formulas (core)

```mermaid
erDiagram
    formulas {
      uuid id PK
      text code UK
      uuid product_id FK
      uuid current_version_id FK
      text status
    }
    formula_versions {
      uuid id PK
      uuid formula_id FK
      int version_number
      uuid parent_version_id FK
      text branch
      text status
      bool is_locked
    }
    formula_items {
      uuid id PK
      uuid formula_version_id FK
      uuid raw_material_id FK
      uuid product_id FK
      int sequence_no
      numeric amount
      text unit_of_measure
      text role
    }
    formula_approvals {
      uuid id PK
      uuid formula_version_id FK
      text stage
      text decision
      uuid approver_id FK
    }

    formulas ||--o{ formula_versions : "has versions"
    formula_versions ||--o{ formula_versions : "parent_version_id"
    formula_versions ||--o{ formula_items : "composes"
    formula_versions ||--o{ formula_approvals : "approved by"
    raw_materials ||--o{ formula_items : "used in"
    products ||--o{ formula_items : "intermediate"
```

**Why this shape?**

- `formulas` is the long-lived recipe identity (a project).
- `formula_versions` are immutable once approved (`is_locked = true`). Every edit forks a new `version_number`. The `parent_version_id` lets you trace lineage; `branch` enables parallel exploration (e.g. `main`, `experiment-x`).
- `formula_items` belong to **one** version. The CHECK constraint `(raw_material_id IS NOT NULL XOR product_id IS NOT NULL)` allows an item to reference either a raw material or another product (intermediate formulas / sub-recipes).
- `formula_approvals` records the multi-stage gate (`lab_review`, `qa`, `regulatory`, `final`) — independent of the version `status` flag.

### 5. Experiments & Tests

```mermaid
erDiagram
    test_methods {
      uuid id PK
      text code UK
      text standard
      text data_type
    }
    experiments {
      uuid id PK
      text code UK
      uuid formula_version_id FK
      uuid product_id FK
      uuid task_id FK
      text experiment_type
      text status
      text outcome
    }
    test_results {
      uuid id PK
      uuid experiment_id FK
      uuid formula_version_id FK
      uuid product_id FK
      uuid raw_material_id FK
      uuid test_method_id FK
      numeric measured_value
      bool pass
    }

    formula_versions ||--o{ experiments : tested
    products ||--o{ experiments : "for"
    experiments ||--o{ test_results : produces
    test_methods ||--o{ test_results : applied
    raw_materials ||--o{ test_results : "incoming QA"
```

**`test_results` design notes:**

- A result references **at least one** subject (experiment, formula version, product, or raw material) — enforced by `CONSTRAINT test_results_subject_chk`.
- Multi-typed measurements: `measured_value` (numeric), `measured_text`, `measured_boolean`, or `measured_json` (spectra, time series).
- `pass` and `deviation_pct` enable automatic dashboards over time.
- `instrument_id` and `instrument_calibrated_at` enable forensic traceability.

### 6. R&D Tasks

```mermaid
erDiagram
    r_and_d_projects {
      uuid id PK
      text code UK
      uuid owner_id FK
      text status
    }
    r_and_d_tasks {
      uuid id PK
      text code UK
      uuid project_id FK
      uuid parent_task_id FK
      uuid assigned_to FK
      text status
      uuid related_formula_id FK
      uuid related_experiment_id FK
    }
    r_and_d_task_comments {
      uuid id PK
      uuid task_id FK
      uuid author_id FK
      uuid parent_comment_id FK
    }
    r_and_d_task_watchers {
      uuid task_id PK,FK
      uuid user_id PK,FK
    }

    r_and_d_projects ||--o{ r_and_d_tasks : groups
    r_and_d_tasks ||--o{ r_and_d_tasks : "subtask"
    r_and_d_tasks ||--o{ r_and_d_task_comments : discussion
    r_and_d_task_comments ||--o{ r_and_d_task_comments : reply
    r_and_d_tasks ||--o{ r_and_d_task_watchers : "followed by"
    formulas ||--o{ r_and_d_tasks : context
    experiments ||--o{ r_and_d_tasks : context
```

### 7. Knowledge & Rules

```mermaid
erDiagram
    knowledge_documents {
      uuid id PK
      text title
      text doc_type
      text status
      vector embedding
    }
    knowledge_chunks {
      uuid id PK
      uuid document_id FK
      int chunk_index
      vector embedding
    }
    expert_rules {
      uuid id PK
      text code UK
      text rule_type
      text severity
      jsonb condition_expr
      uuid source_doc_id FK
    }
    expert_rule_violations {
      uuid id PK
      uuid rule_id FK
      uuid formula_version_id FK
      text severity
      tstz resolved_at
    }

    knowledge_documents ||--o{ knowledge_chunks : "chunked into"
    knowledge_documents ||--o{ expert_rules : "source for"
    expert_rules ||--o{ expert_rule_violations : "fires"
    formula_versions ||--o{ expert_rule_violations : "violates"
```

**Why this shape?**

- `knowledge_documents` carries a document-level embedding for coarse retrieval; `knowledge_chunks` carries fine-grained embeddings for RAG.
- Both use `ivfflat (vector_cosine_ops)` indexes for ANN search.
- `expert_rules.condition_expr` is a JSONB DSL the rules engine evaluates against a formula version. Rules can be sourced from a knowledge document (`source_doc_id`) — the natural language description in the doc, the structured form in the rule.
- `expert_rule_violations` records every fire-event so you can dashboard recurring problems.

### 8. ML Lifecycle

```mermaid
erDiagram
    ml_datasets {
      uuid id PK
      text code UK
      text storage_url
      bigint row_count
    }
    ml_model_registry {
      uuid id PK
      text code UK
      text task_type
      uuid current_version_id FK
      text status
    }
    ml_model_versions {
      uuid id PK
      uuid model_id FK
      int version_number
      text artifact_url
      jsonb metrics
      text deployment_status
      uuid training_job_id FK
    }
    ml_training_jobs {
      uuid id PK
      text code UK
      uuid model_id FK
      uuid dataset_id FK
      text status
      jsonb metrics
      uuid produced_version_id FK
    }
    ml_inference_endpoints {
      uuid id PK
      uuid model_version_id FK
      text endpoint_url
      text status
    }

    ml_model_registry ||--o{ ml_model_versions : "has versions"
    ml_model_versions ||--o{ ml_model_versions : "fine-tunes (base)"
    ml_datasets ||--o{ ml_training_jobs : "trains on"
    ml_training_jobs ||--o{ ml_model_versions : "produces"
    ml_model_versions ||--o{ ml_inference_endpoints : "serves at"
```

### 9. Audit Logs

```mermaid
erDiagram
    audit_logs {
      bigserial id PK
      tstz occurred_at PK
      text trace_id
      uuid user_id FK
      text action
      text resource_type
      uuid resource_id
      jsonb before_state
      jsonb after_state
      jsonb changes
    }
    users ||--o{ audit_logs : "actor"
```

`audit_logs` is `PARTITION BY RANGE (occurred_at)`. Monthly partitions cover 2026 (`audit_logs_2026_01` through `audit_logs_2026_12`); a `_default` partition catches stragglers. Schedule a job (pg_partman or app-level) to pre-create partitions for the next 3-6 months and detach/archive old ones.

## Index summary (by usage)

| Pattern | Index type | Examples |
|---------|-----------|----------|
| `code` lookups | btree UNIQUE | `raw_materials.code`, `formulas.code`, `experiments.code` |
| Status filters on active rows | partial btree | `WHERE deleted_at IS NULL` on `status` |
| Tag containment (`tags @> ARRAY[...]`) | GIN | every `tags` column |
| JSONB containment / key access | GIN | `properties`, `metadata`, `condition_expr`, `metrics` |
| Free-text fuzzy match | GIN trigram | `raw_materials.name`, `formulas.name`, `products.name` |
| Vector similarity (cosine) | ivfflat | `knowledge_documents.embedding`, `knowledge_chunks.embedding` |
| Foreign-key joins | btree | every FK column has a non-unique btree |
| Time-series scans | btree DESC | `audit_logs.occurred_at`, `test_results.measured_at` |
| Composite identity | btree UNIQUE | `(formula_id, version_number)`, `(model_id, version_number)` |

## Operational notes

### Soft delete

Every entity table uses `deleted_at` for soft delete. Filter all reads with `WHERE deleted_at IS NULL` (this is encoded in the partial indexes for hot paths). For hard deletion, use a scheduled archival job that copies into a cold-storage table before `DELETE`.

### Optimistic locking

The `set_updated_at_and_version()` trigger increments `version` on every `UPDATE`. Application code should include `WHERE version = :expected_version` in updates to detect concurrent edits and return a 409 (`ConflictError`).

### Audit log writes

Audit rows are written in two ways:

1. **Synchronously** by the application service layer at every state-changing operation, with the diff pre-computed.
2. **Asynchronously** via a CDC stream / outbox if write volume becomes a concern.

Always include `trace_id` (matches the backend `x-trace-id` header) so a single request can be correlated across logs and DB audit.

### Partition maintenance for audit_logs

- A scheduled job creates the next month's partition before the boundary. (`audit_logs_2026_M+1` before the 1st of M+1.)
- Old partitions can be detached (`ALTER TABLE ... DETACH PARTITION`) and archived to S3/GCS as compressed dumps, satisfying long-term retention without bloating the hot DB.

### pgvector indexes

`ivfflat (vector_cosine_ops) WITH (lists = 100)` is tuned for ~10K – 1M rows. Re-tune `lists` (≈ √N) and run `ANALYZE` after large bulk loads. For very high recall, consider HNSW once pgvector ≥ 0.5 is in use.

### Cycles / deferred FKs

A few inter-domain FKs would create migration ordering cycles, so they're added in later migrations:

- `experiments.task_id → r_and_d_tasks.id` — added in `0008` after the tasks table exists.
- `formulas.current_version_id → formula_versions.id` — added in `0006` after versions exists.
- `products.current_formula_version_id → formula_versions.id` — added in `0006`.
- `ml_model_versions.training_job_id → ml_training_jobs.id` — added in `0010` after the jobs table.

This keeps every migration file self-contained and runnable in lexicographic order without orchestration.

### Migration ledger

`schema_migrations (version, applied_at, checksum, description)` records each applied file. The runner (`scripts/migrate.sh`) inserts a row with `ON CONFLICT DO NOTHING`, making re-runs safe. To inspect history:

```sql
SELECT version, applied_at, description
FROM schema_migrations
ORDER BY version;
```

### Multi-tenancy

This schema is single-tenant by default. To extend to multi-tenant SaaS, add a non-null `tenant_id UUID` column to every entity table, include it in every unique constraint, and enforce it via row-level security policies. Doing it as a follow-up migration keeps the initial schema readable.

## File index

```
infra/db/
├── migrations/
│   ├── 0001_init_extensions.sql      pgcrypto, uuid-ossp, vector, pg_trgm + ledger + trigger
│   ├── 0002_identity.sql             users, roles, permissions, user_roles, sessions
│   ├── 0003_audit_logs.sql           partitioned audit log
│   ├── 0004_raw_materials.sql        categories, suppliers, raw_materials, supplier specs
│   ├── 0005_products.sql             categories, products, product_specifications
│   ├── 0006_formulas.sql             formulas, formula_versions, formula_items, approvals
│   ├── 0007_experiments_tests.sql    test_methods, experiments, test_results
│   ├── 0008_rd_tasks.sql             projects, tasks, comments, watchers
│   ├── 0009_knowledge_rules.sql      knowledge_documents, chunks, expert_rules, violations
│   └── 0010_ml_registry.sql          datasets, model_registry, versions, jobs, endpoints
├── seeds/
│   ├── 01_users_and_roles.sql
│   ├── 02_materials_and_products.sql
│   ├── 03_formulas.sql
│   ├── 04_experiments_and_tests.sql
│   ├── 05_rd_tasks.sql
│   ├── 06_knowledge_and_rules.sql
│   └── 07_ml_registry.sql
├── scripts/
│   ├── migrate.sh        Run all migrations against $DATABASE_URL
│   ├── seed.sh           Run all seed files
│   └── docker-init.sh    Postgres entrypoint hook (compose mounts this)
└── ERD.md                This file
```

## Running locally

```bash
# Spin up postgres + run migrations + seed automatically (first time)
docker-compose up -d postgres

# Or apply against an existing DB:
DATABASE_URL=postgresql://fluidmind:fluidmind_dev@localhost:5432/fluidmind_dev \
  ./infra/db/scripts/migrate.sh

DATABASE_URL=postgresql://fluidmind:fluidmind_dev@localhost:5432/fluidmind_dev \
  ./infra/db/scripts/seed.sh
```

## What to add next

- `tenant_id` columns + RLS policies for multi-tenancy
- Trigger that auto-publishes audit_log entries from row diffs (or use a CDC stream)
- Materialized views for formula cost roll-ups and test-result dashboards
- Row-level security for sensitive resources (formulas, knowledge documents)
- Foreign data wrapper to expose ML training metrics in the analytics warehouse
