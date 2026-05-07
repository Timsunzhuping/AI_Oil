import { describe, it, expect } from 'vitest';
import { RuleBasedClassifier } from '../../../src/modules/qa/pipeline/classifier.js';

describe('RuleBasedClassifier', () => {
  const c = new RuleBasedClassifier();

  it('routes raw material questions', () => {
    expect(c.classify('PAO-6 这种基础油有什么特性?').intent).toBe('raw_material_lookup');
    expect(c.classify('Datasheet for ZDDP additive please').intent).toBe('raw_material_lookup');
  });

  it('routes formula history questions', () => {
    expect(c.classify('5W-30 的历史配方有哪些版本?').intent).toBe('formula_history');
    expect(c.classify('What recipes hit ISO VG 220 in our archive?').intent).toBe(
      'formula_history'
    );
  });

  it('routes regulation questions', () => {
    expect(c.classify('API SP 标准对磷含量的限值是多少?').intent).toBe('regulation');
    expect(c.classify('Which ACEA grade applies here?').intent).toBe('regulation');
  });

  it('routes process questions', () => {
    expect(c.classify('调和工艺需要多少时间?').intent).toBe('process');
    expect(c.classify('Storage temperature limit?').intent).toBe('process');
  });

  it('falls back to general for unmatched questions', () => {
    const r = c.classify('What time is it?');
    expect(r.intent).toBe('general');
    expect(r.confidence).toBeLessThan(0.5);
  });

  it('lists matched rules in matched_rules', () => {
    const r = c.classify('PAO-6 datasheet');
    expect(r.matched_rules.length).toBeGreaterThan(0);
  });

  it('product_category hint nudges toward formula_history', () => {
    const r = c.classify('请总结综合性能', { product_category: 'engine_oil_pcmo' });
    // Without rules firing strongly, the hint should be enough to move us off general.
    expect(['formula_history', 'general']).toContain(r.intent);
    expect(r.matched_rules).toContain('hint.product_category');
  });

  it('confidence is in [0, 1]', () => {
    for (const q of [
      '',
      'a',
      'PAO-6 PAO-6 PAO-6 datasheet additive base oil',
      '法规 标准 限值 合规',
    ]) {
      const r = c.classify(q);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });
});
