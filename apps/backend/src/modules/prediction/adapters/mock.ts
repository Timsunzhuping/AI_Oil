/**
 * Deterministic mock predictor.
 *
 * Used during local dev, integration tests, and as a safety net when the
 * real model artifact isn't reachable. The output is computed from a
 * stable hash of the input so test snapshots stay reproducible while
 * still exhibiting input sensitivity (different BOMs ⇒ different numbers).
 */
import type {
  ExplainInput,
  ExplainOutput,
  PredictInput,
  PredictOutput,
  PredictorAdapter,
} from './types.js';
import type { ModelVersionInfo, PredictedMetric, SupportedMetric } from '../types.js';

/** Catalogue of metrics the mock can produce, with display + spec windows. */
const SUPPORTED: SupportedMetric[] = [
  {
    name: 'KV_100C',
    display_name: '100℃ 运动黏度',
    unit: 'mm²/s',
    spec_low: 9.3,
    spec_high: 12.5,
    better: 'window',
  },
  {
    name: 'KV_40C',
    display_name: '40℃ 运动黏度',
    unit: 'mm²/s',
    spec_low: 60,
    spec_high: 80,
    better: 'window',
  },
  {
    name: 'VI',
    display_name: '黏度指数',
    unit: null,
    spec_low: 160,
    spec_high: null,
    better: 'higher',
  },
  {
    name: 'POUR',
    display_name: '倾点',
    unit: '℃',
    spec_low: null,
    spec_high: -30,
    better: 'lower',
  },
  {
    name: 'FLASH',
    display_name: '闪点',
    unit: '℃',
    spec_low: 200,
    spec_high: null,
    better: 'higher',
  },
  {
    name: 'NOACK',
    display_name: 'Noack 蒸发损失',
    unit: '%',
    spec_low: null,
    spec_high: 13,
    better: 'lower',
  },
  {
    name: 'CCS_-30C',
    display_name: '-30℃ 冷启动黏度',
    unit: 'mPa·s',
    spec_low: null,
    spec_high: 6200,
    better: 'lower',
  },
  {
    name: 'P_PCT',
    display_name: '磷含量',
    unit: 'wt%',
    spec_low: null,
    spec_high: 0.08,
    better: 'lower',
  },
];

const SUPPORTED_BY_NAME = new Map(SUPPORTED.map((m) => [m.name, m]));

export interface MockPredictorOptions {
  /** Override the version string the adapter reports (useful in tests). */
  version?: string;
  /** Override the framework/notes shown in `info()`. */
  framework?: string;
  /** Static feature_set_version to stamp into prediction logs. */
  feature_set_version?: string | null;
}

export class MockPredictor implements PredictorAdapter {
  private readonly version: string;
  private readonly framework: string;
  private readonly featureSetVersion: string | null;

  constructor(opts: MockPredictorOptions = {}) {
    this.version = opts.version ?? 'mock-v1';
    this.framework = opts.framework ?? 'mock-deterministic';
    this.featureSetVersion = opts.feature_set_version ?? 'fs-v1.0';
  }

  info(): ModelVersionInfo {
    return {
      code: 'forward-predictor',
      version: this.version,
      mode: 'mock',
      framework: this.framework,
      trained_at: null,
      feature_set_version: this.featureSetVersion,
      supported_metrics: SUPPORTED,
      notes: 'Deterministic mock predictor; outputs derived from a stable hash of the input.',
    };
  }

  async predict(input: PredictInput): Promise<PredictOutput> {
    const target = (
      input.target_metrics && input.target_metrics.length
        ? input.target_metrics
        : SUPPORTED.map((m) => m.name)
    ).filter((name) => SUPPORTED_BY_NAME.has(name));

    if (target.length === 0) {
      // Fall through to ALL supported metrics if the caller asked only for unknown names.
      target.push(...SUPPORTED.map((m) => m.name));
    }

    const seedBase = inputSeed(input);
    const metrics: PredictedMetric[] = target.map((name) => {
      const meta = SUPPORTED_BY_NAME.get(name)!;
      const value = round(synthesiseMetric(seedBase, meta), 3);
      const inSpec = checkInSpec(value, meta.spec_low, meta.spec_high);
      return {
        name: meta.name,
        display_name: meta.display_name,
        unit: meta.unit,
        predicted_value: value,
        spec_low: meta.spec_low,
        spec_high: meta.spec_high,
        in_spec: inSpec,
        confidence: confidenceFor(seedBase, name),
      };
    });

    return { metrics };
  }

  async explain(input: ExplainInput): Promise<ExplainOutput> {
    const meta = SUPPORTED_BY_NAME.get(input.metric);
    if (!meta) {
      throw new Error(`metric '${input.metric}' is not supported by ${this.version}`);
    }
    const seedBase = inputSeed(input);
    const baseValue = round(synthesiseMetric(seedBase, meta) * 0.85, 3);
    const predicted = round(synthesiseMetric(seedBase, meta), 3);

    // Synthesise per-BOM-item contributions: each item's contribution is
    // proportional to its ratio with a deterministic sign. This is plenty
    // for testing the API surface; real adapters should plug SHAP / LIME.
    const k = Math.min(input.top_k ?? 10, input.bom_items.length);
    const contributions = input.bom_items
      .slice(0, k)
      .map((it) => {
        const sign = synthesiseScalar(`${seedBase}|${it.material_code}|sign`) > 0.5 ? 1 : -1;
        const magnitude = synthesiseScalar(`${seedBase}|${it.material_code}|mag`) * it.ratio * 1.5;
        return {
          feature: `bom.${it.role}.${it.material_code}`,
          contribution: round(sign * magnitude, 4),
          description: `Influence of ${it.material_name} (${(it.ratio * 100).toFixed(1)} %) on ${input.metric}`,
        };
      })
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    return {
      metric: input.metric,
      predicted_value: predicted,
      base_value: baseValue,
      contributions,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

/** Build a deterministic seed string from the request payload. */
function inputSeed(input: PredictInput): string {
  const sorted = [...input.bom_items].sort((a, b) =>
    a.material_code.localeCompare(b.material_code)
  );
  const parts = sorted.map((it) => `${it.material_code}:${it.ratio.toFixed(4)}:${it.role}`);
  return `${input.product_category}|${input.formula_version_id ?? '-'}|${parts.join(',')}`;
}

/** FNV-1a 32-bit hash → uniform [0,1). Stable across Node versions. */
function synthesiseScalar(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

/** Map a 0..1 scalar into the spec window (or a sensible window) for the metric. */
function synthesiseMetric(seed: string, meta: SupportedMetric): number {
  const u = synthesiseScalar(`${seed}|${meta.name}`);
  // Decide the band based on the spec window:
  //   • both bounds known → fall inside [low - 0.1 * range, high + 0.1 * range]
  //   • only low (better=higher) → [low * 0.95, low * 1.25]
  //   • only high (better=lower) → [high * 0.7,  high * 1.05]
  //   • neither → [0.5, 1.5]
  const low = meta.spec_low;
  const high = meta.spec_high;
  if (low !== null && high !== null) {
    const span = high - low;
    return low - span * 0.05 + u * (span * 1.1);
  }
  if (low !== null) {
    return low * (0.95 + u * 0.3);
  }
  if (high !== null) {
    return high * (0.7 + u * 0.35);
  }
  return 0.5 + u * 1.0;
}

function confidenceFor(seed: string, metric: string): number {
  const u = synthesiseScalar(`${seed}|${metric}|conf`);
  // Concentrate confidence in [0.55, 0.95] so we exercise all 3 UI bands.
  return round(0.55 + u * 0.4, 3);
}

function checkInSpec(value: number, low: number | null, high: number | null): boolean | null {
  if (low === null && high === null) return null;
  if (low !== null && value < low) return false;
  if (high !== null && value > high) return false;
  return true;
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
