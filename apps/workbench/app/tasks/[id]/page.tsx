'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/layout/workbench-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/states/loading';
import { ErrorState } from '@/components/states/error';
import { TaskStatusBadge, TASK_TYPE_LABELS } from '@/components/tasks/task-status-badge';
import { ConfidenceBadge } from '@/components/results/confidence-badge';
import { ExportButton } from '@/components/export/export-button';
import { useTask } from '@/lib/hooks/queries';
import { fmtDate } from '@/lib/utils';

/** 任务详情页 — 概览 + 输入摘要 + 跳转到对应结果页。 */
export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { data: task, isLoading, error, refetch } = useTask(id);

  return (
    <>
      <PageHeader
        title={task ? `任务 ${task.code}` : '任务详情'}
        description={task?.title}
        actions={task ? <ExportButton taskId={task.id} /> : null}
      />

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : task ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">概览</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <Row label="编号" value={task.code} mono />
              <Row label="类型" value={TASK_TYPE_LABELS[task.task_type] ?? task.task_type} />
              <Row label="状态" value={<TaskStatusBadge status={task.status} />} />
              <Row label="置信度" value={<ConfidenceBadge score={task.confidence_score ?? null} />} />
              <Row label="提交时间" value={fmtDate(task.submitted_at)} />
              <Row label="完成时间" value={fmtDate(task.completed_at)} />
              <Row label="处理器版本" value={task.handler_version ?? '—'} mono />
              <Row label="trace" value={task.trace_id ?? '—'} mono />
              {task.description ? (
                <div className="sm:col-span-2 rounded-md bg-muted/40 p-3 text-sm">{task.description}</div>
              ) : null}
              {task.summary ? (
                <div className="sm:col-span-2 rounded-md border-l-2 border-primary bg-primary/5 p-3 text-sm">
                  {task.summary}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">查看结果</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <ResultLink href={`/results/forward/${task.id}`} label="正向预测结果" />
              <ResultLink href={`/results/inverse/${task.id}`} label="逆向推荐结果" />
              <ResultLink href={`/comparison?task=${task.id}`} label="方案对比" />
              {task.related_formula_version_id ? (
                <ResultLink
                  href={`/diff?base=fv-1022&target=${task.related_formula_version_id}`}
                  label="配方版本 Diff"
                />
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between border-b pb-2 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-xs' : ''}>{value ?? '—'}</span>
    </div>
  );
}

function ResultLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="outline" className="w-full justify-between">
      <Link href={href}>{label} <ArrowRight className="h-4 w-4" /></Link>
    </Button>
  );
}
