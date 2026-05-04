# Master Data Management Module

The single, governed entry point for FluidMind's reference data — raw materials, products, suppliers, test metrics, units, and the alias mappings that bridge messy real-world inputs to clean standard records.

```
/api/v1/master-data
├── /materials      raw material master + aliases + alias resolve
├── /suppliers      vendor master
├── /products       finished/semi-finished products + nested specifications
├── /metrics        metric_name_std dictionary + aliases + resolve
├── /units          unit_std dictionary + aliases + conversion engine
├── /aliases        cross-resource alias browser (read + delete)
└── /import         CSV/XLSX bulk import with structured error reports
```

## Table of contents

- [Why this module exists](#why-this-module-exists)
- [REST API reference](#rest-api-reference)
- [Standardization & aliases](#standardization--aliases)
- [Unit conversion](#unit-conversion)
- [Bulk import](#bulk-import)
- [Database schema](#database-schema)
- [Testing](#testing)

## Why this module exists

Downstream consumers (formulation engine, ML training, analytics) all depend on **one canonical name and unit per concept**. Without a master-data layer:

- "pH", "PH", "p.H.", "酸碱度" become four different metrics
- "kg", "Kg", "kilogram", "公斤" become four different units
- "Mineral Oil 150N", "150 Neutral", "PB-150N" become three different materials

This module is the place where:

1. **Standard records** live (one row per concept, with a stable `code`).
2. **Aliases** are mapped to those standard records (with provenance & confidence).
3. **Bulk import** is sanitized — every CSV/XLSX upload runs through validators that produce a structured **error report** rather than partial / silently-bad writes.
4. **Conversions** between equivalent units happen via a small linear engine.

The result: every other module sees clean, standardized references and never has to second-guess what "kg" means.

## REST API reference

All responses follow the platform's unified envelope:

```json
{
  "code": 0,
  "message": "success",
  "data": ...,
  "traceId": "uuid-...",
  "timestamp": "2026-05-04T12:00:00Z"
}
```

### Materials

| Method | Path | Body / Query |
|--------|------|---------------|
| GET    | `/master-data/materials`                     | `?page=1&pageSize=20&q=text&category_id=...&status=active&tag=...&orderBy=...&orderDir=...` |
| GET    | `/master-data/materials/:id`                 | — |
| POST   | `/master-data/materials`                     | `MaterialCreateSchema` |
| PATCH  | `/master-data/materials/:id`                 | `MaterialUpdateSchema` (incl. `expected_version` for optimistic lock) |
| DELETE | `/master-data/materials/:id`                 | — (soft delete) |
| GET    | `/master-data/materials/resolve?q=foo`       | resolves a free-form name → standard record |
| GET    | `/master-data/materials/:id/aliases`         | list aliases |
| POST   | `/master-data/materials/:id/aliases`         | `{ alias, alias_type?, language?, source? }` |

### Suppliers

| Method | Path |
|--------|------|
| GET    | `/master-data/suppliers` (filter by `qualification_status`, `country_code`) |
| GET / POST / PATCH / DELETE  | `/master-data/suppliers[/:id]` |

### Products

| Method | Path |
|--------|------|
| GET    | `/master-data/products` (filter by `status`, `product_type`, `category_id`, `tag`) |
| GET    | `/master-data/products/:id` (returns nested `specifications`) |
| POST / PATCH / DELETE | `/master-data/products[/:id]` |
| GET    | `/master-data/products/:id/specifications` |
| POST   | `/master-data/products/:id/specifications` (upsert by `(product_id, spec_code)`) |

### Metrics

| Method | Path |
|--------|------|
| GET    | `/master-data/metrics` (filter by `category`, `data_type`, `is_active`) |
| GET    | `/master-data/metrics/resolve?q=foo`        | code → alias → fuzzy fallback |
| GET / POST / PATCH / DELETE | `/master-data/metrics[/:id]` |
| GET    | `/master-data/metrics/:id/aliases` |
| POST   | `/master-data/metrics/:id/aliases` |

### Units

| Method | Path |
|--------|------|
| GET    | `/master-data/units` (filter by `dimension`, `is_active`) |
| GET    | `/master-data/units/resolve?q=Kilogram` |
| GET    | `/master-data/units/convert?from=C&to=F&value=25` |
| GET / POST / PATCH / DELETE | `/master-data/units[/:id]` |
| POST   | `/master-data/units/:id/aliases` |

### Aliases (cross-resource)

| Method | Path | Notes |
|--------|------|-------|
| GET    | `/master-data/aliases?type=material\|metric\|unit&q=...` | unified browser |
| DELETE | `/master-data/aliases/:type/:id` | soft delete |

> Per-resource alias creation lives on the resource itself (e.g. `POST /materials/:id/aliases`) so the foreign key target is unambiguous.

### Import

| Method | Path | Body |
|--------|------|------|
| POST   | `/master-data/import` | `multipart/form-data` with `file` (CSV or XLSX) and form fields `target` and `mode` |
| GET    | `/master-data/import/jobs` | recent imports (filter by `target`, `status`) |
| GET    | `/master-data/import/jobs/:id` | full report for a past import |

## Standardization & aliases

### How "match a free-form input to a standard" works

`/master-data/{resource}/resolve?q=Foo` runs a 3-stage cascade:

1. **Exact code match** (`LOWER(code) = lower(q)`) — confidence = 1.0
2. **Governed alias** in `*_aliases.alias_normalized` (lowercased, trimmed) — confidence = the alias's `confidence` value (default 1.0)
3. **Fuzzy trigram** match on `name` — confidence = `pg_trgm.similarity()`, returned only if > 0.4

The response always includes:

```json
{
  "query": "raw input",
  "matched": true,
  "matched_by": "code | alias | fuzzy | null",
  "confidence": 0.0-1.0,
  "material": { ...standard record... } | null
}
```

### Alias governance

- Every alias carries `source` (`manual` | `import` | `auto_suggested`) and `confidence`.
- `is_active = TRUE` means the alias is consulted; deactivating retains history but stops resolution.
- A given **normalized alias is globally unique** within its scope — you cannot accidentally map the same string to two different materials.

```sql
CREATE UNIQUE INDEX raw_material_aliases_global_uniq
  ON raw_material_aliases (alias_normalized)
  WHERE is_active = TRUE AND deleted_at IS NULL;
```

## Unit conversion

`GET /master-data/units/convert?from=C&to=F&value=25` returns:

```json
{
  "code": 0, "message": "success",
  "data": {
    "value": 77,
    "from": "C",
    "to": "F",
    "factor": 1.8,
    "offset": 32,
    "formula": "F = C * 9/5 + 32"
  }
}
```

How it's computed:

1. Each side is resolved through the alias chain (so `Kilogram` → `kg` automatically).
2. If the two units share a `dimension`, look up `unit_conversions(from_unit_id, to_unit_id)`.
3. Apply `value * factor + offset`.
4. If no direct rule, attempt an **indirect path** through the `base_unit_code` of the dimension — e.g. `cSt → mm²/s` works without an explicit row because both reduce to the same base.

For non-linear conversions, `formula` is human-readable; the rules engine on the application side can dispatch on it if needed.

## Bulk import

### Targets

`materials`, `products`, `suppliers` *(coming soon)*, `metrics`, `units`, `material_aliases`, `metric_aliases`, `unit_aliases`.

Each target has a strict zod schema in `import/validators.ts`. Headers are case-insensitive; common types are coerced (numbers from strings, booleans from `yes/no/true/false/1/0`, tag arrays from `|`/`,`/`;` separators).

### Modes

| Mode      | Behavior |
|-----------|----------|
| `insert`  | error if `code` already exists |
| `update`  | error if `code` does not exist |
| `upsert`  | default — insert or update by `code` |
| `dry_run` | parse + validate only; **no DB writes**. Returns the same error report. |

### Request

```bash
curl -X POST http://localhost:3001/api/v1/master-data/import \
  -F file=@infra/db/sample-imports/materials.csv \
  -F target=materials \
  -F mode=upsert
```

### Response (HTTP 200 / 207 / 422)

- **200** — full success
- **207** *(Multi-Status)* — partial: some rows applied, others rejected
- **422** — failed: zero rows written (or whole transaction rolled back)

```json
{
  "code": 0,
  "message": "Import partial",
  "data": {
    "job_id": "uuid",
    "target": "materials",
    "source_filename": "materials.csv",
    "source_format": "csv",
    "mode": "upsert",
    "total_rows": 7,
    "success_count": 6,
    "error_count": 1,
    "warning_count": 0,
    "skipped_count": 0,
    "duration_ms": 124,
    "status": "partial",
    "errors": [
      {
        "row": 8,
        "field": "code",
        "value": "",
        "message": "String must contain at least 1 character(s)",
        "code": "too_small"
      },
      {
        "row": 8,
        "field": "physical_state",
        "value": "gel",
        "message": "Invalid enum value",
        "code": "invalid_enum_value"
      }
    ],
    "warnings": []
  },
  "traceId": "...",
  "timestamp": "..."
}
```

### Import safety

- **Whole-row transaction**: all valid rows are applied within a single transaction. If a row apply fails (e.g., FK violation), it is captured into `errors` and the transaction continues with the next row. Top-level rollback only happens on a hard error.
- **Job ledger**: every import is persisted in the `import_jobs` table with the full structured `error_report`. View past imports with `GET /master-data/import/jobs`.
- **Foreign-key resolution**: import rows reference parents by `code` (e.g. `category_code`, `default_supplier_code`) — the import service resolves these to UUIDs, returning a clear error if the referenced record doesn't exist.

### Sample files

CSV samples are under `infra/db/sample-imports/`:

```
materials.csv         materials with one intentionally invalid row
products.csv          three sample products
metrics.csv           four sample metrics
units.csv             five sample units
material_aliases.csv  aliases for the materials sample
```

## Database schema

This module owns:

- `units`, `unit_aliases`, `unit_conversions`
- `metrics`, `metric_aliases`
- `raw_material_aliases`
- `import_jobs`

Existing tables it consumes (without modifying):

- `raw_materials` (migration 0004)
- `suppliers` (0004)
- `material_categories` (0004)
- `products`, `product_categories`, `product_specifications` (0005)

See `infra/db/migrations/0011_master_data.sql` and `infra/db/ERD.md` for full DDL and a reference diagram.

## Testing

```bash
pnpm -F @fluidmind/backend test
```

Module-specific suites in `apps/backend/tests/unit/master-data/`:

- `parsers.test.ts` — CSV (BOM, quoting, trim) and XLSX parsing
- `validators.test.ts` — every import schema, type coercion, partition behavior
- `sql.test.ts` — `paginationClause`, `buildUpdateSet`, `normalizeAlias`

For end-to-end coverage spin up Postgres via Docker Compose (which auto-runs migrations + seeds), then point `DATABASE_URL` at it and run `pnpm test`. Integration tests against a real DB live at `tests/integration/master-data/*` (add as needed).

## Adding a new resource type

1. Create a migration under `infra/db/migrations/` for the table.
2. Add an import schema in `import/validators.ts` and register it in `SCHEMA_BY_TARGET`.
3. Implement `applyOne` branch in `import/import.service.ts` (with FK resolution by code).
4. Add a sub-router under `modules/master-data/<resource>/index.ts` mirroring the materials/units patterns.
5. Mount it in `modules/master-data/index.ts`.
6. Add tests + sample CSV under `infra/db/sample-imports/`.

The `materials` module (split into `schemas / repository / service / routes`) is the canonical full-shape example — clone its layout for high-touch resources. Simpler resources can live in a single `index.ts` (see `suppliers/`, `units/`, `metrics/`).
