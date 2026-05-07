/**
 * Deterministic mock trainer.
 *
 * Returns synthetic but stable metrics keyed by `(dataset_id, task_type,
 * hyperparameters, random_seed)`. Same inputs → same metrics, forever.
 *
 * Behaviour switches:
 *   • `failureCounter.remaining > 0` → throws (exercises retry / failure paths)
 *   • `forceMetrics` → use fixed metrics (handy for service-level tests)
 *   • `progressSteps` → emits `onProgress` callbacks at fractional intervals
 */
import { createHash } from 'node:crypto';
import type { TrainInput, TrainOutput, TrainerAdapter, TrainerIdentity } from './types.js';

export interface MockTrainerOptions {
  name?: string;
  version?: string;
  failureCounter?: { remaining: number };
  forceMetrics?: Record<string, number>;
  progressSteps?: number;
  /** When true, throws inside cancel() — used by tests. */
  cancelThrows?: boolean;
}

export class MockTrainerAdapter implements TrainerAdapter {
  readonly opts: Required<Omit<MockTrainerOptions, 'failureCounter' | 'forceMetrics'>> & {
    failureCounter?: { remaining: number };
    forceMetrics?: Record<string, number>;
  };

  constructor(opts: MockTrainerOptions = {}) {
    this.opts = {
      name: opts.name ?? 'mock-trainer',
      version: opts.version ?? 'v1',
      progressSteps: opts.progressSteps ?? 0,
      cancelThrows: opts.cancelThrows ?? false,
      ...(opts.failureCounter ? { failureCounter: opts.failureCounter } : {}),
      ...(opts.forceMetrics ? { forceMetrics: opts.forceMetrics } : {}),
    };
  }

  identity(): TrainerIdentity {
    return { name: this.opts.name, version: this.opts.version, mode: 'mock' };
  }

  async train(input: TrainInput): Promise<TrainOutput> {
    this.maybeFail();
    const seed = buildSeed(input);
    const metrics = this.opts.forceMetrics ?? synthesiseMetrics(input.task_type, seed);

    if (this.opts.progressSteps > 0 && input.onProgress) {
      const step = 100 / (this.opts.progressSteps + 1);
      for (let i = 1; i <= this.opts.progressSteps; i += 1) {
        await input.onProgress(Math.min(99, Math.round(step * i)), `mock progress ${i}`);
      }
    }

    return {
      artifact_url: `mock://artifact/${input.job_id}`,
      artifact_hash: seed.slice(0, 64),
      artifact_size_bytes: 4096,
      framework_version: 'mock==1.0',
      hyperparameters: input.config.hyperparameters ?? {},
      metrics,
      features: input.feature_spec ?? {},
      output_schema: { type: 'object', properties: {} },
      notes: 'mock-trainer succeeded',
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async cancel(_jobId: string): Promise<void> {
    if (this.opts.cancelThrows) throw new Error('mock cancel failure');
  }

  private maybeFail(): void {
    const fc = this.opts.failureCounter;
    if (fc && fc.remaining > 0) {
      fc.remaining -= 1;
      throw new Error('mock-trainer transient failure');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function buildSeed(input: TrainInput): string {
  const payload = JSON.stringify({
    dataset: input.dataset_id ?? input.dataset_url ?? '-',
    task: input.task_type,
    hp: input.config.hyperparameters ?? {},
    seed: input.config.random_seed ?? 0,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function synthesiseMetrics(
  task: TrainInput['task_type'],
  seed: string
): Record<string, number> {
  const u = parseInt(seed.slice(0, 8), 16) / 0xffffffff; // [0, 1)
  const v = parseInt(seed.slice(8, 16), 16) / 0xffffffff;
  const w = parseInt(seed.slice(16, 24), 16) / 0xffffffff;
  switch (task) {
    case 'classification':
      return {
        accuracy: round3(0.8 + u * 0.15),
        precision: round3(0.75 + v * 0.2),
        recall: round3(0.75 + w * 0.2),
        f1: round3(0.78 + ((u + v + w) / 3) * 0.18),
      };
    case 'regression':
      return {
        rmse: round3(0.05 + u * 0.2),
        mae: round3(0.04 + v * 0.18),
        r2: round3(0.7 + w * 0.25),
      };
    case 'time_series':
      return {
        rmse: round3(0.1 + u * 0.2),
        mape: round3(0.05 + v * 0.1),
      };
    case 'recommendation':
      return {
        ndcg: round3(0.6 + u * 0.3),
        recall_at_10: round3(0.4 + v * 0.4),
      };
    case 'embedding':
      return {
        recall_at_10: round3(0.6 + u * 0.3),
        loss: round3(0.1 + v * 0.1),
      };
    default:
      return { score: round3(0.7 + u * 0.25) };
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
