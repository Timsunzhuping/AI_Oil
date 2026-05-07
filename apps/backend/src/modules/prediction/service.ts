/**
 * Forward Prediction Service.
 *
 * Coordinates: input parsing → adapter dispatch → spec/risk derivation →
 * prediction_logs persistence → response shaping. Knows nothing about
 * Express; controllers translate exceptions into HTTP via the global
 * error handler.
 */
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { BadRequestError, UpstreamError } from '../../lib/errors.js';
import type { ExplainOutput, PredictorAdapter } from './adapters/types.js';
import type { PredictionLogsRepository, InsertPredictionLogInput } from './repository.js';
import type {
  BatchPredictRequest,
  BatchPredictionResponse,
  ExplainPredictRequest,
  ModelVersionInfo,
  PredictedMetric,
  PredictionResponse,
  PredictionStatus,
  RiskWarning,
  SinglePredictRequest,
} from './types.js';

export interface PredictionServiceDeps {
  adapter: PredictorAdapter;
  repository: PredictionLogsRepository | null;
  logger: Logger;
}

export class PredictionService {
  constructor(private readonly deps: PredictionServiceDeps) {}

  /** Returns the adapter's identity (mode/version/supported metrics). */
  getModelVersion(): ModelVersionInfo {
    return this.deps.adapter.info();
  }

  // ────────────────────────────────────────────────────────────────────
  // /predict/single
  // ────────────────────────────────────────────────────────────────────
  async predictSingle(
    req: SinglePredictRequest,
    ctx: { trace_id: string; user_id: string | null }
  ): Promise<PredictionResponse> {
    const startedAt = Date.now();
    const info = this.deps.adapter.info();

    const { metrics, response, error } = await this.runOne(req);
    const duration_ms = Date.now() - startedAt;

    const status: PredictionStatus = error ? 'failed' : 'success';

    await this.safeLog({
      request_type: 'single',
      model_code: info.code,
      model_version: info.version,
      predictor_mode: info.mode,
      product_category: req.product_category,
      formula_version_id: req.formula_version_id ?? null,
      target_metrics: req.target_metrics ?? [],
      bom_items: req.bom_items,
      request_payload: req as unknown as Record<string, unknown>,
      response_payload: response,
      status,
      error_class: error?.name ?? null,
      error_message: error?.message ?? null,
      duration_ms,
      trace_id: ctx.trace_id,
      created_by: ctx.user_id,
      batch_id: null,
      batch_index: null,
    });

    if (error) throw error;

    return {
      metrics,
      risk_warnings: deriveRiskWarnings(metrics, req),
      model_version: info.version,
      model_code: info.code,
      predictor_mode: info.mode,
      trace_id: ctx.trace_id,
      duration_ms,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // /predict/batch — runs N formulas with bounded concurrency
  // ────────────────────────────────────────────────────────────────────
  async predictBatch(
    req: BatchPredictRequest,
    ctx: { trace_id: string; user_id: string | null }
  ): Promise<BatchPredictionResponse> {
    const startedAt = Date.now();
    const info = this.deps.adapter.info();
    const batch_id = randomUUID();
    const concurrency = Math.max(1, Math.min(req.concurrency ?? 4, 16));

    interface Slot {
      index: number;
      label?: string;
      formula_version_id?: string | null;
      payload: SinglePredictRequest;
    }

    const slots: Slot[] = req.formulas.map((f, i) => ({
      index: i,
      ...(f.label === undefined ? {} : { label: f.label }),
      ...(f.formula_version_id === undefined
        ? {}
        : { formula_version_id: f.formula_version_id ?? null }),
      payload: {
        product_category: req.product_category,
        ...(f.formula_version_id === undefined
          ? {}
          : { formula_version_id: f.formula_version_id ?? null }),
        bom_items: f.bom_items,
        ...(req.target_metrics ? { target_metrics: req.target_metrics } : {}),
      },
    }));

    type SlotResult = {
      slot: Slot;
      metrics?: PredictedMetric[];
      risk_warnings?: RiskWarning[];
      response: Record<string, unknown> | null;
      error?: { code: string; message: string; class: string };
      duration_ms: number;
    };
    const results: SlotResult[] = new Array(slots.length);

    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, slots.length) }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= slots.length) return;
        const slot = slots[i]!;
        const t0 = Date.now();
        const { metrics, response, error } = await this.runOne(slot.payload);
        const took = Date.now() - t0;
        if (error) {
          results[i] = {
            slot,
            response,
            duration_ms: took,
            error: {
              class: error.name,
              code: classifyErrorCode(error),
              message: error.message,
            },
          };
        } else {
          results[i] = {
            slot,
            metrics,
            risk_warnings: deriveRiskWarnings(metrics, slot.payload),
            response,
            duration_ms: took,
          };
        }
      }
    });

    await Promise.all(workers);

    const total_duration_ms = Date.now() - startedAt;
    const successCount = results.filter((r) => !r.error).length;
    const failedCount = results.length - successCount;

    // Persist one row per batch entry (transactional). Failures here are
    // logged but never surface to the caller — an audit log outage must
    // not break business endpoints.
    const logRows: InsertPredictionLogInput[] = results.map((r) => ({
      request_type: 'batch',
      model_code: info.code,
      model_version: info.version,
      predictor_mode: info.mode,
      product_category: req.product_category,
      formula_version_id: r.slot.formula_version_id ?? null,
      target_metrics: req.target_metrics ?? [],
      bom_items: r.slot.payload.bom_items,
      request_payload: r.slot.payload as unknown as Record<string, unknown>,
      response_payload: r.response,
      status: r.error ? 'failed' : 'success',
      error_class: r.error?.class ?? null,
      error_message: r.error?.message ?? null,
      duration_ms: r.duration_ms,
      trace_id: ctx.trace_id,
      created_by: ctx.user_id,
      batch_id,
      batch_index: r.slot.index,
    }));
    await this.safeLogBatch(logRows);

    return {
      batch_id,
      results: results.map((r) => ({
        index: r.slot.index,
        ...(r.slot.label === undefined ? {} : { label: r.slot.label }),
        ...(r.slot.formula_version_id === undefined
          ? {}
          : { formula_version_id: r.slot.formula_version_id ?? null }),
        ...(r.metrics ? { metrics: r.metrics } : {}),
        ...(r.risk_warnings ? { risk_warnings: r.risk_warnings } : {}),
        ...(r.error ? { error: { code: r.error.code, message: r.error.message } } : {}),
      })),
      model_version: info.version,
      model_code: info.code,
      predictor_mode: info.mode,
      trace_id: ctx.trace_id,
      total_duration_ms,
      counts: { total: results.length, success: successCount, failed: failedCount },
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // /predict/explain
  // ────────────────────────────────────────────────────────────────────
  async predictExplain(
    req: ExplainPredictRequest,
    ctx: { trace_id: string; user_id: string | null }
  ): Promise<PredictionResponse> {
    const startedAt = Date.now();
    const info = this.deps.adapter.info();

    let metrics: PredictedMetric[] = [];
    let response: Record<string, unknown> | null = null;
    let explainOutput: ExplainOutput | null = null;
    let error: Error | null = null;
    try {
      explainOutput = await this.deps.adapter.explain({
        product_category: req.product_category,
        ...(req.formula_version_id === undefined
          ? {}
          : { formula_version_id: req.formula_version_id ?? null }),
        bom_items: req.bom_items,
        ...(req.target_metrics ? { target_metrics: req.target_metrics } : {}),
        metric: req.metric,
        ...(req.top_k === undefined ? {} : { top_k: req.top_k }),
      });
      // Also call predict to populate `metrics` so the response is
      // consistent with /predict/single.
      const baseline = await this.deps.adapter.predict({
        product_category: req.product_category,
        ...(req.formula_version_id === undefined
          ? {}
          : { formula_version_id: req.formula_version_id ?? null }),
        bom_items: req.bom_items,
        target_metrics: req.target_metrics ?? [req.metric],
      });
      metrics = baseline.metrics;
      response = { explain: explainOutput, metrics };
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e));
    }
    const duration_ms = Date.now() - startedAt;

    await this.safeLog({
      request_type: 'explain',
      model_code: info.code,
      model_version: info.version,
      predictor_mode: info.mode,
      product_category: req.product_category,
      formula_version_id: req.formula_version_id ?? null,
      target_metrics: req.target_metrics ?? [req.metric],
      bom_items: req.bom_items,
      request_payload: req as unknown as Record<string, unknown>,
      response_payload: response,
      status: error ? 'failed' : 'success',
      error_class: error?.name ?? null,
      error_message: error?.message ?? null,
      duration_ms,
      trace_id: ctx.trace_id,
      created_by: ctx.user_id,
      batch_id: null,
      batch_index: null,
    });

    if (error) {
      // Surface adapter "not implemented" as 503 — not an unhandled crash.
      throw error instanceof UpstreamError
        ? error
        : new UpstreamError(`Explain failed: ${error.message}`, error);
    }

    return {
      metrics,
      risk_warnings: deriveRiskWarnings(metrics, req),
      model_version: info.version,
      model_code: info.code,
      predictor_mode: info.mode,
      trace_id: ctx.trace_id,
      explanations: explainOutput?.contributions ?? [],
      duration_ms,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  /** Run the adapter on one BOM. Catches errors so callers can keep going. */
  private async runOne(req: SinglePredictRequest): Promise<{
    metrics: PredictedMetric[];
    response: Record<string, unknown> | null;
    error: Error | null;
  }> {
    if (!Array.isArray(req.bom_items) || req.bom_items.length === 0) {
      const e = new BadRequestError('bom_items must contain at least one entry');
      return { metrics: [], response: null, error: e };
    }
    try {
      const out = await this.deps.adapter.predict({
        product_category: req.product_category,
        ...(req.formula_version_id === undefined
          ? {}
          : { formula_version_id: req.formula_version_id ?? null }),
        bom_items: req.bom_items,
        ...(req.target_metrics ? { target_metrics: req.target_metrics } : {}),
      });
      return { metrics: out.metrics, response: { metrics: out.metrics }, error: null };
    } catch (err) {
      return {
        metrics: [],
        response: null,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  private async safeLog(row: InsertPredictionLogInput): Promise<void> {
    if (!this.deps.repository) return;
    try {
      await this.deps.repository.insert(row);
    } catch (err) {
      this.deps.logger.warn(
        { err, trace_id: row.trace_id },
        'Failed to write prediction_logs row — continuing'
      );
    }
  }

  private async safeLogBatch(rows: InsertPredictionLogInput[]): Promise<void> {
    if (!this.deps.repository || rows.length === 0) return;
    try {
      await this.deps.repository.insertBatch(rows);
    } catch (err) {
      const trace = rows[0]?.trace_id;
      this.deps.logger.warn(
        { err, trace_id: trace, count: rows.length },
        'Failed to write batch prediction_logs rows — continuing'
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for unit tests)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive risk warnings from predicted metrics.
 *
 *   - in_spec === false → critical SPEC_FAIL warning
 *   - in_spec === true and within 5 % of the closer spec edge → warning CLOSE_TO_SPEC
 *   - confidence < 0.6  → warning LOW_CONFIDENCE
 *   - empty metrics list (e.g. unknown target_metrics filter) → info NO_METRICS
 */
export function deriveRiskWarnings(
  metrics: PredictedMetric[],
  req: { target_metrics?: string[] }
): RiskWarning[] {
  const out: RiskWarning[] = [];

  if (metrics.length === 0) {
    out.push({
      level: 'info',
      code: 'NO_METRICS',
      message:
        req.target_metrics && req.target_metrics.length
          ? `No metrics produced for requested targets [${req.target_metrics.join(', ')}].`
          : 'No metrics produced — model returned empty output.',
    });
    return out;
  }

  for (const m of metrics) {
    if (m.in_spec === false) {
      out.push({
        level: 'critical',
        code: 'SPEC_FAIL',
        message: `Predicted ${m.display_name ?? m.name}=${m.predicted_value}${
          m.unit ? ' ' + m.unit : ''
        } is outside the spec window [${formatBound(m.spec_low)}, ${formatBound(m.spec_high)}].`,
        metric: m.name,
      });
    } else if (m.in_spec === true) {
      const closest = closestEdgeDistance(m.predicted_value, m.spec_low, m.spec_high);
      if (closest !== null && closest.relative <= 0.05) {
        out.push({
          level: 'warning',
          code: 'CLOSE_TO_SPEC',
          message: `Predicted ${m.display_name ?? m.name} is within 5 % of the ${closest.edge} spec bound.`,
          metric: m.name,
        });
      }
    }
    if (m.confidence < 0.6) {
      out.push({
        level: 'warning',
        code: 'LOW_CONFIDENCE',
        message: `Confidence ${(m.confidence * 100).toFixed(0)} % for ${m.display_name ?? m.name} is below the recommended threshold (60 %).`,
        metric: m.name,
      });
    }
  }
  return out;
}

function closestEdgeDistance(
  v: number,
  low: number | null,
  high: number | null
): { relative: number; edge: 'low' | 'high' } | null {
  if (low === null && high === null) return null;
  const candidates: Array<{ edge: 'low' | 'high'; rel: number }> = [];
  if (low !== null) {
    const denom = Math.abs(low) > 1e-9 ? Math.abs(low) : 1;
    candidates.push({ edge: 'low', rel: Math.abs(v - low) / denom });
  }
  if (high !== null) {
    const denom = Math.abs(high) > 1e-9 ? Math.abs(high) : 1;
    candidates.push({ edge: 'high', rel: Math.abs(v - high) / denom });
  }
  candidates.sort((a, b) => a.rel - b.rel);
  const top = candidates[0]!;
  return { relative: top.rel, edge: top.edge };
}

function formatBound(v: number | null): string {
  return v === null ? '-∞' : String(v);
}

function classifyErrorCode(err: Error): string {
  if (err instanceof BadRequestError) return 'BAD_REQUEST';
  if (err instanceof UpstreamError) return 'UPSTREAM_UNAVAILABLE';
  return err.name === 'AppError' ? 'APP_ERROR' : 'INTERNAL';
}
