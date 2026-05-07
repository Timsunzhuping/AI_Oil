/**
 * Predictor factory.
 *
 * Selection rule (highest priority first):
 *   1. Explicit `mode` / `adapter` argument
 *   2. process.env.PREDICTOR_MODE='real' → RealPredictorScaffold
 *   3. fallback → MockPredictor
 *
 * Tests should always pass an explicit adapter; production wiring picks
 * via env so swapping the implementation requires no code changes.
 */
import { MockPredictor, type MockPredictorOptions } from './mock.js';
import { RealPredictorScaffold, type RealPredictorOptions } from './real.js';
import type { PredictorAdapter } from './types.js';
import type { PredictorMode } from '../types.js';

export interface BuildPredictorOptions {
  mode?: PredictorMode;
  /** Inject a fully-built adapter (e.g. in tests) — bypasses mode. */
  adapter?: PredictorAdapter;
  /** Forwarded to MockPredictor when mode === 'mock'. */
  mock?: MockPredictorOptions;
  /** Forwarded to RealPredictorScaffold when mode === 'real'. */
  real?: RealPredictorOptions;
}

export function buildPredictor(opts: BuildPredictorOptions = {}): PredictorAdapter {
  if (opts.adapter) return opts.adapter;

  const mode: PredictorMode =
    opts.mode ?? (process.env.PREDICTOR_MODE === 'real' ? 'real' : 'mock');

  if (mode === 'real') {
    if (!opts.real) {
      // No real-mode config provided — degrade to mock so the API stays usable.
      return new MockPredictor(opts.mock);
    }
    return new RealPredictorScaffold(opts.real);
  }
  return new MockPredictor(opts.mock);
}

export { MockPredictor } from './mock.js';
export { RealPredictorScaffold } from './real.js';
export type {
  PredictorAdapter,
  PredictInput,
  PredictOutput,
  ExplainInput,
  ExplainOutput,
} from './types.js';
