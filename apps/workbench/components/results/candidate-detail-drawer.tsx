'use client';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ConfidenceBadge } from '@/components/results/confidence-badge';
import { RiskWarnings } from '@/components/results/risk-warnings';
import { SourceCitations } from '@/components/results/source-citations';
import { PredictionTable } from '@/components/results/prediction-table';
import { fmtNum } from '@/lib/utils';
import type { InverseCandidate } from '@/lib/api/types';

interface Props {
  candidate: InverseCandidate | null;
  onClose: () => void;
}

/** 候选方案详情抽屉 — 完整组成、预测、风险、来源。 */
export function CandidateDetailDrawer({ candidate: c, onClose }: Props) {
  return (
    <Sheet open={Boolean(c)} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-hidden sm:max-w-2xl">
        {c ? (
          <>
            <SheetHeader className="pr-8">
              <SheetTitle className="flex items-center gap-2">
                <Badge variant="secondary">候选 #{c.rank}</Badge>
                <span className="truncate">{c.name}</span>
              </SheetTitle>
              <SheetDescription>{c.headline}</SheetDescription>
            </SheetHeader>

            <ScrollArea className="-mr-6 mt-4 h-[calc(100vh-9rem)] pr-6">
              <div className="space-y-4 pb-8">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border bg-muted/30 p-3">
                    <div className="text-xs text-muted-foreground">估算成本</div>
                    <div className="text-lg font-semibold">
                      {fmtNum(c.estimated_cost, 2)} <span className="text-xs">{c.cost_unit}</span>
                    </div>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-3">
                    <div className="text-xs text-muted-foreground">置信度</div>
                    <div className="mt-1"><ConfidenceBadge score={c.confidence} /></div>
                  </div>
                </div>

                <Card>
                  <CardHeader><CardTitle className="text-base">配方组成</CardTitle></CardHeader>
                  <CardContent>
                    <ul className="divide-y text-sm">
                      {c.composition.map((row) => (
                        <li key={row.raw_material_id} className="flex items-center justify-between py-2">
                          <div>
                            <div>{row.raw_material_name}</div>
                            <div className="font-mono text-xs text-muted-foreground">{row.raw_material_id}</div>
                          </div>
                          <span className="font-mono text-sm">{fmtNum(row.percentage, 2)} %</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-base">预测指标</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <PredictionTable rows={c.predicted_metrics} />
                  </CardContent>
                </Card>

                <RiskWarnings risks={c.risks} />
                <SourceCitations sources={c.sources} />
              </div>
            </ScrollArea>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
