/**
 * LIMS adapter factory.
 *
 *   buildLimsAdapter()  → MockLimsAdapter
 *   buildLimsAdapter({ adapter: yourAdapter })
 *
 * Honours `ERP_LIMS_MODE=real`; the factory currently still returns the
 * mock when mode='real' unless an explicit adapter is supplied — wire your
 * real adapter via the `adapter` option to flip on production.
 */
import { MockLimsAdapter, type MockLimsAdapterOptions } from './mock.js';
import type { LimsAdapter } from './types.js';

export interface BuildLimsAdapterOptions {
  mode?: 'mock' | 'real';
  adapter?: LimsAdapter;
  mock?: MockLimsAdapterOptions;
}

export function buildLimsAdapter(opts: BuildLimsAdapterOptions = {}): LimsAdapter {
  if (opts.adapter) return opts.adapter;
  return new MockLimsAdapter(opts.mock);
}

export { MockLimsAdapter } from './mock.js';
export type { LimsAdapter } from './types.js';
