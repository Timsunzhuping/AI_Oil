import { describe, it, expect, vi } from 'vitest';
import {
  MockTrainerAdapter,
  synthesiseMetrics,
} from '../../../src/modules/ml/adapters/trainer/mock.js';
import { LocalTrainerAdapter } from '../../../src/modules/ml/adapters/trainer/local.js';
import { buildTrainer } from '../../../src/modules/ml/adapters/trainer/index.js';
import type { TrainInput } from '../../../src/modules/ml/adapters/trainer/types.js';

const baseInput: TrainInput = {
  job_id: 'job-1',
  dataset_id: 'ds-1',
  dataset_url: 'mock://dataset/x',
  task_type: 'regression',
  config: { random_seed: 42, hyperparameters: { lr: 0.01 } },
  trace_id: 'trace-1',
};

describe('MockTrainerAdapter', () => {
  it('reports its identity', () => {
    const a = new MockTrainerAdapter();
    expect(a.identity().mode).toBe('mock');
    expect(a.identity().name).toBe('mock-trainer');
  });

  it('produces deterministic metrics for the same input', async () => {
    const a = new MockTrainerAdapter();
    const r1 = await a.train(baseInput);
    const r2 = await a.train(baseInput);
    expect(r1.metrics).toEqual(r2.metrics);
    expect(r1.artifact_hash).toEqual(r2.artifact_hash);
  });

  it('reacts to hyperparameter changes', async () => {
    const a = new MockTrainerAdapter();
    const r1 = await a.train(baseInput);
    const r2 = await a.train({
      ...baseInput,
      config: { random_seed: 42, hyperparameters: { lr: 0.05 } },
    });
    expect(r1.metrics).not.toEqual(r2.metrics);
  });

  it('respects forceMetrics', async () => {
    const a = new MockTrainerAdapter({ forceMetrics: { accuracy: 0.99 } });
    const r = await a.train({ ...baseInput, task_type: 'classification' });
    expect(r.metrics).toEqual({ accuracy: 0.99 });
  });

  it('throws on demand to exercise retry / failure paths', async () => {
    const a = new MockTrainerAdapter({ failureCounter: { remaining: 1 } });
    await expect(a.train(baseInput)).rejects.toThrow();
    const ok = await a.train(baseInput);
    expect(ok.metrics.rmse).toBeGreaterThan(0);
  });

  it('emits progress callbacks when configured', async () => {
    const onProgress = vi.fn();
    const a = new MockTrainerAdapter({ progressSteps: 3 });
    await a.train({ ...baseInput, onProgress });
    expect(onProgress).toHaveBeenCalledTimes(3);
  });

  it('synthesiseMetrics produces task-specific keys', () => {
    const m = synthesiseMetrics('classification', 'a'.repeat(64));
    expect(m).toHaveProperty('accuracy');
    expect(m).toHaveProperty('f1');
    const r = synthesiseMetrics('regression', 'a'.repeat(64));
    expect(r).toHaveProperty('rmse');
    expect(r).toHaveProperty('r2');
  });
});

describe('LocalTrainerAdapter', () => {
  const a = new LocalTrainerAdapter();

  it('actually fits a regression model', async () => {
    const r = await a.train(baseInput);
    expect(r.metrics).toHaveProperty('rmse');
    expect(r.metrics).toHaveProperty('r2');
    expect(r.metrics).toHaveProperty('slope');
    expect(r.metrics.r2).toBeGreaterThan(0.5); // synthetic noisy data
  });

  it('is deterministic for identical inputs', async () => {
    const r1 = await a.train(baseInput);
    const r2 = await a.train(baseInput);
    expect(r1.metrics).toEqual(r2.metrics);
  });

  it('falls back to seeded metrics for non-regression tasks', async () => {
    const r = await a.train({ ...baseInput, task_type: 'classification' });
    expect(r.metrics).toHaveProperty('accuracy');
  });
});

describe('buildTrainer factory', () => {
  it('returns mock by default', () => {
    expect(buildTrainer().identity().mode).toBe('mock');
  });
  it('returns local when mode=local', () => {
    expect(buildTrainer({ mode: 'local' }).identity().mode).toBe('local');
  });
  it('respects an explicit adapter override', () => {
    const sentinel = new MockTrainerAdapter({ name: 'sentinel' });
    expect(buildTrainer({ adapter: sentinel })).toBe(sentinel);
  });
});
