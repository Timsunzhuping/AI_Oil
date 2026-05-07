/**
 * Deterministic mock LIMS adapter.
 *
 * Maintains an in-process map of `external_lims_task_id → state`. The mock
 * "completes" a task on the FIRST `pullResult` call after creation, so a
 * single integration test can exercise the full lifecycle:
 *   createTask → submitted → (pull) completed → metrics
 *
 * `failureCounter.remaining > 0` short-circuits any call to throw — this
 * exercises the service-layer retry loop.
 */
import { createHash } from 'node:crypto';
import type {
  AdapterIdentity,
  LimsCreateTaskInput,
  LimsCreateTaskOutput,
  LimsPullResultOutput,
  LimsResultMetric,
  LimsTaskStatus,
} from '../../types.js';
import type { LimsAdapter } from './types.js';

interface MockTaskState {
  id: string;
  status: LimsTaskStatus;
  test_method: string;
  created_at: string;
  pulls: number;
  metrics: LimsResultMetric[];
  notes?: string;
}

export interface MockLimsAdapterOptions {
  name?: string;
  version?: string;
  /** Force createTask / pullResult / listTasks to throw N times. */
  failureCounter?: { remaining: number };
  /** Force pullResult to keep returning 'in_progress' instead of completing. */
  alwaysInProgress?: boolean;
}

export class MockLimsAdapter implements LimsAdapter {
  private readonly state = new Map<string, MockTaskState>();
  readonly opts: Required<Omit<MockLimsAdapterOptions, 'failureCounter' | 'alwaysInProgress'>> & {
    failureCounter?: { remaining: number };
    alwaysInProgress: boolean;
  };

  constructor(opts: MockLimsAdapterOptions = {}) {
    this.opts = {
      name: opts.name ?? 'mock-lims',
      version: opts.version ?? 'v1',
      ...(opts.failureCounter ? { failureCounter: opts.failureCounter } : {}),
      alwaysInProgress: opts.alwaysInProgress ?? false,
    };
  }

  identity(): AdapterIdentity {
    return { name: this.opts.name, version: this.opts.version, mode: 'mock' };
  }

  async testConnection() {
    return { ok: true, latency_ms: 9, details: { endpoint: 'mock://lims' } };
  }

  async createTask(
    input: LimsCreateTaskInput,
    ctx: { trace_id: string }
  ): Promise<LimsCreateTaskOutput> {
    this.maybeFail();
    const seed = `${ctx.trace_id}|${input.test_method}|${input.related_formula_version_id ?? ''}|${input.internal_experiment_id ?? ''}|${this.state.size}`;
    const id = `LIMS-${shortHash(seed)}`;
    this.state.set(id, {
      id,
      status: 'submitted',
      test_method: input.test_method,
      created_at: new Date().toISOString(),
      pulls: 0,
      metrics: [],
      ...(input.notes ? { notes: input.notes } : {}),
    });
    return {
      external_lims_task_id: id,
      external_url: `https://mock-lims.example.com/tasks/${id}`,
      external_status_raw: 'SUBMITTED',
      accepted: true,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async pullResult(
    externalLimsTaskId: string,
    _ctx: { trace_id: string }
  ): Promise<LimsPullResultOutput> {
    this.maybeFail();
    const state = this.state.get(externalLimsTaskId);
    if (!state) {
      // Task wasn't created via this adapter — return a synthetic
      // completed result derived from the id so retry loops still terminate.
      return synthesiseExternal(externalLimsTaskId);
    }
    state.pulls += 1;
    if (this.opts.alwaysInProgress) {
      state.status = 'in_progress';
    } else if (state.pulls === 1) {
      state.status = 'in_progress';
    } else {
      state.status = 'completed';
      state.metrics = synthesiseMetrics(state.test_method, state.id);
    }
    return {
      external_lims_task_id: state.id,
      status: state.status,
      external_status_raw: state.status.toUpperCase(),
      metrics: state.metrics,
      raw_payload: { id: state.id, pulls: state.pulls, test_method: state.test_method },
    };
  }

  async listTasks(
    filter: { status?: LimsTaskStatus; limit?: number },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _ctx: { trace_id: string }
  ): Promise<LimsPullResultOutput[]> {
    this.maybeFail();
    const all = [...this.state.values()];
    const filtered = filter.status ? all.filter((t) => t.status === filter.status) : all;
    const limited = filter.limit ? filtered.slice(0, filter.limit) : filtered;
    return limited.map((s) => ({
      external_lims_task_id: s.id,
      status: s.status,
      external_status_raw: s.status.toUpperCase(),
      metrics: s.metrics,
    }));
  }

  // ── helpers ───────────────────────────────────────────────────────

  private maybeFail(): void {
    const fc = this.opts.failureCounter;
    if (fc && fc.remaining > 0) {
      fc.remaining -= 1;
      throw new Error('mock LIMS transient failure');
    }
  }
}

function shortHash(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 10).toUpperCase();
}

function synthesiseMetrics(testMethod: string, seed: string): LimsResultMetric[] {
  const u = parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 8), 16) / 0xffffffff;
  switch (testMethod) {
    case 'KV_100C':
      return [{ name: 'KV_100C', value: round3(9.5 + u * 3.0), unit: 'mm²/s', passed: true }];
    case 'KV_40C':
      return [{ name: 'KV_40C', value: round3(60 + u * 20), unit: 'mm²/s', passed: true }];
    case 'NOACK':
      return [{ name: 'NOACK', value: round3(8 + u * 4), unit: '%', passed: true }];
    case 'POUR':
      return [{ name: 'POUR', value: round1(-30 - u * 15), unit: '℃', passed: true }];
    case 'FLASH':
      return [{ name: 'FLASH', value: round1(220 + u * 30), unit: '℃', passed: true }];
    default:
      return [{ name: testMethod, value: round3(u * 100), passed: true }];
  }
}

function synthesiseExternal(id: string): LimsPullResultOutput {
  const u = parseInt(createHash('sha256').update(id).digest('hex').slice(0, 8), 16) / 0xffffffff;
  return {
    external_lims_task_id: id,
    status: 'completed',
    external_status_raw: 'COMPLETED',
    metrics: [{ name: 'KV_100C', value: round3(9.5 + u * 3.0), unit: 'mm²/s', passed: true }],
    raw_payload: { id, source: 'synthesised' },
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
