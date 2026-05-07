import { describe, it, expect } from 'vitest';
import { MockPredictor } from '../../../src/modules/prediction/adapters/mock.js';
import {
  buildPredictor,
  RealPredictorScaffold,
} from '../../../src/modules/prediction/adapters/index.js';
import { UpstreamError } from '../../../src/lib/errors.js';
import type { PredictInput } from '../../../src/modules/prediction/adapters/types.js';

const sampleInput = (): PredictInput => ({
  product_category: 'engine_oil_pcmo',
  formula_version_id: '00000000-0000-0000-0000-000000000001',
  bom_items: [
    { material_code: 'PAO-6', material_name: 'PAO-6 base oil', ratio: 0.42, role: 'base_oil' },
    { material_code: 'GIII-4cSt', material_name: 'Group III 4 cSt', ratio: 0.38, role: 'base_oil' },
    { material_code: 'OCP', material_name: 'OCP VII', ratio: 0.085, role: 'vii' },
    { material_code: 'PKG-A', material_name: 'Detergent package', ratio: 0.115, role: 'detergent' },
  ],
});

describe('MockPredictor', () => {
  const adapter = new MockPredictor();

  it('reports a stable mock identity via info()', () => {
    const i = adapter.info();
    expect(i.code).toBe('forward-predictor');
    expect(i.mode).toBe('mock');
    expect(i.supported_metrics.length).toBeGreaterThan(0);
  });

  it('predicts the FULL supported set when target_metrics is omitted', async () => {
    const out = await adapter.predict(sampleInput());
    expect(out.metrics.length).toBe(adapter.info().supported_metrics.length);
    for (const m of out.metrics) {
      expect(typeof m.predicted_value).toBe('number');
      expect(m.confidence).toBeGreaterThan(0);
      expect(m.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('honours target_metrics and ignores unknown names', async () => {
    const out = await adapter.predict({
      ...sampleInput(),
      target_metrics: ['KV_100C', 'VI', 'NOT_A_METRIC'],
    });
    const names = out.metrics.map((m) => m.name);
    expect(names).toContain('KV_100C');
    expect(names).toContain('VI');
    expect(names).not.toContain('NOT_A_METRIC');
  });

  it('falls back to ALL supported metrics when only unknown names are requested', async () => {
    const out = await adapter.predict({
      ...sampleInput(),
      target_metrics: ['DEFINITELY_UNKNOWN'],
    });
    expect(out.metrics.length).toBeGreaterThan(0);
  });

  it('is deterministic for identical inputs (same seed → same output)', async () => {
    const a = await adapter.predict(sampleInput());
    const b = await adapter.predict(sampleInput());
    expect(a).toEqual(b);
  });

  it('reacts to BOM changes — different ratio yields different prediction', async () => {
    const base = sampleInput();
    const tweaked = {
      ...base,
      bom_items: base.bom_items.map((it, idx) => (idx === 0 ? { ...it, ratio: 0.5 } : it)),
    };
    const a = await adapter.predict(base);
    const b = await adapter.predict(tweaked);
    expect(a.metrics[0]!.predicted_value).not.toBe(b.metrics[0]!.predicted_value);
  });

  it('marks values within the spec window as in_spec=true', async () => {
    // Force a deterministic mock — the synthesiser keeps values inside spec
    // 90 % of the time; we just check the in_spec flag is consistent with
    // (predicted_value, spec_low, spec_high).
    const out = await adapter.predict({
      ...sampleInput(),
      target_metrics: ['KV_100C'],
    });
    const m = out.metrics[0]!;
    if (m.spec_low !== null && m.spec_high !== null) {
      const expected = m.predicted_value >= m.spec_low && m.predicted_value <= m.spec_high;
      expect(m.in_spec).toBe(expected);
    }
  });

  it('explain() returns sorted contributions of the requested top_k size', async () => {
    const exp = await adapter.explain({ ...sampleInput(), metric: 'KV_100C', top_k: 3 });
    expect(exp.metric).toBe('KV_100C');
    expect(exp.contributions).toHaveLength(3);
    const abs = exp.contributions.map((c) => Math.abs(c.contribution));
    for (let i = 0; i + 1 < abs.length; i++) {
      expect(abs[i]).toBeGreaterThanOrEqual(abs[i + 1]!);
    }
  });

  it('explain() throws on unsupported metric', async () => {
    await expect(adapter.explain({ ...sampleInput(), metric: 'UNKNOWN' })).rejects.toThrow(
      /not supported/
    );
  });
});

describe('buildPredictor', () => {
  it('returns MockPredictor by default', () => {
    const p = buildPredictor();
    expect(p.info().mode).toBe('mock');
  });

  it('returns RealPredictorScaffold when mode=real and config is provided', async () => {
    const p = buildPredictor({
      mode: 'real',
      real: {
        version: 'real-v0.1',
        framework: 'pytorch',
        supported_metrics: [],
      },
    });
    expect(p).toBeInstanceOf(RealPredictorScaffold);
    expect(p.info().mode).toBe('real');
    await expect(p.predict({} as PredictInput)).rejects.toBeInstanceOf(UpstreamError);
  });

  it('falls back to mock when mode=real but no real config is provided', () => {
    const p = buildPredictor({ mode: 'real' });
    expect(p.info().mode).toBe('mock');
  });

  it('respects an explicit adapter override', () => {
    const sentinel = new MockPredictor({ version: 'overridden' });
    const p = buildPredictor({ adapter: sentinel });
    expect(p).toBe(sentinel);
  });
});
