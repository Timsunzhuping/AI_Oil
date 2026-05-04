import { BaseAdapter, delay } from './base.js';
import type {
  AdapterRecord,
  ConnectionTestResult,
  Cursor,
  EntityCapability,
  ExtractContext,
  SourceRow,
  SourceType,
} from '../types.js';

/**
 * MOCK SAP adapter.
 *
 * Simulates pulling raw materials and suppliers from an SAP system via
 * RFC/OData. Real implementation would replace `sample*` data sources with
 * actual SAP client calls (e.g., node-rfc / @sap/cap-fiori / OData fetch).
 *
 * Honors a `since` cursor (ISO timestamp). Generates deterministic mock
 * data so tests are stable.
 */
export class MockSapAdapter extends BaseAdapter {
  readonly sourceType: SourceType = 'sap';

  capabilities(): EntityCapability[] {
    return [
      { entity_type: 'raw_materials', supports_full: true, supports_incremental: true, cursor_shape: '{ since: ISO8601 }' },
      { entity_type: 'suppliers',     supports_full: true, supports_incremental: true, cursor_shape: '{ since: ISO8601 }' },
    ];
  }

  async testConnection(source: SourceRow): Promise<ConnectionTestResult> {
    const start = Date.now();
    await delay(20);
    const cfg = source.config as { endpoint?: string };
    if (!cfg?.endpoint) {
      return { ok: false, latency_ms: Date.now() - start, error: 'config.endpoint missing' };
    }
    return { ok: true, latency_ms: Date.now() - start, details: { endpoint: cfg.endpoint } };
  }

  async *extractFull(ctx: ExtractContext): AsyncIterable<AdapterRecord> {
    yield* this.iterate(ctx, null, /*ignoreCursor*/ true);
  }

  async *extractIncremental(ctx: ExtractContext, cursor: Cursor | null): AsyncIterable<AdapterRecord> {
    yield* this.iterate(ctx, cursor, false);
  }

  private async *iterate(
    ctx: ExtractContext,
    cursor: Cursor | null,
    ignoreCursor: boolean
  ): AsyncIterable<AdapterRecord> {
    const since = !ignoreCursor && cursor && typeof cursor.since === 'string'
      ? new Date(cursor.since)
      : null;

    const samples =
      ctx.entityType === 'raw_materials'
        ? sampleRawMaterials()
        : ctx.entityType === 'suppliers'
        ? sampleSuppliers()
        : [];

    for (const r of samples) {
      if (since && new Date(r.external_updated_at) <= since) continue;
      await delay(2); // simulate network
      yield r;
    }
  }
}

// ---------------------- deterministic mock data ----------------------
function sampleRawMaterials(): AdapterRecord[] {
  // Stable timestamps so cursor tests are reproducible
  const base = new Date('2026-04-01T00:00:00Z').getTime();
  const day = (n: number) => new Date(base + n * 24 * 3600_000).toISOString();
  return [
    { external_id: 'SAP-MAT-1001', external_updated_at: day(1),
      payload: { code: 'RM-MO-220', name: 'Mineral Oil 220N', cas_number: '64742-54-7', unit_of_measure: 'kg', density: 0.875, status: 'active' } },
    { external_id: 'SAP-MAT-1002', external_updated_at: day(3),
      payload: { code: 'RM-PAO-4',  name: 'PAO 4cSt',           cas_number: '68037-01-4', unit_of_measure: 'kg', density: 0.819, status: 'active' } },
    { external_id: 'SAP-MAT-1003', external_updated_at: day(5),
      payload: { code: 'RM-AO-DPA', name: 'Diphenylamine AO',   cas_number: '101-84-8',   unit_of_measure: 'kg', density: 1.020, status: 'active' } },
    { external_id: 'SAP-MAT-1004', external_updated_at: day(8),
      payload: { code: 'RM-VI-PMA', name: 'PMA VI Improver',    cas_number: '9003-32-1',  unit_of_measure: 'kg', density: 0.890, status: 'active' } },
  ];
}

function sampleSuppliers(): AdapterRecord[] {
  const base = new Date('2026-03-15T00:00:00Z').getTime();
  const day = (n: number) => new Date(base + n * 24 * 3600_000).toISOString();
  return [
    { external_id: 'SAP-VENDOR-9001', external_updated_at: day(0),
      payload: { code: 'SUP-100', name: 'Acme Chemicals',       country_code: 'US', qualification_status: 'qualified' } },
    { external_id: 'SAP-VENDOR-9002', external_updated_at: day(4),
      payload: { code: 'SUP-101', name: 'Bohai Petrochemical',  country_code: 'CN', qualification_status: 'qualified' } },
    { external_id: 'SAP-VENDOR-9003', external_updated_at: day(7),
      payload: { code: 'SUP-102', name: 'Helios Synthetics',    country_code: 'DE', qualification_status: 'provisional' } },
  ];
}
