/**
 * Local in-process trainer.
 *
 * A "real-shape" adapter that runs entirely inside the Node process — no
 * external infra, no network. It computes deterministic metrics with a
 * tiny synthetic-data-driven least-squares regressor when task='regression',
 * and falls back to seeded values for other tasks.
 *
 * The point isn't accuracy — it's having a non-mock adapter to demonstrate
 * the contract works for actual computation, and a stable base to swap for
 * a real PyTorch / sklearn binding later.
 */
import { createHash } from 'node:crypto';
import type { TrainInput, TrainOutput, TrainerAdapter, TrainerIdentity } from './types.js';
import { synthesiseMetrics } from './mock.js';

export interface LocalTrainerOptions {
  name?: string;
  version?: string;
}

export class LocalTrainerAdapter implements TrainerAdapter {
  private readonly name: string;
  private readonly version: string;

  constructor(opts: LocalTrainerOptions = {}) {
    this.name = opts.name ?? 'local-trainer';
    this.version = opts.version ?? 'v1';
  }

  identity(): TrainerIdentity {
    return { name: this.name, version: this.version, mode: 'local' };
  }

  async train(input: TrainInput): Promise<TrainOutput> {
    const seedString = JSON.stringify({
      dataset: input.dataset_id ?? input.dataset_url ?? '-',
      hp: input.config.hyperparameters ?? {},
      seed: input.config.random_seed ?? 0,
    });
    const seed = createHash('sha256').update(seedString).digest('hex');

    /* Synthesise a tiny y = ax + b + noise dataset and fit it analytically.
     * We don't actually load `dataset_url` — that's the job of a real adapter. */
    const a = 1 + (parseInt(seed.slice(0, 8), 16) / 0xffffffff) * 2; // [1, 3)
    const b = (parseInt(seed.slice(8, 16), 16) / 0xffffffff) * 4 - 2; // [-2, 2)
    const noiseAmp = (parseInt(seed.slice(16, 24), 16) / 0xffffffff) * 0.3; // [0, 0.3)
    const sampleCount = Math.max(50, (input.config.max_epochs ?? 100) * 5);

    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < sampleCount; i += 1) {
      const x = i / sampleCount;
      const noiseSeed = parseInt(seed.slice(24, 32), 16) ^ i;
      const noise = ((noiseSeed >>> 0) / 0xffffffff - 0.5) * noiseAmp;
      xs.push(x);
      ys.push(a * x + b + noise);
    }

    const fit = leastSquares(xs, ys);
    /* RMSE on the same data — perfectly fine for adapter-shape demonstration. */
    let sse = 0;
    for (let i = 0; i < xs.length; i += 1) {
      const yhat = fit.slope * xs[i]! + fit.intercept;
      sse += (yhat - ys[i]!) ** 2;
    }
    const rmse = Math.sqrt(sse / xs.length);
    const yMean = ys.reduce((s, v) => s + v, 0) / ys.length;
    const tss = ys.reduce((s, v) => s + (v - yMean) ** 2, 0);
    const r2 = tss === 0 ? 1 : 1 - sse / tss;

    if (input.task_type === 'regression') {
      const metrics = {
        rmse: round4(rmse),
        mae: round4(rmse * 0.78),
        r2: round4(r2),
        slope: round4(fit.slope),
        intercept: round4(fit.intercept),
      };
      if (input.onProgress) {
        await input.onProgress(50, 'local: data synthesised');
        await input.onProgress(95, 'local: fit complete');
      }
      return {
        artifact_url: `local://artifact/${input.job_id}.json`,
        artifact_hash: seed.slice(0, 64),
        artifact_size_bytes: 256,
        framework_version: 'node-leastsquares==1.0',
        hyperparameters: input.config.hyperparameters ?? {},
        metrics,
        features: input.feature_spec ?? {},
        output_schema: { type: 'number' },
        notes: 'local-trainer (least-squares) fit',
      };
    }

    /* Non-regression tasks fall through to deterministic synthetic metrics. */
    if (input.onProgress) {
      await input.onProgress(50, 'local: synthesising metrics');
    }
    return {
      artifact_url: `local://artifact/${input.job_id}.json`,
      artifact_hash: seed.slice(0, 64),
      artifact_size_bytes: 256,
      framework_version: 'node-leastsquares==1.0',
      hyperparameters: input.config.hyperparameters ?? {},
      metrics: synthesiseMetrics(input.task_type, seed),
      features: input.feature_spec ?? {},
      notes: 'local-trainer fallback (seeded metrics)',
    };
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function leastSquares(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += xs[i]!;
    sumY += ys[i]!;
    sumXY += xs[i]! * ys[i]!;
    sumXX += xs[i]! * xs[i]!;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
