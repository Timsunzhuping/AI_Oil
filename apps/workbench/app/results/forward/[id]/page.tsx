'use client';

import { useParams } from 'next/navigation';
import { LineChart } from 'lucide-react';
import { PageHeader } from '@/components/layout/workbench-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingState } from '@/components/states/loading';
import { ErrorState } from '@/components/states/error';
import { EmptyState } from '@/components/states/empty';
import { ConfidenceBadge } from '@/components/results/confidence-badge';
import { RiskWarnings } from '@/components/results/risk-warnings';
import { SourceCitations } from '@/components/results/source-citations';
import { PredictionTable } from '@/components/results/prediction-table';
import { PredictionBarChart } from '@/components/results/prediction-bar-chart';
import { ExportButton } from '@/components/export/export-button';
import { useForwardResult } from '@/lib/hooks/queries';

/** 正向预测结果页 — 表格 + 图表 + 风险 + 来源 + 置信度。 */
export default function ForwardResultPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { data, isLoading, error, refetch } = useForwardResult(id);

  // Aggregate confidence: average of per-row confidence values.
  const aggregate = data
    ? data.rows.reduce((acc, r) => acc + r.confidence, 0) / Math.max(1, data.rows.length)
    : null;

  return (
    <>
      <PageHeader
        title="正向预测结果"
        description={`任务 ${id ?? ''} — 已知配方下各关键指标的预测值与规格符合性。`}
        actions={
          <div className="flex items-center gap-2">
            <ConfidenceBadge score={aggregate} label="综合置信度" />
            {id ? <ExportButton taskId={id} /> : null}
          </div>
        }
      />

      {isLoading ? (
        <LoadingState rows={6} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data || data.rows.length === 0 ? (
        <EmptyState
          title="暂无预测结果"
          description="该任务还没有生成可用的预测结果，可能仍在处理中。"
          icon={<LineChart className="h-6 w-6" />}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">关键指标预测</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <PredictionTable rows={data.rows} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">指标偏离规格中点</CardTitle>
              </CardHeader>
              <CardContent>
                <PredictionBarChart rows={data.rows} />
                <p className="mt-2 text-xs text-muted-foreground">
                  柱体超过 ±1 表示已突破规格区间，建议结合右侧风险提示评估。
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <RiskWarnings risks={data.risks} />
            <SourceCitations sources={data.sources} />
          </div>
        </div>
      )}
    </>
  );
}
