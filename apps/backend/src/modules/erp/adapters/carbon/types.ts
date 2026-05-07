/**
 * Carbon footprint adapter contract — RESERVED.
 *
 * This is a placeholder for a future sustainability data provider
 * (ecoinvent, GaBi, internal LCA database, etc.). The mock returns
 * deterministic kgCO₂e/kg values per material code so downstream
 * integrations can be tested today.
 */
import type {
  AdapterIdentity,
  CarbonFormulaInput,
  CarbonFormulaResult,
  CarbonMaterialRecord,
} from '../../types.js';

export interface CarbonAdapter {
  identity(): AdapterIdentity;
  testConnection(): Promise<{ ok: boolean; latency_ms: number; details?: Record<string, unknown> }>;
  /** Return the per-kg CO₂e for a single material code; null if unknown. */
  lookupMaterial(code: string, ctx: { trace_id: string }): Promise<CarbonMaterialRecord | null>;
  /** Estimate the CO₂e per kg of a formula given its BOM. */
  estimateFormula(
    input: CarbonFormulaInput,
    ctx: { trace_id: string }
  ): Promise<CarbonFormulaResult>;
}
