/**
 * Integration framework shared types.
 *
 * The `Adapter` interface is the contract every connector must satisfy. By
 * keeping this layer narrow, we can swap mocks for real SAP/LIMS/S3 clients
 * without touching the job runner, retry, or scheduler.
 */

export type SourceType = 'sap' | 'lims' | 'file';

export type JobType = 'full_sync' | 'incremental_sync' | 'manual' | 'test';

export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'partial'
  | 'cancelled'
  | 'timeout';

export type JobPhase = 'init' | 'extract' | 'transform' | 'load' | 'retry' | 'finalize';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Adapter-defined opaque cursor. Stored as JSONB in `sync_snapshots.cursor_value`.
 */
export type Cursor = Record<string, unknown>;

export interface SourceRow {
  id: string;
  code: string;
  name: string;
  source_type: SourceType;
  config: Record<string, unknown>;
  secret_ref: string | null;
  supported_entities: string[];
  default_retry_max: number;
  default_retry_backoff_ms: number;
  is_active: boolean;
}

export interface ExtractContext {
  source: SourceRow;
  entityType: string;
  jobId: string;
  traceId: string;
  /**
   * Maximum number of records the runner wants per call. Adapters MAY
   * yield more (it's only a hint), but should not yield indefinitely.
   */
  batchHint: number;
  /**
   * Test toggle — adapters can return early or short-circuit when set.
   */
  dryRun?: boolean;
}

/**
 * A single record produced by `extract`. The runner doesn't introspect
 * `payload` beyond passing it to `load`. `external_id` is the upstream
 * primary key; `external_updated_at` (when present) is what cursor-based
 * incremental sync uses to advance the watermark.
 */
export interface AdapterRecord<TPayload = unknown> {
  external_id: string;
  external_updated_at?: Date | string | null;
  payload: TPayload;
}

/**
 * What the adapter knows about its own entity types — useful for the
 * registry's `listEntityTypes()` introspection in the UI.
 */
export interface EntityCapability {
  entity_type: string;
  supports_full: boolean;
  supports_incremental: boolean;
  cursor_shape: string; // human-readable hint, e.g. "{ since: ISO8601 }"
}

/**
 * Result of an adapter's connection test.
 */
export interface ConnectionTestResult {
  ok: boolean;
  latency_ms: number;
  details?: Record<string, unknown>;
  error?: string;
}

/**
 * The adapter contract. Adapters are stateless; configuration is passed in
 * via `connect()` for each run. Mock adapters can ignore connect.
 */
export interface Adapter {
  readonly sourceType: SourceType;

  capabilities(): EntityCapability[];

  testConnection(source: SourceRow): Promise<ConnectionTestResult>;

  /**
   * Stream every record (cursor ignored) for a full re-sync.
   */
  extractFull(ctx: ExtractContext): AsyncIterable<AdapterRecord>;

  /**
   * Stream records strictly after `cursor`. The runner advances
   * `sync_snapshots.cursor_value` to the LAST record's
   * `external_updated_at` (or whatever the adapter encodes) on success.
   */
  extractIncremental(ctx: ExtractContext, cursor: Cursor | null): AsyncIterable<AdapterRecord>;

  /**
   * Compute the next cursor given the most recent record this run produced.
   * Returning `null` means "no advance" (e.g., no records seen).
   */
  nextCursor(currentCursor: Cursor | null, lastRecord: AdapterRecord | null): Cursor | null;
}

/**
 * Loaded record outcome. The runner aggregates these into the job counters.
 */
export type LoadOutcome = 'inserted' | 'updated' | 'unchanged' | 'failed';

export interface LoadResult {
  outcome: LoadOutcome;
  destination_id?: string;
  error?: string;
}

/**
 * The "load" step is supplied by the runner caller. It receives one record
 * at a time and writes it to the canonical destination (raw_materials,
 * test_results, knowledge_documents, ...). Returning `failed` lets the
 * runner record the row-level error without aborting the whole batch.
 */
export type Loader<T = unknown> = (
  record: AdapterRecord<T>,
  ctx: ExtractContext
) => Promise<LoadResult>;
