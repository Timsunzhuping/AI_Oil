/**
 * Trainer adapter factory.
 *
 *   buildTrainer()                              → MockTrainerAdapter
 *   buildTrainer({ mode: 'local' })             → LocalTrainerAdapter
 *   buildTrainer({ adapter: yourAdapter })      → injected
 *
 * Honours `ML_TRAINER_MODE=local|mock|remote`. `remote` is reserved for a
 * future cloud client; the factory currently degrades to mock unless an
 * explicit adapter is provided.
 */
import { MockTrainerAdapter, type MockTrainerOptions } from './mock.js';
import { LocalTrainerAdapter, type LocalTrainerOptions } from './local.js';
import type { TrainerAdapter } from './types.js';

export interface BuildTrainerOptions {
  mode?: 'mock' | 'local' | 'remote';
  adapter?: TrainerAdapter;
  mock?: MockTrainerOptions;
  local?: LocalTrainerOptions;
}

export function buildTrainer(opts: BuildTrainerOptions = {}): TrainerAdapter {
  if (opts.adapter) return opts.adapter;
  const mode = opts.mode ?? (process.env.ML_TRAINER_MODE as BuildTrainerOptions['mode']) ?? 'mock';
  if (mode === 'local') return new LocalTrainerAdapter(opts.local);
  return new MockTrainerAdapter(opts.mock);
}

export { MockTrainerAdapter, synthesiseMetrics } from './mock.js';
export { LocalTrainerAdapter } from './local.js';
export type { TrainerAdapter, TrainerIdentity, TrainInput, TrainOutput } from './types.js';
