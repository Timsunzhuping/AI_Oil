'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { Activity } from 'lucide-react';
import { PageHeader } from '@/components/layout/workbench-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingState } from '@/components/states/loading';
import { ErrorState } from '@/components/states/error';
import { EmptyState } from '@/components/states/empty';
import { RiskWarnings } from '@/components/results/risk-warnings';
import { SourceCitations } from '@/components/results/source-citations';
import { ComparisonRadar } from '@/components/comparison/comparison-radar';
import { ComparisonBars } from '@/components/comparison/comparison-bars';
import { ComparisonTable } from '@/components/comparison/comparison-table';
import { useComparison } from '@/lib/hooks/queries';

/**
 * 方案对比页 — 输入是查询参数 `ids=cand-1,cand-2,...`；
 * 渲染雷达图 / 柱状图 / 指标对比表三个 tab。
 *
 * `useSearchParams()` 强制此页面进入 Suspense 流程，因此包一层 Suspense
 * 让 Next.js 在静态分析阶段不报错。
 */
export default function ComparisonPage() {
  return (
    <React.Suspense fallback={<LoadingState rows={4} />}>
      <ComparisonContent />
    </React.Suspense>
  );
}

function ComparisonContent() {
  const sp = useSearchParams();
  const ids = React.useMemo(() => {
    const raw = sp?.get('ids') ?? '';
    return raw.split(',').map((x) => x.trim()).filter(Boolean);
  }, [sp]);

  const { data, isLoading, error, refetch } = useComparison(ids);

  return (
    <>
      <PageHeader
        title="方案对比"
        description={`选中 ${ids.length} 个候选方案，进行多维度对比。`}
      />

      {ids.length < 2 ? (
        <EmptyState
          title="请选择 2 个以上方案"
          description="从「逆向推荐结果」页勾选 2-5 个候选后跳转回到本页。"
          icon={<Activity className="h-6 w-6" />}
        />
      ) : isLoading ? (
        <LoadingState rows={6} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data || data.scenarios.length === 0 ? (
        <EmptyState title="未找到对比数据" description="请确认所选 candidate id 是否有效。" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader><CardTitle className="text-base">可视化对比</CardTitle></CardHeader>
              <CardContent>
                <Tabs defaultValue="radar">
                  <TabsList>
                    <TabsTrigger value="radar">雷达图</TabsTrigger>
                    <TabsTrigger value="bars">柱状图</TabsTrigger>
                  </TabsList>
                  <TabsContent value="radar">
                    <ComparisonRadar data={data} />
                    <p className="mt-2 text-xs text-muted-foreground">
                      指标已按各自方向归一化（外圈=越好），便于直观对比方案强弱。
                    </p>
                  </TabsContent>
                  <TabsContent value="bars">
                    <ComparisonBars data={data} />
                    <p className="mt-2 text-xs text-muted-foreground">
                      原始数值按指标分组对比；不同量纲下请配合左侧「指标对比表」查看。
                    </p>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">指标对比表</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <ComparisonTable data={data} />
                <p className="mt-2 text-xs text-muted-foreground">
                  绿色加粗值是该指标的最优方案。
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
