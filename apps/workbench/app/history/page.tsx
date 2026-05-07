'use client';

import Link from 'next/link';
import { History } from 'lucide-react';
import { PageHeader } from '@/components/layout/workbench-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingState } from '@/components/states/loading';
import { ErrorState } from '@/components/states/error';
import { EmptyState } from '@/components/states/empty';
import { useTasks } from '@/lib/hooks/queries';
import { TaskStatusBadge, TASK_TYPE_LABELS } from '@/components/tasks/task-status-badge';
import { fmtDate } from '@/lib/utils';

/** 历史记录 — 简化版任务列表，按完成时间倒序。 */
export default function HistoryPage() {
  const { data, isLoading, error, refetch } = useTasks({ pageSize: 100 });
  const items = (data?.items ?? []).filter((t) => t.completed_at !== null);

  return (
    <>
      <PageHeader title="历史记录" description="所有已完成的研发任务及其结果索引。" />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6"><LoadingState /></div>
          ) : error ? (
            <div className="p-6"><ErrorState error={error} onRetry={() => refetch()} /></div>
          ) : items.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="暂无历史记录"
                description="还没有已完成的任务，先去新建一个吧。"
                icon={<History className="h-6 w-6" />}
                action={<Button asChild><Link href="/tasks/new">新建任务</Link></Button>}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>编号</TableHead>
                  <TableHead>标题</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">完成时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.code}</TableCell>
                    <TableCell className="max-w-md truncate">
                      <Link href={`/tasks/${t.id}`} className="hover:underline">{t.title}</Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {TASK_TYPE_LABELS[t.task_type] ?? t.task_type}
                    </TableCell>
                    <TableCell><TaskStatusBadge status={t.status} /></TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {fmtDate(t.completed_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
