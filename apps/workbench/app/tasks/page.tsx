'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PlusCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/workbench-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { LoadingState } from '@/components/states/loading';
import { ErrorState } from '@/components/states/error';
import { EmptyState } from '@/components/states/empty';
import { TaskStatusBadge, TASK_TYPE_LABELS } from '@/components/tasks/task-status-badge';
import { ConfidenceBadge } from '@/components/results/confidence-badge';
import { useTasks } from '@/lib/hooks/queries';
import { fmtDate } from '@/lib/utils';
import type { TaskStatus, TaskType } from '@/lib/api/types';

/** 任务列表页 — 支持按状态与类型筛选。 */
export default function TasksListPage() {
  const [status, setStatus] = useState<TaskStatus | 'all'>('all');
  const [type, setType] = useState<TaskType | 'all'>('all');

  const { data, isLoading, error, refetch } = useTasks({
    status: status === 'all' ? undefined : status,
    task_type: type === 'all' ? undefined : type,
    pageSize: 50,
  });
  const items = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="研发任务"
        description="所有 AI 研发任务的状态汇总。"
        actions={
          <Button asChild>
            <Link href="/tasks/new"><PlusCircle className="mr-2 h-4 w-4" /> 新建任务</Link>
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div>
            <span className="mr-2 text-xs text-muted-foreground">状态</span>
            <Select value={status} onValueChange={(v) => setStatus(v as never)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="draft">草稿</SelectItem>
                <SelectItem value="submitted">已提交</SelectItem>
                <SelectItem value="processing">处理中</SelectItem>
                <SelectItem value="completed">已完成</SelectItem>
                <SelectItem value="failed">失败</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <span className="mr-2 text-xs text-muted-foreground">类型</span>
            <Select value={type} onValueChange={(v) => setType(v as never)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                {Object.entries(TASK_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6"><LoadingState /></div>
          ) : error ? (
            <div className="p-6"><ErrorState error={error} onRetry={() => refetch()} /></div>
          ) : items.length === 0 ? (
            <div className="p-6">
              <EmptyState title="无匹配任务" description="当前筛选条件下没有任务，试试清空筛选。" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>编号</TableHead>
                  <TableHead>标题</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>置信度</TableHead>
                  <TableHead className="text-right">提交时间</TableHead>
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
                    <TableCell><ConfidenceBadge score={t.confidence_score ?? null} /></TableCell>
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
    </>
  );
}
