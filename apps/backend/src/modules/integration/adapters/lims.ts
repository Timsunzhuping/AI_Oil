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
 * MOCK LIMS adapter.
 *
 * Simulates pulling test results and experiment metadata from a LIMS
 * (LabWare / STARLIMS / Sample Manager). Real impl would call the LIMS
 * REST/SOAP API via stored credentials.
 */
export class MockLimsAdapter extends BaseAdapter {
  readonly sourceType: SourceType = 'lims';

  capabilities(): EntityCapability[] {
    return [
      { entity_type: 'test_results', supports_full: true, supports_incremental: true, cursor_shape: '{ since: ISO8601 }' },
      { entity_type: 'experiments',  supports_full: true, supports_incremental: true, cursor_shape: '{ since: ISO8601 }' },
    ];
  }

  async testConnection(source: SourceRow): Promise<ConnectionTestResult> {
    const start = Date.now();
    await delay(30);
    const cfg = source.config as { endpoint?: string; lab_code?: string };
    if (!cfg?.endpoint || !cfg?.lab_code) {
      return { ok: false, latency_ms: Date.now() - start, error: 'config.endpoint and config.lab_code required' };
    }
    return { ok: true, latency_ms: Date.now() - start, details: { lab_code: cfg.lab_code } };
  }

  async *extractFull(ctx: ExtractContext): AsyncIterable<AdapterRecord> {
    yield* this.iterate(ctx, null, true);
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
      ctx.entityType === 'test_results'
        ? sampleTestResults()
        : ctx.entityType === 'experiments'
        ? sampleExperiments()
        : [];

    for (const r of samples) {
      if (since && new Date(r.external_updated_at) <= since) continue;
      await delay(3);
      yield r;
    }
  }
}

function sampleTestResults(): AdapterRecord[] {
  const base = new Date('2026-04-15T00:00:00Z').getTime();
  const hour = (n: number) => new Date(base + n * 3600_000).toISOString();
  return [
    { external_id: 'LIMS-RESULT-50001', external_updated_at: hour(1),
      payload: { sample_code: 'S-2026-0042', test_code: 'KV_100C', measured_value: 10.4, unit_of_measure: 'cSt', pass: true } },
    { external_id: 'LIMS-RESULT-50002', external_updated_at: hour(2),
      payload: { sample_code: 'S-2026-0042', test_code: 'VI',       measured_value: 167,  pass: true } },
    { external_id: 'LIMS-RESULT-50003', external_updated_at: hour(3),
      payload: { sample_code: 'S-2026-0042', test_code: 'TBN',      measured_value: 8.6,  unit_of_measure: 'mg KOH/g', pass: true } },
    { external_id: 'LIMS-RESULT-50004', external_updated_at: hour(7),
      payload: { sample_code: 'S-2026-0043', test_code: 'NOACK',    measured_value: 8.2,  unit_of_measure: '%', pass: true } },
  ];
}

function sampleExperiments(): AdapterRecord[] {
  const base = new Date('2026-04-10T00:00:00Z').getTime();
  const day = (n: number) => new Date(base + n * 24 * 3600_000).toISOString();
  return [
    { external_id: 'LIMS-EXP-7001', external_updated_at: day(1),
      payload: { code: 'EXP-2026-0001', title: 'Validation batch v1.1.0', experiment_type: 'validation', outcome: 'success' } },
    { external_id: 'LIMS-EXP-7002', external_updated_at: day(4),
      payload: { code: 'EXP-2026-0002', title: 'Cold-flow optimization',  experiment_type: 'optimization', outcome: 'partial' } },
  ];
}
