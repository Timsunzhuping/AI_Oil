/**
 * Markdown reporter — human-readable export for UAT sign-off.
 *
 * Renders one of three report layouts based on the report's `test_type`:
 * forward / inverse / stability.
 */
import type {
  AcceptanceReport,
  ExportResponse,
  ForwardReport,
  InverseReport,
  RunRow,
  StabilityReport,
} from '../types.js';

export function renderMarkdown(run: RunRow): ExportResponse {
  const body = renderReportMarkdown(run.summary);
  return {
    filename: `${run.code}.report.md`,
    content_type: 'text/markdown; charset=utf-8',
    body,
  };
}

export function renderReportMarkdown(report: AcceptanceReport): string {
  const header =
    `# 验收报告 ${report.code}\n\n` +
    `- **运行 ID**: ${report.run_id}\n` +
    `- **测试集**: ${report.test_set_id}\n` +
    `- **类型**: ${report.test_type}\n` +
    `- **模型**: ${report.model.code} @ ${report.model.version} (${report.model.mode})\n` +
    `- **状态**: ${report.status}\n` +
    `- **耗时**: ${report.duration_ms} ms\n` +
    `- **生成时间**: ${report.generated_at}\n\n`;

  const totals =
    `## 总览\n\n` +
    `| 指标 | 值 |\n|---|---|\n` +
    `| 用例总数 | ${report.totals.cases_total} |\n` +
    `| 通过 | ${report.totals.cases_passed} |\n` +
    `| 失败 | ${report.totals.cases_failed} |\n` +
    `| 通过率 | ${(report.totals.pass_rate * 100).toFixed(2)} % |\n\n`;

  if ('overall_metrics' in report) {
    if (report.test_type === 'forward')
      return header + totals + renderForward(report as ForwardReport);
    if (report.test_type === 'inverse')
      return header + totals + renderInverse(report as InverseReport);
    if (report.test_type === 'stability')
      return header + totals + renderStability(report as StabilityReport);
  }
  return header + totals;
}

function renderForward(r: ForwardReport): string {
  const overall =
    `## 总体指标\n\n` +
    `| MAPE | MAE | RMSE | 命中率 |\n|---|---|---|---|\n` +
    `| ${pct(r.overall_metrics.mape)} | ${r.overall_metrics.mae} | ${r.overall_metrics.rmse} | ${pct(r.overall_metrics.hit_rate)} |\n\n`;

  const byCat =
    `## 分品类\n\n` +
    `| 品类 | 用例 | 通过 | MAPE | MAE | RMSE | 命中率 |\n|---|---|---|---|---|---|---|\n` +
    r.by_category
      .map(
        (b) =>
          `| ${b.category} | ${b.n} | ${b.passed} | ${pct(b.mape)} | ${b.mae} | ${b.rmse} | ${pct(b.hit_rate)} |`
      )
      .join('\n') +
    '\n\n';

  const byMet =
    `## 分指标\n\n` +
    `| 指标 | n | MAPE | MAE | RMSE | 命中率 |\n|---|---|---|---|---|---|\n` +
    r.by_metric
      .map(
        (b) =>
          `| ${b.metric} | ${b.n} | ${pct(b.mape)} | ${b.mae} | ${b.rmse} | ${pct(b.hit_rate)} |`
      )
      .join('\n') +
    '\n\n';

  const failed =
    r.case_results.filter((c) => !c.passed).length === 0
      ? ''
      : `## 失败用例 (前 20 条)\n\n` +
        `| 用例 | 品类 | 原因 |\n|---|---|---|\n` +
        r.case_results
          .filter((c) => !c.passed)
          .slice(0, 20)
          .map(
            (c) =>
              `| ${c.case_id} | ${c.category ?? '-'} | ${(c.failure_reason ?? '').replace(/\|/g, '\\|')} |`
          )
          .join('\n') +
        '\n';

  return overall + byCat + byMet + failed;
}

function renderInverse(r: InverseReport): string {
  const overall =
    `## 总体指标\n\n` +
    `| 可行率 | Top1 可行率 | 平均合格候选 | 平均 Top1 成本 | 平均 Top1 置信度 |\n|---|---|---|---|---|\n` +
    `| ${pct(r.overall_metrics.feasibility_rate)} | ${pct(r.overall_metrics.top1_feasibility_rate)} | ${r.overall_metrics.avg_passed_candidates} | ${r.overall_metrics.avg_top1_cost ?? '-'} | ${r.overall_metrics.avg_top1_confidence} |\n\n`;

  const byCat =
    `## 分品类\n\n` +
    `| 品类 | 用例 | 通过 | 可行率 | Top1 可行率 | 平均合格候选 | 平均 Top1 成本 |\n|---|---|---|---|---|---|---|\n` +
    r.by_category
      .map(
        (b) =>
          `| ${b.category} | ${b.n} | ${b.passed} | ${pct(b.feasibility_rate)} | ${pct(b.top1_feasibility_rate)} | ${b.avg_passed_candidates} | ${b.avg_top1_cost ?? '-'} |`
      )
      .join('\n') +
    '\n\n';

  const failed =
    r.case_results.filter((c) => !c.passed).length === 0
      ? ''
      : `## 失败用例 (前 20 条)\n\n` +
        `| 用例 | 品类 | 合格候选 | Top1 成本 | Top1 置信度 | 原因 |\n|---|---|---|---|---|---|\n` +
        r.case_results
          .filter((c) => !c.passed)
          .slice(0, 20)
          .map(
            (c) =>
              `| ${c.case_id} | ${c.category ?? '-'} | ${c.metrics.passed_candidates} | ${c.metrics.top1_cost ?? '-'} | ${c.metrics.top1_confidence} | ${(c.failure_reason ?? '').replace(/\|/g, '\\|')} |`
          )
          .join('\n') +
        '\n';

  return overall + byCat + failed;
}

function renderStability(r: StabilityReport): string {
  const overall =
    `## 总体指标\n\n` +
    `| 平均 pairwise cosine | 平均 CV | 最大 CV | 稳定率 |\n|---|---|---|---|\n` +
    `| ${r.overall_metrics.avg_pairwise_cosine} | ${pct(r.overall_metrics.avg_cv)} | ${pct(r.overall_metrics.max_cv)} | ${pct(r.overall_metrics.stability_rate)} |\n\n`;

  const byMet =
    r.by_metric.length === 0
      ? ''
      : `## 分指标 CV\n\n` +
        `| 指标 | n | 平均 CV | 最大 CV |\n|---|---|---|---|\n` +
        r.by_metric
          .map((b) => `| ${b.metric} | ${b.n_cases} | ${pct(b.mean_cv)} | ${pct(b.max_cv)} |`)
          .join('\n') +
        '\n\n';

  const failed =
    r.case_results.filter((c) => !c.passed).length === 0
      ? ''
      : `## 失败用例 (前 20 条)\n\n` +
        `| 用例 | 品类 | 跑次 | cosine_min | max_cv | 原因 |\n|---|---|---|---|---|---|\n` +
        r.case_results
          .filter((c) => !c.passed)
          .slice(0, 20)
          .map(
            (c) =>
              `| ${c.case_id} | ${c.category ?? '-'} | ${c.runs_n} | ${c.metrics.pairwise_cosine_min} | ${pct(c.metrics.max_cv)} | ${(c.failure_reason ?? '').replace(/\|/g, '\\|')} |`
          )
          .join('\n') +
        '\n';

  return overall + byMet + failed;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)} %`;
}
