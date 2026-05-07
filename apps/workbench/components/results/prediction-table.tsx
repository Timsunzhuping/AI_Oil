import { CheckCircle2, AlertTriangle, OctagonAlert } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { fmtNum, fmtPct01 } from '@/lib/utils';
import type { PredictionRow } from '@/lib/api/types';

const STATUS_BADGE = {
  ok: { variant: 'success' as const, icon: CheckCircle2, label: '合规' },
  warn: { variant: 'warning' as const, icon: AlertTriangle, label: '边界' },
  fail: { variant: 'destructive' as const, icon: OctagonAlert, label: '不合规' },
};

/**
 * 正向预测结果表 — 每行包含点估计、置信区间、规格区间、状态、置信度。
 * 不合规与边界状态在表格中被高亮，与「风险提示」区互相印证。
 */
export function PredictionTable({ rows }: { rows: PredictionRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>指标</TableHead>
          <TableHead>预测值</TableHead>
          <TableHead>95% 置信区间</TableHead>
          <TableHead>规格区间</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>置信度</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const cfg = STATUS_BADGE[r.status];
          const Icon = cfg.icon;
          const rowClass =
            r.status === 'fail' ? 'bg-destructive/5' : r.status === 'warn' ? 'bg-amber-50/60' : '';
          return (
            <TableRow key={r.metric} className={rowClass}>
              <TableCell>
                <div className="font-medium">{r.display_name}</div>
                <div className="font-mono text-xs text-muted-foreground">{r.metric}</div>
              </TableCell>
              <TableCell>
                <span className="font-medium">{fmtNum(r.point_estimate, 3)}</span>
                {r.unit ? <span className="ml-1 text-xs text-muted-foreground">{r.unit}</span> : null}
              </TableCell>
              <TableCell className="text-sm">
                {fmtNum(r.ci_low, 3)} – {fmtNum(r.ci_high, 3)}
              </TableCell>
              <TableCell className="text-sm">
                {r.spec_low === null && r.spec_high === null
                  ? '—'
                  : `${r.spec_low === null || r.spec_low === undefined ? '−∞' : fmtNum(r.spec_low, 3)} – ${
                      r.spec_high === null || r.spec_high === undefined ? '+∞' : fmtNum(r.spec_high, 3)
                    }`}
              </TableCell>
              <TableCell>
                <Badge variant={cfg.variant} className="gap-1">
                  <Icon className="h-3 w-3" /> {cfg.label}
                </Badge>
              </TableCell>
              <TableCell className="text-sm">{fmtPct01(r.confidence, 0)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
