# Knowledge & Document Module

`apps/backend/src/modules/knowledge` — original-material / formula knowledge
base + document upload + OCR / extraction pipeline + human-review API.

```
HTTP                                Service            Pipeline                    Tables
─────                               ───────            ────────                     ──────
POST /knowledge/raw-materials  ─┐                                                  raw_material_kb
GET  /knowledge/raw-materials  ─┤
PATCH … DELETE                  │
POST /knowledge/formulas       ─┼─▶ KnowledgeService                              formula_kb
GET  /knowledge/formulas       ─┤        │
PATCH … DELETE                  │        │
                                 │        ▼
POST /docs/upload (multipart)  ─┤   StorageAdapter ──▶ Local FS / Memory / S3      document_records
POST /docs/parse/:id           ─┼─▶ ParseRunner   ──▶ ParserRegistry              document_parse_tasks
GET  /docs/:id                 ─┤        │             ├─ MockOcrAdapter           document_parse_results
GET  /docs/:id/results         ─┤        │             └─ (real ones plug in)
POST /docs/:id/confirm         ─┘        │
                                          ▼
                                    Promote to KB (optional)
```

## Endpoints

### Knowledge base CRUD

| Method   | Path                                  | Purpose                                   |
| -------- | ------------------------------------- | ----------------------------------------- |
| `GET`    | `/api/v1/knowledge/raw-materials`     | List, paginated; filter by `status`, `q`. |
| `POST`   | `/api/v1/knowledge/raw-materials`     | Create a raw-material KB entry.           |
| `GET`    | `/api/v1/knowledge/raw-materials/:id` | Read.                                     |
| `PATCH`  | `/api/v1/knowledge/raw-materials/:id` | Partial update.                           |
| `DELETE` | `/api/v1/knowledge/raw-materials/:id` | Soft-delete.                              |
| `GET`    | `/api/v1/knowledge/formulas`          | List.                                     |
| `POST`   | `/api/v1/knowledge/formulas`          | Create.                                   |
| `GET`    | `/api/v1/knowledge/formulas/:id`      | Read.                                     |
| `PATCH`  | `/api/v1/knowledge/formulas/:id`      | Partial update.                           |
| `DELETE` | `/api/v1/knowledge/formulas/:id`      | Soft-delete.                              |

### Documents

| Method | Path                       | Purpose                                                               |
| ------ | -------------------------- | --------------------------------------------------------------------- |
| `POST` | `/api/v1/docs/upload`      | multipart/form-data — field `file` + JSON metadata fields.            |
| `GET`  | `/api/v1/docs`             | List documents, paginated.                                            |
| `POST` | `/api/v1/docs/parse/:id`   | Enqueue a parse task; runner processes synchronously by default.      |
| `GET`  | `/api/v1/docs/:id`         | `{ document, current_result, active_task }`.                          |
| `GET`  | `/api/v1/docs/:id/results` | All versioned results (newest first).                                 |
| `POST` | `/api/v1/docs/:id/confirm` | `action: 'approve' \| 'reject' \| 'edit'` + optional `promote_to_kb`. |

All responses use the unified envelope `{ code, message, data, traceId, timestamp }`.

## State machines

### Document lifecycle

```
uploaded ── /parse ──▶ parsing ──(success)──▶ parsed ──(auto)──▶ review
   │                       │                                         │
   │                       └─(fail)──▶ parsed (with failed task) ──▶ retry /parse
   │                                                                 │
   │                                                                 ▼
   │                                                       confirmed | rejected
   └────────────────────── any time ──────────────────────────▶ archived
```

### Parse task lifecycle

```
queued ──▶ processing ──▶ succeeded
                       └▶ failed
queued ──▶ cancelled
```

State transitions are guarded by `assertDocumentTransition` /
`assertTaskTransition` in `state-machine.ts`.

## Async parse runner

`workers/parse-runner.ts` drains `document_parse_tasks`:

- `runner.runTask(id)` — process ONE task synchronously (used by `/docs/parse`)
- `runner.drain()` — empty the queue (used by tests / cron)
- `runner.start(intervalMs)` — background polling loop

Concurrent workers are safe: `claimNextQueuedTask()` uses
`SELECT … FOR UPDATE SKIP LOCKED` so two workers never grab the same row.

Task failure path: parser throws → task goes `failed` with `error_class`/`error_message`
captured; the document stays in its prior status so the user can call
`/docs/parse/:id` again (which creates a new task row, preserving audit history).

## Versioned extraction results

Each `appendParseResult` call:

1. Demotes any current result for the document (`is_current = false`)
2. Inserts a new row with `result_version = max(...) + 1` and `is_current = true`
3. Defaults `review_status = 'pending'`

Manual edits during `/docs/:id/confirm { action: 'edit' }` produce a NEW row
with `origin = 'manual'` so prior versions are preserved for audit.

## Storage

`StorageAdapter` interface (`adapters/storage/types.ts`):

```ts
put({ key, body, contentType, originalName? }) → { key, url, size, contentType, checksumSha256 }
get(key) → Buffer
delete(key) → boolean
provider() → 'local' | 's3' | 'memory' | 'external'
```

Implementations:

- `LocalFileStorage` — files under `DOC_STORAGE_PATH ?? './var/uploads'`
- `InMemoryStorage` — tests / smoke flows
- (S3-compatible left as an exercise; bring your own client and implement the interface.)

`buildStorageKey(docCode, originalName, ext)` produces a path-traversal-safe key
shaped as `<yyyy>/<mm>/<dd>/<docCode>/<timestamp>-<safe-name>.<ext>`.

## OCR / parser adapter

`ParserAdapter` interface (`adapters/ocr/types.ts`):

```ts
supports(mime) → boolean
parse({ body, mimeType, originalName, options }, task) → ParserOutput
```

`ParserOutput` shape:

```ts
{
  raw_text,
  structured_payload,        // shape varies by document kind
  extracted_fields,          // shallow flattened key/value
  page_snippets?,
  confidence,                // 0..1
  language?,
  page_count?,
  search_keywords?,
  origin?,                   // defaults to 'ocr'
  parser_name,
  parser_version,
}
```

The shipped `MockOcrAdapter` returns deterministic synthetic content keyed
by SHA-256 of the input — perfect for tests and demos. Plug in
Tesseract / pdf-parse / Azure Document Intelligence / GCP Document AI by
implementing `ParserAdapter` and registering it via
`buildOcrRegistry({ registry: new ParserRegistry([yourAdapter, mock]) })`.

## Database design

### `raw_material_kb` (encyclopedic notes about raw materials)

| Column                                                                                 | Type                  | Notes                                    |
| -------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------- |
| `id`                                                                                   | UUID PK               |                                          |
| `code`                                                                                 | TEXT UNIQUE           | `RMK-YYYY-NNNN`                          |
| `name`, `category`, `raw_material_id`                                                  | TEXT / FK             | Optional master link.                    |
| `summary`, `technical_notes`, `usage_guidance`, `regulatory_notes`, `storage_handling` | TEXT                  |                                          |
| `properties`                                                                           | JSONB                 | Free-form key-values.                    |
| `embedding_text`, `embedding_vector`, `embedding_model`, `search_keywords`             | text/numeric[]/text[] | Reserved for the future RAG/QA pipeline. |
| `source_document_id`, `source_result_id`                                               | UUID FK               | When promoted from a document.           |
| `status`                                                                               | TEXT                  | `draft`/`published`/`archived`.          |
| audit fields                                                                           | …                     | created/updated/deleted/version.         |

### `formula_kb`

Same shape as `raw_material_kb` plus:

| Column                                                            | Notes                      |
| ----------------------------------------------------------------- | -------------------------- |
| `title`, `product_category`, `application_scene`                  | UI labels.                 |
| `related_formula_id`, `related_formula_version_id`                | Optional master link.      |
| `composition_overview`, `performance_highlights`, `process_notes` | Long-form notes.           |
| `sample_bom`, `target_metrics`                                    | JSONB structured excerpts. |

### `document_records`

| Column                                                                      | Notes                                                           |
| --------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `code`                                                                      | `DOC-YYYY-NNNN`                                                 |
| `doc_type`                                                                  | `datasheet`/`test_report`/`formula_card`/`sop`/`image`/`other`. |
| `category`                                                                  | `raw_material`/`formula`/`test`/`process`/`regulatory`/`other`. |
| `mime_type`, `file_extension`, `size_bytes`, `checksum_sha256`              | Physical file metadata.                                         |
| `storage_provider` (local/s3/memory/external), `storage_key`, `storage_url` | Adapter-agnostic storage pointer.                               |
| `page_count`, `language`, `language_detected`                               | Filled by the parser.                                           |
| `status`                                                                    | Document lifecycle state.                                       |
| `related_raw_material_id`, `related_formula_id`, `related_supplier_id`      | Master-data links.                                              |
| `search_keywords`, `tags`, `metadata`, `visibility`                         | Index/UX fields.                                                |

### `document_parse_tasks`

| Column                                      | Notes                                                   |
| ------------------------------------------- | ------------------------------------------------------- |
| `task_type`                                 | `ocr`/`extract_structured`/`full_parse`/`classify`.     |
| `status`                                    | `queued`/`processing`/`succeeded`/`failed`/`cancelled`. |
| `parser_name`, `parser_version`, `options`  | Adapter snapshot + per-call options.                    |
| `attempt_count`, `max_attempts`             | Retry bookkeeping.                                      |
| `started_at`, `completed_at`, `duration_ms` | Latency.                                                |
| `error_class`, `error_message`, `trace_id`  | Failure forensics.                                      |

### `document_parse_results`

| Column                                                                          | Notes                                                 |
| ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `result_version`                                                                | 1, 2, 3, … `(document_id, result_version)` is unique. |
| `is_current`                                                                    | Exactly one row per document at any time.             |
| `origin`                                                                        | `ocr` / `extractor` / `manual` / `merged`.            |
| `confidence`                                                                    | 0..1 average.                                         |
| `raw_text`, `structured_payload`, `extracted_fields`, `page_snippets`           | Parser outputs.                                       |
| `review_status`, `reviewer_id`, `reviewed_at`, `review_comment`, `manual_edits` | Human-review fields.                                  |
| `linked_raw_material_kb_id`, `linked_formula_kb_id`                             | Set when `/confirm` promotes to KB.                   |
| `embedding_text`, `embedding_vector`, `search_keywords`                         | Reserved for RAG.                                     |

See migration
[`infra/db/migrations/0018_knowledge_documents.sql`](../../../../infra/db/migrations/0018_knowledge_documents.sql).

## Tests

```
tests/unit/knowledge/
  state-machine.test.ts   document & task transitions, including legality checks
  storage.test.ts         InMemoryStorage / LocalFileStorage / buildStorageKey safety
  ocr.test.ts             MockOcrAdapter determinism + doc-kind inference + registry
  parse-runner.test.ts    success/failure paths, drain, idempotent runTask
  service.test.ts         KB CRUD, upload+parse, re-parse versioning,
                          confirm approve/reject/edit, KB promotion
  schemas.test.ts         Zod parsing, normaliseTags / normaliseMetadata helpers
```

Run only the knowledge tests:

```bash
pnpm --filter @fluidmind/backend test -- tests/unit/knowledge
```

## Wiring

Mounted at `/api/v1/knowledge` (KB CRUD) and `/api/v1/docs` (upload + parse +
review) from `src/routes/v1/index.ts` whenever the pool and logger are available.

## Environment variables

| Var                    | Default         | Purpose                                   |
| ---------------------- | --------------- | ----------------------------------------- |
| `DOC_STORAGE_PROVIDER` | `local`         | `local` (filesystem) or `memory` (tests). |
| `DOC_STORAGE_PATH`     | `./var/uploads` | Filesystem root for `LocalFileStorage`.   |
| `DOC_UPLOAD_MAX_MB`    | `25`            | Per-file size cap enforced by multer.     |
