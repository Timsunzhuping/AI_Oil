import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ConfidenceBadge } from '@/components/results/confidence-badge';
import { fmtNum } from '@/lib/utils';
import type { InverseCandidate } from '@/lib/api/types';

interface CandidateCardProps {
  candidate: InverseCandidate;
  selected?: boolean;
  onSelect?: () => void;
  onOpenDetail?: () => void;
}

/** 逆向候选方案卡片 — 用于结果页的 3-5 张并列展示。 */
export function CandidateCard({ candidate: c, selected, onSelect, onOpenDetail }: CandidateCardProps) {
  const topMetrics = c.predicted_metrics.slice(0, 3);
  return (
    <Card className={'h-full ' + (selected ? 'ring-2 ring-primary' : '')}>
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between">
          <Badge variant="secondary">候选 #{c.rank}</Badge>
          <ConfidenceBadge score={c.confidence} />
        </div>
        <h3 className="text-base font-semibold">{c.name}</h3>
        <p className="text-xs text-muted-foreground">{c.headline}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md bg-muted/40 p-3 text-sm">
          <div className="text-xs text-muted-foreground">估算成本</div>
          <div className="text-lg font-semibold">
            {fmtNum(c.estimated_cost, 2)} <span className="text-xs text-muted-foreground">{c.cost_unit}</span>
          </div>
        </div>

        <ul className="space-y-1.5 text-sm">
          {topMetrics.map((m) => (
            <li key={m.metric} className="flex items-center justify-between">
              <span className="text-muted-foreground">{m.display_name}</span>
              <span className="font-medium">
                {fmtNum(m.point_estimate, 2)}
                {m.unit ? <span className="ml-1 text-xs text-muted-foreground">{m.unit}</span> : null}
              </span>
            </li>
          ))}
        </ul>

        {c.risks.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {c.risks.slice(0, 2).map((r, i) => (
              <Badge
                key={i}
                variant={r.level === 'critical' ? 'destructive' : r.level === 'warning' ? 'warning' : 'info'}
                className="font-normal"
              >
                {r.code}
              </Badge>
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button variant={selected ? 'default' : 'outline'} size="sm" onClick={onSelect}>
            {selected ? '已选用' : '加入对比'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onOpenDetail} className="gap-1 text-xs">
            查看详情 <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
