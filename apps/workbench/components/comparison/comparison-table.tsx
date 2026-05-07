import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfidenceBadge } from '@/components/results/confidence-badge';
import { fmtNum } from '@/lib/utils';
import type { ComparisonPayload } from '@/lib/api/types';

/**
 * 指标对比表 — 行=指标，列=方案。最佳值用粗体+绿色高亮。
 */
export function ComparisonTable({ data }: { data: ComparisonPayload }) {
  const rows = data.metric_axes.map((axis) => {
    const values = data.scenarios.map((s) =>
      axis.key === 'estimated_cost' ? s.estimated_cost : (s.metrics[axis.key] ?? null),
    );
    const numeric = values.filter((v): v is number => typeof v === 'number');
    const best = numeric.length === 0 ? null : axis.better === 'higher' ? Math.max(...numeric) : Math.min(...numeric);
    return { axis, values, best };
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>指标</TableHead>
          <TableHead className="hidden lg:table-cell">单位</TableHead>
          {data.scenarios.map((s) => (
            <TableHead key={s.id} className="text-right">{s.name}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ axis, values, best }) => (
          <TableRow key={axis.key}>
            <TableCell>
              <div className="font-medium">{axis.display_name}</div>
              <div className="font-mono text-xs text-muted-foreground">{axis.key}</div>
            </TableCell>
            <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
              {axis.unit ?? '—'} · 越{axis.better === 'higher' ? '高' : '低'}越好
            </TableCell>
            {values.map((v, i) => {
              const isBest = v !== null && v === best && best !== null;
              return (
                <TableCell key={i} className="text-right tabular-nums">
                  <span className={isBest ? 'font-semibold text-emerald-700' : ''}>
                    {v === null ? '—' : fmtNum(v, 3)}
                  </span>
                </TableCell>
              );
            })}
          </TableRow>
        ))}
        <TableRow>
          <TableCell className="font-medium">置信度</TableCell>
          <TableCell className="hidden lg:table-cell" />
          {data.scenarios.map((s) => (
            <TableCell key={s.id} className="text-right">
              <ConfidenceBadge score={s.confidence} />
            </TableCell>
          ))}
        </TableRow>
      </TableBody>
    </Table>
  );
}
