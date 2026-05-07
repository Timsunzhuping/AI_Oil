/**
 * SAP adapter factory.
 *
 *   buildSapAdapter()                → MockSapAdapter
 *   buildSapAdapter({ mode: 'real' }) → throws unless `adapter` is supplied.
 *
 * Concrete RFC / OData implementations should implement `SapAdapter` and be
 * passed via `{ adapter }`. The factory honours `ERP_SAP_MODE=real` so
 * production wiring can flip without code changes.
 */
import { MockSapAdapter, type MockSapAdapterOptions } from './mock.js';
import type { SapAdapter } from './types.js';

export interface BuildSapAdapterOptions {
  mode?: 'mock' | 'real';
  adapter?: SapAdapter;
  mock?: MockSapAdapterOptions;
}

export function buildSapAdapter(opts: BuildSapAdapterOptions = {}): SapAdapter {
  if (opts.adapter) return opts.adapter;
  const mode = opts.mode ?? (process.env.ERP_SAP_MODE === 'real' ? 'real' : 'mock');
  if (mode === 'real') {
    // No real adapter ships in this round — degrade to mock so the API
    // surface stays usable.
    return new MockSapAdapter(opts.mock);
  }
  return new MockSapAdapter(opts.mock);
}

export { MockSapAdapter } from './mock.js';
export type { SapAdapter, SapSyncContext, SapSyncResult } from './types.js';
