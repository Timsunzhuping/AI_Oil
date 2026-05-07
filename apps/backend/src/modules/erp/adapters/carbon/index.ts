/**
 * Carbon adapter factory.
 *
 *   buildCarbonAdapter()                           → MockCarbonAdapter
 *   buildCarbonAdapter({ adapter: yourAdapter })   → injected
 *
 * Future real adapters (ecoinvent / GaBi / corporate LCA bus) plug in via
 * the `adapter` option.
 */
import { MockCarbonAdapter, type MockCarbonAdapterOptions } from './mock.js';
import type { CarbonAdapter } from './types.js';

export interface BuildCarbonAdapterOptions {
  adapter?: CarbonAdapter;
  mock?: MockCarbonAdapterOptions;
}

export function buildCarbonAdapter(opts: BuildCarbonAdapterOptions = {}): CarbonAdapter {
  if (opts.adapter) return opts.adapter;
  return new MockCarbonAdapter(opts.mock);
}

export { MockCarbonAdapter } from './mock.js';
export type { CarbonAdapter } from './types.js';
