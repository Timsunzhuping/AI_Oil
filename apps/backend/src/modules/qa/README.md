# QA Assistant

`apps/backend/src/modules/qa` — enterprise knowledge QA service for R&D
users. Answers questions about raw materials, formula history, regulations,
and process knowledge using a classifier + retrieval + composer pipeline.

```
HTTP                        Service         Pipeline                 Sources
─────                       ───────         ────────                 ────────
POST /qa/ask           ─┐                                            ┌─ raw_material_kb
GET  /qa/history/:id   ─┼─▶ QaService ──▶  Classifier             ┐ │
POST /qa/feedback      ─┘        │           │                       │
                                 ▼           ▼                       │
                           QaRepository    Retriever  ──────────────▶├─ formula_kb
                          (qa_sessions     (KbPostgres /              │
                           qa_messages      EmptyRetriever /          │
                           qa_feedback)     custom)                   ├─ document_parse_results
                                 ▲           │                        │  (is_current=true,
                                 │           ▼                        │   review_status approved/edited)
                                 └───── Composer  ──▶ LlmAdapter      │
                                                       (mock-rules,   └─ (knowledge graph reserved)
                                                        OpenAI, …)
```

## Hard rule: every answer carries citations

If the retriever returns zero hits, the composer emits an explicit **no-source
fallback** message and `confidence=0`, `intent='no_match'`, `citations=[]`.
The service persists this fallback as the assistant message — but the
client receives `no_source_fallback: true` so the UI can show "we cannot
answer this without authoritative sources" instead of free-floating text.

## Endpoints

| Method | Path                            | Purpose                                                                |
| ------ | ------------------------------- | ---------------------------------------------------------------------- |
| `POST` | `/api/v1/qa/ask`                | Ask a question; creates a new session if `session_id` absent.          |
| `GET`  | `/api/v1/qa/history/:sessionId` | Conversation transcript (user + assistant turns, ordered).             |
| `POST` | `/api/v1/qa/feedback`           | Rate an assistant message (-1 / 0 / +1) + optional category & comment. |

All responses use the unified envelope `{ code, message, data, traceId, timestamp }`.

### Request — `POST /qa/ask`

```jsonc
{
  "question": "PAO-6 与 Group III 4cSt 的主要区别是什么？",
  "product_category": "engine_oil_pcmo", // optional
  "session_id": "…", // optional (resumes a thread)
  "max_citations": 5, // optional, 1..20
  "metadata": { "ui_source": "workbench" }, // optional
}
```

### Response — `POST /qa/ask`

```jsonc
{
  "code": 0,
  "message": "Answer generated",
  "data": {
    "session_id": "…",
    "user_message_id": "…",
    "message_id": "…",
    "answer": "关于该原材料，知识库中相关的可参考要点：\n[1] 「原材料知识库·PAO-6 (RMK-2026-0001)」 高黏度指数合成基础油……",
    "citations": [
      {
        "source_type": "raw_material_kb",
        "source_id": "…",
        "title": "PAO-6 (RMK-2026-0001)",
        "snippet": "高黏度指数合成基础油，常用于全合成机油。",
        "relevance": 0.92,
      },
    ],
    "confidence": 0.876,
    "intent": "raw_material_lookup",
    "intent_confidence": 0.75,
    "llm_adapter": "mock-rules",
    "llm_version": "v1",
    "trace_id": "…",
    "duration_ms": 12,
    "no_source_fallback": false,
  },
  "traceId": "…",
  "timestamp": "…",
}
```

### `POST /qa/feedback`

```jsonc
{
  "message_id": "<assistant message uuid>",
  "rating": 1, // -1 | 0 | 1
  "category": "great", // optional
  "comment": "answer was concise and relevant", // optional
}
```

`rating=-1` → user found the answer wrong / unhelpful;
`rating=0` → neutral / informational;
`rating=1` → user thumbs-up.

## Pipeline details

### 1. Intent classifier (`pipeline/classifier.ts`)

Rule-based, language-agnostic keyword scoring. Returns `intent` ∈
`raw_material_lookup` / `formula_history` / `regulation` / `process` /
`general`, plus `intent_confidence` ∈ [0, 1] and the matched rule names.
Swap by implementing `IntentClassifier`.

### 2. Retrieval layer (`adapters/retrieval/`)

`RetrieverAdapter.retrieve({question, intent, product_category, limit})`
returns `RetrievalHit[]`. Default implementation: `KbPostgresRetriever`
searches three sources with ILIKE + relevance scoring:

| Source            | Where                                                                                                                | Notes                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `raw_material_kb` | tables `raw_material_kb` (status ≠ archived)                                                                         | encyclopedic notes about raw materials        |
| `formula_kb`      | tables `formula_kb` (status ≠ archived)                                                                              | encyclopedic notes about formulas             |
| `parse_result`    | `document_parse_results` (`is_current=true` AND `review_status` ∈ {approved, edited}) joined with `document_records` | only HUMAN-APPROVED extractions are queryable |

Source-type alignment with intent gets a small boost (e.g. `raw_material_lookup`
+0.10 to `raw_material_kb` hits). Knowledge-graph or vector-store retrievers
plug in as another `RetrieverAdapter` implementation.

### 3. Answer composer (`pipeline/composer.ts`)

Calls the LLM adapter with the trimmed citation list, then aggregates
confidence as `0.6 × retrieval_avg + 0.4 × adapter_confidence`, multiplied
by an intent-confidence blend in [0.85, 1.0]. The composer is the
authoritative source of the no-source fallback.

### 4. LLM adapter (`adapters/llm/`)

`LlmAdapter.compose({question, intent, citations, product_category})` →
`{answer, confidence, meta}`. Default `MockLlmAdapter` renders a
deterministic template with citation bracketing (`[1]`, `[2]`, …).
Concrete adapters can call OpenAI / Anthropic / Qwen / local vLLM —
implement the interface and pass via `buildQaModule({ llm: yourAdapter })`.

## Database

`qa_sessions` — one per conversation (`QA-YYYY-NNNNNN`); `message_count` /
`last_message_at` updated on every turn; `metadata` stores arbitrary
client-side context (UI source, locale, etc.).

`qa_messages` — both user (`role='user'`) and assistant (`role='assistant'`)
rows. Assistant rows carry `citations` (JSONB), `retrieval_summary`,
`llm_adapter`, `llm_version`, `confidence`, `intent`, `intent_confidence`,
and `parent_message_id` linking back to the user's question.

`qa_feedback` — `rating ∈ {-1, 0, 1}` plus optional `category` and `comment`.
Indexed by `message_id`, `session_id`, `rating`.

See migration
[`infra/db/migrations/0019_qa.sql`](../../../../infra/db/migrations/0019_qa.sql).

## Tests

```
tests/unit/qa/
  classifier.test.ts   intent routing across CN/EN questions, confidence bounds
  retrieval.test.ts    tokenise / scoreCandidate / snippet / rankAndCap +
                       EmptyRetriever
  composer.test.ts     no-source fallback, citation cap+order, LLM identity,
                       aggregateConfidence weighting
  service.test.ts      ask/history/feedback over a fake repository — covers
                       new sessions, resume, archived rejection, error paths,
                       persistence of citations + intent
  schemas.test.ts      Zod parsing for /ask, /feedback, :sessionId param
  _fakes.ts            FakeQaRepository + StaticRetriever + ThrowingRetriever
```

Run only the QA tests:

```bash
pnpm --filter @fluidmind/backend test -- tests/unit/qa
```

## Wiring

Mounted at `/api/v1/qa` from `src/routes/v1/index.ts` whenever `pool` and
`logger` are both available.

## Extending

| Need                                         | Where to plug                                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Replace rule-based classifier with an ML one | implement `IntentClassifier`, pass via `buildQaModule({ classifier })`                         |
| Use OpenAI / Anthropic / on-prem LLM         | implement `LlmAdapter`, pass via `buildQaModule({ llm })`                                      |
| Add vector / knowledge-graph retrieval       | implement `RetrieverAdapter`, pass via `buildQaModule({ retriever })`                          |
| Add a new citation source type               | extend `CITATION_SOURCE_TYPES` + retriever code (DB query); composer handles it transparently. |
| Add per-user RBAC filtering                  | wrap `RetrieverAdapter` so each call narrows the query by `metadata.user_role` etc.            |

## Environment variables

| Var           | Default | Purpose                                                                                                                                                      |
| ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `QA_LLM_MODE` | `mock`  | Reserved hook to swap adapters via env (factory currently always returns mock; honour-the-flag wiring is left to caller-side `buildQaModule({ llm: ... })`). |
