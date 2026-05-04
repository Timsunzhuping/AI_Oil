import type { AiTaskType, HandlerContext, HandlerResult, TaskHandler } from '../types.js';

/**
 * Each handler is intentionally LIGHTWEIGHT in this round — they validate
 * inputs and produce well-shaped outputs. Plugging real ML / inverse-recommender
 * logic in is a matter of swapping the implementation, the registry contract
 * stays stable.
 */

abstract class MockHandler implements TaskHandler {
  abstract readonly task_type: AiTaskType;
  readonly version = 'mock-v1';

  validateInput(payload: Record<string, unknown>, raw_text?: string | null): { ok: true } | { ok: false; errors: string[] } {
    return this.checkRequired(payload, raw_text);
  }

  protected checkRequired(payload: Record<string, unknown>, _raw?: string | null): { ok: true } | { ok: false; errors: string[] } {
    const errors: string[] = [];
    for (const field of this.requiredFields()) {
      const v = payload[field];
      if (v === undefined || v === null || v === '') errors.push(`Missing required field '${field}'`);
    }
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }

  protected requiredFields(): string[] { return []; }

  abstract execute(ctx: HandlerContext): Promise<HandlerResult>;
}

// ----------------------------------------------------------------------------

class ForwardPredictionHandler extends MockHandler {
  readonly task_type = 'forward_prediction' as const;
  protected override requiredFields(): string[] { return ['formula_version_id', 'target_metric']; }

  async execute(ctx: HandlerContext): Promise<HandlerResult> {
    const p = (ctx.primaryInput?.payload ?? {}) as { formula_version_id: string; target_metric: string; feature_set_version?: string };
    const fakeMean = predictableNumber(`${p.formula_version_id}|${p.target_metric}`, 5, 200);
    return {
      success: true,
      summary: `Predicted ${p.target_metric} ≈ ${fakeMean.toFixed(2)}`,
      outputs: [
        {
          output_type: 'prediction',
          is_primary: true,
          payload: {
            target_metric: p.target_metric,
            point_estimate: fakeMean,
            ci_low: fakeMean * 0.95,
            ci_high: fakeMean * 1.05,
            feature_set_version: p.feature_set_version ?? 'v1.0',
            method: 'mock_predictor',
          },
          summary: `Predicted ${p.target_metric} for formula_version ${p.formula_version_id}`,
          confidence: 0.82,
          ...(p.feature_set_version ? { feature_set_version: p.feature_set_version } : {}),
        },
      ],
    };
  }
}

// ----------------------------------------------------------------------------

class BatchPredictionHandler extends MockHandler {
  readonly task_type = 'batch_prediction' as const;
  protected override requiredFields(): string[] { return ['product_category_code', 'target_metrics']; }

  async execute(ctx: HandlerContext): Promise<HandlerResult> {
    const p = (ctx.primaryInput?.payload ?? {}) as { product_category_code: string; target_metrics: string[]; feature_set_version?: string };
    const targets = (p.target_metrics ?? []).slice(0, 8);
    // Generate a mock matrix of 5 fake formula_versions × N target_metrics
    const rows = Array.from({ length: 5 }, (_, i) => {
      const out: Record<string, unknown> = { formula_version_id: `mock-${p.product_category_code}-${i + 1}` };
      for (const t of targets) {
        out[t] = predictableNumber(`${out.formula_version_id}|${t}`, 5, 200);
      }
      return out;
    });
    return {
      success: true,
      summary: `Batch prediction over ${rows.length} formula versions in ${p.product_category_code}`,
      outputs: [
        {
          output_type: 'prediction',
          is_primary: true,
          payload: { rows, target_metrics: targets, product_category_code: p.product_category_code },
          summary: `${rows.length} rows × ${targets.length} target metrics`,
          confidence: 0.78,
          ...(p.feature_set_version ? { feature_set_version: p.feature_set_version } : {}),
        },
      ],
    };
  }
}

// ----------------------------------------------------------------------------

class CostOptimizationHandler extends MockHandler {
  readonly task_type = 'cost_optimization' as const;
  protected override requiredFields(): string[] { return ['base_formula_version_id', 'cost_target']; }

  async execute(ctx: HandlerContext): Promise<HandlerResult> {
    const p = (ctx.primaryInput?.payload ?? {}) as {
      base_formula_version_id: string; cost_target: number; max_cost_reduction_pct?: number;
      constraints?: Record<string, { min?: number; max?: number }>;
    };
    const reductionPct = Math.min(p.max_cost_reduction_pct ?? 15, 25);
    const projectedCost = p.cost_target;
    return {
      success: true,
      summary: `Suggested ${reductionPct.toFixed(1)}% cost reduction; projected total ≈ ${projectedCost}`,
      outputs: [
        {
          output_type: 'recommendation',
          is_primary: true,
          payload: {
            base_formula_version_id: p.base_formula_version_id,
            cost_target: p.cost_target,
            projected_cost: projectedCost,
            cost_reduction_pct: reductionPct,
            suggested_changes: [
              { action: 'replace', from_material_code: 'RM-PAO-6', to_material_code: 'RM-MO-150N', delta_pct: -3.2 },
              { action: 'reduce',  material_code: 'RM-VI-OCP', delta_pct: -1.0 },
            ],
            constraints_satisfied: true,
            preserved_metrics: p.constraints ?? {},
          },
          summary: `Cost-optimization candidate for ${p.base_formula_version_id}`,
          confidence: 0.71,
        },
      ],
    };
  }
}

// ----------------------------------------------------------------------------

class MaterialReplacementHandler extends MockHandler {
  readonly task_type = 'material_replacement' as const;
  protected override requiredFields(): string[] { return ['base_formula_version_id', 'replace_raw_material_id']; }

  async execute(ctx: HandlerContext): Promise<HandlerResult> {
    const p = (ctx.primaryInput?.payload ?? {}) as {
      base_formula_version_id: string; replace_raw_material_id: string;
      max_candidates?: number; preserve_metrics?: string[];
    };
    const n = Math.min(p.max_candidates ?? 5, 10);
    const candidates = Array.from({ length: n }, (_, i) => ({
      candidate_raw_material_id: `mock-candidate-${i + 1}`,
      candidate_code: `RM-ALT-${1000 + i}`,
      similarity_score: 0.95 - i * 0.07,
      projected_metric_deltas: (p.preserve_metrics ?? ['KV_100C', 'VI']).reduce<Record<string, number>>(
        (acc, m) => ({ ...acc, [m]: round(predictableNumber(`${i}|${m}`, -2, 2), 3) }),
        {}
      ),
    }));
    return {
      success: true,
      summary: `Found ${n} replacement candidates`,
      outputs: [
        {
          output_type: 'recommendation',
          is_primary: true,
          payload: {
            base_formula_version_id: p.base_formula_version_id,
            replace_raw_material_id: p.replace_raw_material_id,
            candidates,
          },
          summary: `${n} candidates ranked by composite similarity`,
          confidence: 0.74,
        },
      ],
    };
  }
}

// ----------------------------------------------------------------------------

class NewProductGenerationHandler extends MockHandler {
  readonly task_type = 'new_product_generation' as const;
  protected override requiredFields(): string[] { return ['product_category_code', 'target_metrics']; }

  async execute(ctx: HandlerContext): Promise<HandlerResult> {
    const p = (ctx.primaryInput?.payload ?? {}) as {
      product_category_code: string;
      target_metrics: Record<string, { target?: number; min?: number; max?: number }>;
      max_total_cost?: number; n_candidates?: number;
    };
    const n = Math.min(p.n_candidates ?? 3, 10);
    const candidates = Array.from({ length: n }, (_, i) => ({
      candidate_id: `gen-${p.product_category_code}-${i + 1}`,
      composition: {
        'RM-MO-150N': round(60 - i * 1.5, 2),
        'RM-PAO-6':   round(25 + i * 1.0, 2),
        'RM-ZDDP-A':  1.2,
        'RM-AO-PHEN': 0.8,
        'RM-VI-OCP':  round(13 + i * 0.5, 2),
      },
      projected_metrics: Object.fromEntries(
        Object.keys(p.target_metrics ?? {}).map((m) => [
          m,
          round(predictableNumber(`${i}|${m}`, 5, 200), 3),
        ])
      ),
      projected_cost: round(120 + i * 8, 2),
      meets_targets: true,
    }));
    return {
      success: true,
      summary: `Generated ${n} candidate formulations`,
      outputs: [
        {
          output_type: 'recommendation',
          is_primary: true,
          payload: { product_category_code: p.product_category_code, candidates, target_metrics: p.target_metrics },
          summary: `${n} candidates for ${p.product_category_code}`,
          confidence: 0.65,
        },
      ],
    };
  }
}

// ----------------------------------------------------------------------------

class KnowledgeQaHandler extends MockHandler {
  readonly task_type = 'knowledge_qa' as const;

  override validateInput(payload: Record<string, unknown>, raw_text?: string | null): { ok: true } | { ok: false; errors: string[] } {
    const q = (payload.question as string | undefined) ?? raw_text;
    if (!q || q.trim().length < 4) return { ok: false, errors: ['question is required (min 4 chars)'] };
    return { ok: true };
  }

  async execute(ctx: HandlerContext): Promise<HandlerResult> {
    const p = (ctx.primaryInput?.payload ?? {}) as { question?: string; max_sources?: number; domain?: string };
    const question = p.question ?? ctx.primaryInput?.raw_text ?? '';
    const maxSources = Math.min(p.max_sources ?? 5, 20);
    return {
      success: true,
      summary: `Answered question; ${maxSources} sources referenced`,
      outputs: [
        {
          output_type: 'report',
          is_primary: true,
          payload: {
            question,
            answer:
              `[MOCK] Based on the seeded knowledge corpus${p.domain ? ' (' + p.domain + ')' : ''}, ` +
              `the answer to "${question}" is illustrative only — wire a real RAG pipeline to replace.`,
            sources: Array.from({ length: maxSources }, (_, i) => ({
              source_id: `kb-mock-${i + 1}`,
              title: `Knowledge document #${i + 1}`,
              snippet: 'Lorem ipsum dolor sit amet — placeholder citation.',
              relevance: round(0.9 - i * 0.07, 3),
            })),
          },
          summary: `Q: ${question.slice(0, 80)}…`,
          confidence: 0.7,
        },
        {
          output_type: 'citation',
          is_primary: false,
          payload: { count: maxSources },
        },
      ],
    };
  }
}

// ============================================================================
// Registry
// ============================================================================

export class HandlerRegistry {
  private map = new Map<AiTaskType, TaskHandler>();

  constructor(initial?: TaskHandler[]) {
    const defaults: TaskHandler[] = initial ?? [
      new ForwardPredictionHandler(),
      new BatchPredictionHandler(),
      new CostOptimizationHandler(),
      new MaterialReplacementHandler(),
      new NewProductGenerationHandler(),
      new KnowledgeQaHandler(),
    ];
    for (const h of defaults) this.map.set(h.task_type, h);
  }

  register(handler: TaskHandler): void { this.map.set(handler.task_type, handler); }

  resolve(taskType: AiTaskType): TaskHandler {
    const h = this.map.get(taskType);
    if (!h) throw new Error(`No handler registered for task_type='${taskType}'`);
    return h;
  }

  list(): Array<{ task_type: AiTaskType; version: string }> {
    return Array.from(this.map.values()).map((h) => ({ task_type: h.task_type, version: h.version }));
  }
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

function predictableNumber(seed: string, lo: number, hi: number): number {
  // Deterministic pseudo-random in [lo, hi] from a string seed
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = (h >>> 0) / 0xffffffff;
  return lo + u * (hi - lo);
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
