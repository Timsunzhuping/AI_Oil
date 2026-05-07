/**
 * Persistence for `prediction_logs`.
 *
 * The repository is intentionally thin — it only exposes operations that
 * the service needs. Single inserts use the pool directly; batch inserts
 * are wrapped in a transaction so a partial failure rolls back cleanly.
 */
import type { Pool, PoolClient } from 'pg';
import type { BomItem, PredictionRequestType, PredictionStatus, PredictorMode } from './types.js';

export interface InsertPredictionLogInput {
  request_type: PredictionRequestType;
  model_code: string;
  model_version: string;
  predictor_mode: PredictorMode;
  product_category: string | null;
  formula_version_id: string | null;
  target_metrics: string[];
  bom_items: BomItem[];
  request_payload: Record<string, unknown>;
  response_payload: Record<string, unknown> | null;
  status: PredictionStatus;
  error_class: string | null;
  error_message: string | null;
  duration_ms: number;
  trace_id: string;
  created_by: string | null;
  /** Set for batch entries; null otherwise. */
  batch_id: string | null;
  batch_index: number | null;
}

export interface PredictionLogRow extends InsertPredictionLogInput {
  id: string;
  created_at: Date;
}

export class PredictionLogsRepository {
  constructor(private readonly pool: Pool) {}

  async insert(row: InsertPredictionLogInput): Promise<{ id: string }> {
    return this.runInsert(this.pool, row);
  }

  async insertBatch(rows: InsertPredictionLogInput[]): Promise<{ ids: string[] }> {
    if (rows.length === 0) return { ids: [] };
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const ids: string[] = [];
      for (const row of rows) {
        const { id } = await this.runInsert(client, row);
        ids.push(id);
      }
      await client.query('COMMIT');
      return { ids };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async findById(id: string): Promise<PredictionLogRow | null> {
    const res = await this.pool.query<PredictionLogRow>(
      `SELECT * FROM prediction_logs WHERE id = $1`,
      [id]
    );
    return res.rows[0] ?? null;
  }

  async findByBatchId(batchId: string): Promise<PredictionLogRow[]> {
    const res = await this.pool.query<PredictionLogRow>(
      `SELECT * FROM prediction_logs WHERE batch_id = $1 ORDER BY batch_index ASC`,
      [batchId]
    );
    return res.rows;
  }

  async listRecent(limit = 50): Promise<PredictionLogRow[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    const res = await this.pool.query<PredictionLogRow>(
      `SELECT * FROM prediction_logs ORDER BY created_at DESC LIMIT $1`,
      [safeLimit]
    );
    return res.rows;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ──────────────────────────────────────────────────────────────────────

  private async runInsert(
    runner: Pool | PoolClient,
    row: InsertPredictionLogInput
  ): Promise<{ id: string }> {
    const res = await runner.query<{ id: string }>(
      `INSERT INTO prediction_logs (
         request_type, model_code, model_version, predictor_mode,
         product_category, formula_version_id, target_metrics, bom_items,
         request_payload, response_payload, status, error_class, error_message,
         duration_ms, batch_id, batch_index, trace_id, created_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING id`,
      [
        row.request_type,
        row.model_code,
        row.model_version,
        row.predictor_mode,
        row.product_category,
        row.formula_version_id,
        row.target_metrics,
        JSON.stringify(row.bom_items),
        JSON.stringify(row.request_payload),
        row.response_payload === null ? null : JSON.stringify(row.response_payload),
        row.status,
        row.error_class,
        row.error_message,
        row.duration_ms,
        row.batch_id,
        row.batch_index,
        row.trace_id,
        row.created_by,
      ]
    );
    return res.rows[0]!;
  }
}
