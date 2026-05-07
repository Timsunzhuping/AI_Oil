/**
 * Mock carbon-footprint adapter.
 *
 * Returns deterministic kgCO₂e/kg values keyed by SHA-256 of `material_code`
 * — same code → same number, forever. This is a STUB pending wiring to a
 * real LCA datasource (ecoinvent, GaBi, IDEMAT, internal MES dataset).
 */
import { createHash } from 'node:crypto';
import type {
  AdapterIdentity,
  CarbonFormulaInput,
  CarbonFormulaResult,
  CarbonMaterialRecord,
} from '../../types.js';
import type { CarbonAdapter } from './types.js';

export interface MockCarbonAdapterOptions {
  name?: string;
  version?: string;
  /** Stable known materials (override / preload). */
  knownMaterials?: Record<string, number>;
  /** Force calls to throw. */
  failureCounter?: { remaining: number };
}

const DEFAULT_KNOWN: Record<string, number> = {
  'RM-PAO-6': 1.85,
  'RM-PAO-4': 1.82,
  'RM-GIII-4': 1.2,
  'RM-MO-220': 0.95,
  'RM-OCP': 0.92,
  'RM-PKG-A': 2.1,
};

export class MockCarbonAdapter implements CarbonAdapter {
  readonly opts: Required<Omit<MockCarbonAdapterOptions, 'failureCounter' | 'knownMaterials'>> & {
    knownMaterials: Record<string, number>;
    failureCounter?: { remaining: number };
  };

  constructor(opts: MockCarbonAdapterOptions = {}) {
    this.opts = {
      name: opts.name ?? 'mock-carbon',
      version: opts.version ?? 'v1',
      knownMaterials: { ...DEFAULT_KNOWN, ...(opts.knownMaterials ?? {}) },
      ...(opts.failureCounter ? { failureCounter: opts.failureCounter } : {}),
    };
  }

  identity(): AdapterIdentity {
    return { name: this.opts.name, version: this.opts.version, mode: 'mock' };
  }

  async testConnection() {
    return { ok: true, latency_ms: 7, details: { provider: 'mock-carbon' } };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async lookupMaterial(
    code: string,
    _ctx: { trace_id: string }
  ): Promise<CarbonMaterialRecord | null> {
    this.maybeFail();
    const known = this.opts.knownMaterials[code];
    if (known !== undefined) {
      return {
        material_code: code,
        kgCO2e_per_kg: known,
        source: 'mock-known',
        reference_year: 2025,
        uncertainty: 0.1,
      };
    }
    // Synthesise a plausible value for unknown codes so dependent tests don't
    // fail on cold caches; UI should show "estimated" badge based on `source`.
    const u =
      parseInt(createHash('sha256').update(code).digest('hex').slice(0, 8), 16) / 0xffffffff;
    return {
      material_code: code,
      kgCO2e_per_kg: round3(0.5 + u * 3.5),
      source: 'mock-synthesised',
      reference_year: 2025,
      uncertainty: 0.3,
    };
  }

  async estimateFormula(
    input: CarbonFormulaInput,
    ctx: { trace_id: string }
  ): Promise<CarbonFormulaResult> {
    this.maybeFail();
    const breakdown: CarbonFormulaResult['breakdown'] = [];
    const missing: string[] = [];
    let total = 0;
    for (const line of input.bom) {
      const rec = await this.lookupMaterial(line.material_code, ctx);
      if (!rec || rec.source === 'mock-synthesised') {
        missing.push(line.material_code);
      }
      const kg = rec ? rec.kgCO2e_per_kg : 0;
      const contribution = round3(kg * line.ratio);
      breakdown.push({
        material_code: line.material_code,
        ratio: line.ratio,
        contribution,
      });
      total += contribution;
    }
    return {
      kgCO2e_per_kg: round3(total),
      breakdown,
      source: missing.length === 0 ? 'mock-known' : 'mock-mixed',
      missing_materials: missing,
    };
  }

  private maybeFail(): void {
    const fc = this.opts.failureCounter;
    if (fc && fc.remaining > 0) {
      fc.remaining -= 1;
      throw new Error('mock carbon transient failure');
    }
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
