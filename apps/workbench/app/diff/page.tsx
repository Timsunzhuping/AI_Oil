'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, GitCompareArrows } from 'lucide-react';
import { PageHeader } from '@/components/layout/workbench-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingState } from '@/components/states/loading';
import { ErrorState } from '@/components/states/error';
import { EmptyState } from '@/components/states/empty';
import { FormulaDiffTable } from '@/components/diff/formula-diff-table';
import { useFormulaDiff } from '@/lib/hooks/queries';
import { fmtNum } from '@/lib/utils';

/**
 * 配方版本对比页 (Diff) — 输入 ?base=...&target=...
 * 渲染：组成 diff 表 + 关键指标 delta 表 + 头部摘要。
 */
export default function FormulaDiffPage() {
  return (
    <React.Suspense fallback={<LoadingState rows={4} />}>
      <DiffContent />
    </React.Suspense>
  );
}

function DiffContent() {
  const sp = useSearchParams();
  const base = sp?.get('base') ?? 'fv-1022';
  const target = sp?.get('target') ?? 'fv-1023';
  const { data, isLoading, error, refetch } = useFormulaDiff(base, target);

  const totals = data
    ? {
        added: data.entries.filter((e) => e.change === 'added').length,
        removed: data.entries.filter((e) => e.change === 'removed').length,
        changed: data.entries.filter((e) => e.change === 'increased' || e.change === 'decreased').length,
      }
    : null;

  return (
    <>
      <PageHeader
        title="配方版本对比"
        description={`Diff: ${base} → ${target}`}
      />

      {isLoading ? (
        <LoadingState rows={6} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data ? (
        <EmptyState
          title="缺少 Diff 参数"
          description="请通过 base 与 target 参数指定要对比的两个配方版本。"
          icon={<GitCompareArrows className="h-6 w-6" />}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Badge variant="secondary" className="font-mono text-xs">{data.base.version_label}</Badge>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <Badge variant="default" className="font-mono text-xs">{data.target.version_label}</Badge>
                <span className="ml-2 text-sm font-normal text-muted-foreground">配方组成 Diff</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <FormulaDiffTable entries={data.entries} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">变更摘要</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {totals ? (
                <ul className="space-y-2">
                  <li className="flex items-center justify-between"><span>新增原料</span><Badge variant="success">+{totals.added}</Badge></li>
                  <li className="flex items-center justify-between"><span>移除原料</span><Badge variant="destructive">-{totals.removed}</Badge></li>
                  <li className="flex items-center justify-between"><span>用量调整</span><Badge variant="info">{totals.changed}</Badge></li>
                </ul>
              ) : null}
              <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                Diff 视图保留两个版本完整的原料列表，便于工艺评审与归档。
              </p>
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">关键指标差异</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>指标</TableHead>
                    <TableHead className="text-right">原版本</TableHead>
                    <TableHead className="text-right">新版本</TableHead>
                    <TableHead className="text-right">变化</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.metric_deltas.map((m) => (
                    <TableRow key={m.metric}>
                      <TableCell>
                        <div className="font-medium">{m.display_name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{m.metric}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(m.before, 3)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(m.after, 3)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className={m.delta > 0 ? 'text-sky-600' : m.delta < 0 ? 'text-amber-600' : ''}>
                          {m.delta > 0 ? '+' : ''}{fmtNum(m.delta, 3)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
