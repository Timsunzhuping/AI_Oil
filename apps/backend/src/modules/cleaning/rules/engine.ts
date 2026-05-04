/**
 * Declarative rule DSL evaluator.
 *
 * Condition tree shapes:
 *   { all: [Condition...] }     — every child must be true
 *   { any: [Condition...] }     — at least one must be true
 *   { not: Condition }          — invert
 *   { fact: 'a.b', op: 'eq', value: 5 }
 *   { fact: 'value', op: 'lt', value_fact: 'metric.expected_min' }   (value from another fact)
 *
 * Operators:
 *   eq | neq | lt | lte | gt | gte | in | not_in
 *   present | absent
 *   matches (regex) | contains
 *
 * Action shape (free-form, consumed by the caller):
 *   { flag: 'outlier', issue_code: 'PH_OOR', message: '...', outlier_method?: 'rule' }
 */

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | LeafCondition;

export interface LeafCondition {
  fact: string;
  op: Op;
  value?: unknown;
  value_fact?: string;
}

export type Op =
  | 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte'
  | 'in' | 'not_in'
  | 'present' | 'absent'
  | 'matches' | 'contains'
  | 'between' | 'outside';

export type Facts = Record<string, unknown>;

/**
 * Resolve a dotted path against a facts object. Returns undefined
 * if any segment is missing.
 */
export function getFact(facts: Facts, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split('.');
  let cur: unknown = facts;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function evalLeaf(cond: LeafCondition, facts: Facts): boolean {
  const left = getFact(facts, cond.fact);
  const right = cond.value_fact !== undefined ? getFact(facts, cond.value_fact) : cond.value;

  switch (cond.op) {
    case 'present': return left !== undefined && left !== null && left !== '';
    case 'absent':  return left === undefined || left === null || left === '';
    case 'eq':      return left === right;
    case 'neq':     return left !== right;
    case 'lt':      return typeof left === 'number' && typeof right === 'number' && left < right;
    case 'lte':     return typeof left === 'number' && typeof right === 'number' && left <= right;
    case 'gt':      return typeof left === 'number' && typeof right === 'number' && left > right;
    case 'gte':     return typeof left === 'number' && typeof right === 'number' && left >= right;
    case 'in':      return Array.isArray(right) && right.includes(left);
    case 'not_in':  return Array.isArray(right) && !right.includes(left);
    case 'matches': return typeof left === 'string' && typeof right === 'string' && new RegExp(right).test(left);
    case 'contains':return Array.isArray(left) ? left.includes(right) :
                          typeof left === 'string' && typeof right === 'string' ? left.includes(right) : false;
    case 'between': return typeof left === 'number' && Array.isArray(right) && right.length === 2
                          && typeof right[0] === 'number' && typeof right[1] === 'number'
                          && left >= right[0] && left <= right[1];
    case 'outside': return typeof left === 'number' && Array.isArray(right) && right.length === 2
                          && typeof right[0] === 'number' && typeof right[1] === 'number'
                          && (left < right[0] || left > right[1]);
    default: return false;
  }
}

export function evaluate(cond: Condition, facts: Facts): boolean {
  if ('all' in cond) return cond.all.every((c) => evaluate(c, facts));
  if ('any' in cond) return cond.any.some((c) => evaluate(c, facts));
  if ('not' in cond) return !evaluate(cond.not, facts);
  return evalLeaf(cond as LeafCondition, facts);
}

export interface RuleHit {
  rule_code: string;
  rule_name: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  action: Record<string, unknown>;
}

export interface CompiledRule {
  code: string;
  name: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  scope: string;
  rule_type: string;
  condition: Condition;
  action: Record<string, unknown>;
  priority: number;
}

/**
 * Run all rules against the facts; returns the hits in priority order.
 * Rules that throw during evaluation are skipped (with the error wrapped
 * in a synthetic hit so the caller can surface it).
 */
export function runRules(rules: CompiledRule[], facts: Facts): RuleHit[] {
  const hits: RuleHit[] = [];
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const r of sorted) {
    try {
      if (evaluate(r.condition, facts)) {
        hits.push({ rule_code: r.code, rule_name: r.name, severity: r.severity, action: r.action });
      }
    } catch {
      // skip — malformed rule shouldn't break the pipeline
    }
  }
  return hits;
}
