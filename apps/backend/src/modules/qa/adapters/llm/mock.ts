/**
 * Deterministic, rule-based LLM-shaped adapter.
 *
 * For development, demos, and tests we don't want to call a real LLM. This
 * adapter renders a templated answer from the supplied citations:
 *
 *   • Intent-specific intro line
 *   • Bullet list of citation snippets, each prefixed with [1], [2], …
 *   • Closing reminder that the answer is sourced
 *
 * The output is fully reproducible: same question + same citations → same text.
 */
import type { Citation } from '../../types.js';
import type { LlmAdapter, LlmAdapterIdentity, LlmComposeInput, LlmComposeOutput } from './types.js';

const INTENT_INTRO: Record<string, string> = {
  raw_material_lookup: '关于该原材料，知识库中相关的可参考要点：',
  formula_history: '基于配方知识库中的历史记录，相关要点：',
  regulation: '从合规与规范资料中检索到的相关条款：',
  process: '从工艺与生产相关资料中提炼的关键点：',
  general: '综合现有可信来源，本问题的相关要点：',
  no_match: '我们暂未在已收录的来源中检索到与该问题相关的内容。',
};

export interface MockLlmAdapterOptions {
  name?: string;
  version?: string;
}

export class MockLlmAdapter implements LlmAdapter {
  private readonly name: string;
  private readonly version: string;

  constructor(opts: MockLlmAdapterOptions = {}) {
    this.name = opts.name ?? 'mock-rules';
    this.version = opts.version ?? 'v1';
  }

  identity(): LlmAdapterIdentity {
    return { name: this.name, version: this.version };
  }

  async compose(input: LlmComposeInput): Promise<LlmComposeOutput> {
    const intro = INTENT_INTRO[input.intent] ?? INTENT_INTRO['general']!;
    const startedAt = Date.now();

    if (input.citations.length === 0) {
      return {
        answer:
          '抱歉，我们未在原材料 / 配方知识库或已审核文档中检索到能支持此问题的来源，' +
          '为避免无依据回答，本次不提供答案。建议补全相关资料后再次提问。',
        confidence: 0,
        meta: { reason: 'no_citations', latency_ms: Date.now() - startedAt },
      };
    }

    const lines: string[] = [intro];
    input.citations.forEach((c, i) => {
      lines.push(`[${i + 1}] ${formatCitationLine(c)}`);
    });
    lines.push('');
    lines.push(
      `综上，以上 ${input.citations.length} 条来源支撑该问答；如需补充请到知识库或文档中心查阅完整内容。`
    );

    const confidence = aggregateConfidence(input.citations);
    return {
      answer: lines.join('\n'),
      confidence,
      meta: {
        adapter: this.name,
        version: this.version,
        citations_used: input.citations.length,
        latency_ms: Date.now() - startedAt,
      },
    };
  }
}

// ─── helpers (exported for tests) ───────────────────────────────────────────

export function formatCitationLine(c: Citation): string {
  const sourceLabel = SOURCE_LABEL[c.source_type] ?? c.source_type;
  const snip = c.snippet.replace(/\s+/g, ' ').trim();
  return `「${sourceLabel}·${c.title}」 ${snip}`;
}

const SOURCE_LABEL: Record<string, string> = {
  raw_material_kb: '原材料知识库',
  formula_kb: '配方知识库',
  document: '文档',
  parse_result: '文档抽取',
  rule: '规则库',
  experiment: '试验',
  external: '外部资料',
};

export function aggregateConfidence(citations: Citation[]): number {
  if (citations.length === 0) return 0;
  // Weight towards the top citation; this prevents one weak hit dragging
  // a confident-top into low confidence territory.
  const sorted = [...citations].sort((a, b) => b.relevance - a.relevance);
  const top = sorted[0]!.relevance;
  const avg = sorted.reduce((s, c) => s + c.relevance, 0) / sorted.length;
  return Math.max(0, Math.min(1, top * 0.7 + avg * 0.3));
}
