'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { GitCompareArrows, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/layout/workbench-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/states/loading';
import { ErrorState } from '@/components/states/error';
import { EmptyState } from '@/components/states/empty';
import { ConfidenceBadge } from '@/components/results/confidence-badge';
import { RiskWarnings } from '@/components/results/risk-warnings';
import { SourceCitations } from '@/components/results/source-citations';
import { CandidateCard } from '@/components/results/candidate-card';
import { CandidateDetailDrawer } from '@/components/results/candidate-detail-drawer';
import { ExportButton } from '@/components/export/export-button';
import { useInverseResult } from '@/lib/hooks/queries';
import type { InverseCandidate } from '@/lib/api/types';

/**
 * 逆向推荐结果页 — 3-5 张候选卡片 + 详情抽屉 + 加入对比。
 */
export default function InverseResultPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { data, isLoading, error, refetch } = useInverseResult(id);
  const [detail, setDetail] = React.useState<InverseCandidate | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const aggregate = data
    ? data.candidates.reduce((acc, c) => acc + c.confidence, 0) / Math.max(1, data.candidates.length)
    : null;

  const allRisks = data ? data.candidates.flatMap((c) => c.risks) : [];
  const allSources = data ? dedupeSources(data.candidates.flatMap((c) => c.sources)) : [];

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const compareHref = `/comparison?ids=${[...selected].join(',')}`;

  return (
    <>
      <PageHeader
        title="逆向推荐结果"
        description={`任务 ${id ?? ''} — 在你的目标性能、成本与法规约束下，模型推荐的候选配方。`}
        actions={
          <div className="flex items-center gap-2">
            <ConfidenceBadge score={aggregate} label="综合置信度" />
            <Button asChild variant="outline" size="sm" disabled={selected.size < 2}>
              <Link href={compareHref}>
                <GitCompareArrows className="mr-2 h-4 w-4" />
                对比 ({selected.size})
              </Link>
            </Button>
            {id ? <ExportButton taskId={id} /> : null}
          </div>
        }
      />

      {isLoading ? (
        <LoadingState rows={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data || data.candidates.length === 0 ? (
        <EmptyState
          title="尚无候选方案"
          description="任务还在生成候选，稍候再来或回到任务列表。"
          icon={<Sparkles className="h-6 w-6" />}
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:col-span-3 xl:grid-cols-3">
            {data.candidates.map((c) => (
              <CandidateCard
                key={c.id}
                candidate={c}
                selected={selected.has(c.id)}
                onSelect={() => toggle(c.id)}
                onOpenDetail={() => setDetail(c)}
              />
            ))}
          </div>
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">说明</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>每张卡片代表一个候选方案，按综合得分排序。</p>
                <p>点击「加入对比」选 2-5 个候选后可跳转到雷达图与指标对比表。</p>
              </CardContent>
            </Card>
            <RiskWarnings risks={dedupeRisks(allRisks)} />
            <SourceCitations sources={allSources} />
          </div>
        </div>
      )}

      <CandidateDetailDrawer candidate={detail} onClose={() => setDetail(null)} />
    </>
  );
}

function dedupeRisks<T extends { code: string; message: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of arr) {
    const k = `${r.code}|${r.message}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function dedupeSources<T extends { id: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const s of arr) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}
