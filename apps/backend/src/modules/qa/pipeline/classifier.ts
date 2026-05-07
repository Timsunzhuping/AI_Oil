/**
 * Query intent classifier.
 *
 * The default implementation is a rule-based, language-agnostic keyword
 * classifier — fast, cheap, and good enough for the seed dataset. The
 * `IntentClassifier` interface lets you swap in a fine-tuned model or LLM
 * call later without touching the rest of the pipeline.
 *
 * Each rule contributes a weighted vote; the highest scoring intent wins.
 * Scores are clamped to [0, 1] for `intent_confidence`.
 */
import type { Intent } from '../types.js';

export interface IntentClassifier {
  /** Classify a free-text question. Returns an intent + 0..1 confidence. */
  classify(
    question: string,
    hint?: { product_category?: string }
  ): {
    intent: Intent;
    confidence: number;
    matched_rules: string[];
  };
}

interface IntentRule {
  intent: Exclude<Intent, 'no_match'>;
  /** Stable identifier surfaced in the response for debugging. */
  name: string;
  /** Vote magnitude (0..1). */
  weight: number;
  /** Match function — returns true if the rule fires. */
  matches(text: string): boolean;
}

/** Decode-once normalisation: lowercase + strip punctuation runs. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[、，。？！,.?!；;:：]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function anyOf(words: string[]): (text: string) => boolean {
  return (text) => {
    const t = text;
    for (const w of words) {
      if (!w) continue;
      if (t.includes(w.toLowerCase())) return true;
    }
    return false;
  };
}

const DEFAULT_RULES: IntentRule[] = [
  // raw_material_lookup
  {
    intent: 'raw_material_lookup',
    name: 'rm.zh.material',
    weight: 0.45,
    matches: anyOf(['原材料', '原料', '基础油', '添加剂']),
  },
  {
    intent: 'raw_material_lookup',
    name: 'rm.en.material',
    weight: 0.45,
    matches: anyOf(['raw material', 'base oil', 'additive', 'datasheet']),
  },
  {
    intent: 'raw_material_lookup',
    name: 'rm.codes',
    weight: 0.3,
    matches: (t) => /\b(pao|grou?p\s?[ii]+|zddp|moDTC|ocp|noack|kv\d+)\b/i.test(t),
  },

  // formula_history
  {
    intent: 'formula_history',
    name: 'fh.zh.formula',
    weight: 0.45,
    matches: anyOf(['配方', '历史配方', '配方版本', '配方编号', '历史方案']),
  },
  {
    intent: 'formula_history',
    name: 'fh.en.formula',
    weight: 0.45,
    matches: anyOf(['formula', 'recipe', 'blend', 'historical']),
  },
  {
    intent: 'formula_history',
    name: 'fh.viscosity',
    weight: 0.25,
    matches: anyOf(['5w-30', '0w-20', 'iso vg', 'sae']),
  },

  // regulation
  {
    intent: 'regulation',
    name: 'reg.zh',
    weight: 0.55,
    matches: anyOf(['法规', '标准', '规格', '限值', '合规', 'reach', 'rohs']),
  },
  {
    intent: 'regulation',
    name: 'reg.en',
    weight: 0.55,
    matches: anyOf(['regulation', 'compliant', 'spec ', 'api sp', 'ilsac', 'gf-6', 'acea']),
  },

  // process
  {
    intent: 'process',
    name: 'proc.zh',
    weight: 0.55,
    matches: anyOf(['工艺', '调和', '加注', '过滤', '储运', '生产']),
  },
  {
    intent: 'process',
    name: 'proc.en',
    weight: 0.55,
    matches: anyOf(['blending', 'process', 'manufactur', 'storage', 'filtration']),
  },
];

export class RuleBasedClassifier implements IntentClassifier {
  constructor(private readonly rules: IntentRule[] = DEFAULT_RULES) {}

  classify(
    question: string,
    hint?: { product_category?: string }
  ): {
    intent: Intent;
    confidence: number;
    matched_rules: string[];
  } {
    const text = normalise(question);
    if (!text) return { intent: 'general', confidence: 0.2, matched_rules: [] };

    const scores: Partial<Record<Exclude<Intent, 'no_match'>, number>> = {};
    const matched_rules: string[] = [];
    for (const rule of this.rules) {
      if (rule.matches(text)) {
        scores[rule.intent] = (scores[rule.intent] ?? 0) + rule.weight;
        matched_rules.push(rule.name);
      }
    }

    // Bias by product_category if the user pinned one.
    if (hint?.product_category) {
      // A category hint lightly biases toward formula_history.
      scores.formula_history = (scores.formula_history ?? 0) + 0.1;
      matched_rules.push('hint.product_category');
    }

    const entries = Object.entries(scores) as [Exclude<Intent, 'no_match'>, number][];
    if (entries.length === 0) {
      // Nothing matched → 'general' with low confidence; the retriever still
      // gets a chance to surface relevant hits.
      return { intent: 'general', confidence: 0.25, matched_rules };
    }
    entries.sort((a, b) => b[1] - a[1]);
    const [winner, raw] = entries[0]!;
    const confidence = Math.max(0, Math.min(1, raw));
    return { intent: winner, confidence, matched_rules };
  }
}
