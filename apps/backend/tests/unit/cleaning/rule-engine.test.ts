import { describe, it, expect } from 'vitest';
import { evaluate, runRules, getFact, type CompiledRule } from '../../../src/modules/cleaning/rules/engine.js';

describe('getFact', () => {
  it('walks dotted paths', () => {
    expect(getFact({ a: { b: { c: 7 } } }, 'a.b.c')).toBe(7);
  });
  it('returns undefined when a segment is missing', () => {
    expect(getFact({ a: {} }, 'a.b.c')).toBeUndefined();
  });
  it('returns undefined for empty path', () => {
    expect(getFact({ a: 1 }, '')).toBeUndefined();
  });
});

describe('evaluate — leaf operators', () => {
  const facts = {
    value: 5,
    unit: 'kg',
    metric: { code: 'PH', expected_min: 0, expected_max: 14 },
    tags: ['oil', 'base'],
    name: 'Mineral Oil 150N',
  };

  it.each([
    [{ fact: 'value', op: 'eq', value: 5 }, true],
    [{ fact: 'value', op: 'neq', value: 6 }, true],
    [{ fact: 'value', op: 'lt', value: 6 }, true],
    [{ fact: 'value', op: 'lte', value: 5 }, true],
    [{ fact: 'value', op: 'gt', value: 4 }, true],
    [{ fact: 'value', op: 'gte', value: 5 }, true],
    [{ fact: 'unit', op: 'in', value: ['kg', 'g'] }, true],
    [{ fact: 'unit', op: 'not_in', value: ['L', 'mL'] }, true],
    [{ fact: 'tags', op: 'contains', value: 'oil' }, true],
    [{ fact: 'name', op: 'matches', value: 'Mineral.*150N' }, true],
    [{ fact: 'metric.code', op: 'present' }, true],
    [{ fact: 'metric.missing_field', op: 'absent' }, true],
    [{ fact: 'value', op: 'between', value: [0, 10] }, true],
    [{ fact: 'value', op: 'outside', value: [10, 100] }, true],
  ] as const)('%j → %s', (cond, expected) => {
    expect(evaluate(cond, facts)).toBe(expected);
  });
});

describe('evaluate — value_fact (compare two facts)', () => {
  it('compares value against another fact path', () => {
    expect(evaluate(
      { fact: 'value', op: 'lt', value_fact: 'metric.expected_max' },
      { value: 5, metric: { expected_max: 10 } }
    )).toBe(true);

    expect(evaluate(
      { fact: 'value', op: 'gt', value_fact: 'metric.expected_max' },
      { value: 11, metric: { expected_max: 10 } }
    )).toBe(true);
  });
});

describe('evaluate — boolean composition', () => {
  it('all = AND', () => {
    expect(evaluate(
      { all: [
        { fact: 'value', op: 'gt', value: 0 },
        { fact: 'value', op: 'lt', value: 10 },
      ]},
      { value: 5 }
    )).toBe(true);
    expect(evaluate(
      { all: [
        { fact: 'value', op: 'gt', value: 0 },
        { fact: 'value', op: 'lt', value: 3 },
      ]},
      { value: 5 }
    )).toBe(false);
  });

  it('any = OR', () => {
    expect(evaluate(
      { any: [
        { fact: 'value', op: 'lt', value: 0 },
        { fact: 'value', op: 'gt', value: 14 },
      ]},
      { value: 17 }
    )).toBe(true);
  });

  it('not inverts', () => {
    expect(evaluate({ not: { fact: 'value', op: 'eq', value: 1 } }, { value: 2 })).toBe(true);
  });
});

describe('runRules', () => {
  const rules: CompiledRule[] = [
    {
      code: 'PH_OOR', name: 'pH out of range', severity: 'error',
      scope: 'test_result', rule_type: 'outlier', priority: 100,
      condition: { all: [
        { fact: 'metric.code', op: 'eq', value: 'PH' },
        { any: [
          { fact: 'value', op: 'lt', value: 0 },
          { fact: 'value', op: 'gt', value: 14 },
        ]},
      ]},
      action: { flag: 'outlier', issue_code: 'PH_OOR', message: 'pH must be in [0,14]' },
    },
    {
      code: 'NEG_VAL', name: 'Negative value', severity: 'warning',
      scope: 'test_result', rule_type: 'outlier', priority: 50,
      condition: { fact: 'value', op: 'lt', value: 0 },
      action: { flag: 'outlier', issue_code: 'NEG' },
    },
  ];

  it('fires both rules when both apply', () => {
    const hits = runRules(rules, { value: -1, metric: { code: 'PH' } });
    expect(hits).toHaveLength(2);
    // higher-priority rule first
    expect(hits[0].rule_code).toBe('PH_OOR');
    expect(hits[1].rule_code).toBe('NEG_VAL');
  });

  it('fires zero rules when none apply', () => {
    expect(runRules(rules, { value: 5, metric: { code: 'PH' } })).toHaveLength(0);
  });

  it('skips a rule that throws (does not blow up the run)', () => {
    const broken: CompiledRule = {
      code: 'BROKEN', name: 'Broken', severity: 'error',
      scope: 'test_result', rule_type: 'outlier', priority: 200,
      // Invalid: matches with non-string value will return false safely,
      // but a malformed condition shape would still be tolerated.
      condition: null as unknown as CompiledRule['condition'],
      action: {},
    };
    const hits = runRules([broken, ...rules], { value: -1, metric: { code: 'PH' } });
    // BROKEN didn't crash the engine
    expect(hits.find((h) => h.rule_code === 'BROKEN')).toBeUndefined();
    expect(hits.length).toBe(2);
  });
});
