'use client';

import Link from 'next/link';
import {
  Activity,
  CheckCircle2,
  Clock,
  ListChecks,
  PlusCircle,
  ShieldAlert,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/workbench-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingState } from '@/components/states/loading';
import { ErrorState } from '@/components/states/error';
import { EmptyState } from '@/components/states/empty';
import { StatCard } from '@/components/dashboard/stat-card';
import { TaskStatusBadge, TASK_TYPE_LABELS } from '@/components/tasks/task-status-badge';
import { useTasks } from '@/lib/hooks/queries';
import { fmtDate } from '@/lib/utils';

/**
 * Dashboard 首页
 * - 顶部统计卡：总任务、处理中、已完成、需关注
 * - 中部 CTA：快速发起新任务
 * - 下方：最近任务表
 */
export default function DashboardPage() {
  const { data, isLoading, error, refetch } = useTasks({ pageSize: 10 });

  // Derive simple aggregates from the current page (sufficient for a header strip).
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const processing = items.filter((t) => t.status === 'processing' || t.status === 'submitted').length;
  const completed = items.filter((t) => t.status === 'completed').length;
  const failed = items.filter((t) => t.status === 'failed').length;

  return (
    <>
      <PageHeader
        title="工作台首页"
        description="实时关注 AI 研发任务的运行情况、风险预警与最近进度。"
        actions={
          <Button asChild className="gap-1.5">
            <Link href="/tasks/new">
              <PlusCircle className="h-4 w-4" /> 新建研发任务
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="任务总数"
          value={total}
          delta="近 30 天累计"
          icon={<ListChecks className="h-5 w-5" />}
        />
        <StatCard
          title="处理中 / 队列中"
          value={processing}
          delta="实时统计"
          tone="warning"
          icon={<Clock className="h-5 w-5" />}
        />
        <StatCard
          title="已完成"
          value={completed}
          delta="本页"
          tone="success"
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
        <StatCard
          title="需关注 / 失败"
          value={failed}
          delta={failed === 0 ? '无' : '请优先排查'}
          tone="danger"
          icon={<ShieldAlert className="h-5 w-5" />}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">最近任务</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/tasks">查看全部 →</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <LoadingState />
            ) : error ? (
              <ErrorState error={error} onRetry={() => refetch()} />
            ) : items.length === 0 ? (
              <EmptyState
                title="暂无任务"
                description="还没有发起任何 AI 研发任务，先创建一个试试吧。"
                action={
                  <Button asChild>
                    <Link href="/tasks/new">新建任务</Link>
                  </Button>
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>编号</TableHead>
                    <TableHead>标题</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">提交时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs">{t.code}</TableCell>
                      <TableCell className="max-w-xs truncate">
                        <Link href={`/tasks/${t.id}`} className="hover:underline">
                          {t.title}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {TASK_TYPE_LABELS[t.task_type] ?? t.task_type}
                      </TableCell>
                      <TableCell>
                        <TaskStatusBadge status={t.status} />
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {fmtDate(t.submitted_at ?? t.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" /> 模型与版本
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="预测模型" value="kv-regressor@3.1" />
            <Row label="逆向推荐" value="inverse-rec@1.4" />
            <Row label="知识库" value="rag-store@2026-04" />
            <Row label="处理通道" value="ai-workflow / dispatcher" />
            <p className="pt-2 text-xs text-muted-foreground">
              所有结果页都会展示置信度、风险提示与来源说明三个固定区域。
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b pb-2 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}
