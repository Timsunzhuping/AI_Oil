import { ArrowDown, ArrowUp, Minus, Plus } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { fmtNum } from '@/lib/utils';
import type { FormulaVersionDiffEntry } from '@/lib/api/types';

const CHANGE_META = {
  added: { variant: 'success' as const, icon: Plus, label: '新增', cls: 'bg-emerald-50' },
  removed: { variant: 'destructive' as const, icon: Minus, label: '移除', cls: 'bg-rose-50' },
  increased: { variant: 'info' as const, icon: ArrowUp, label: '增加', cls: '' },
  decreased: { variant: 'warning' as const, icon: ArrowDown, label: '减少', cls: '' },
  unchanged: { variant: 'secondary' as const, icon: Minus, label: '不变', cls: '' },
};

/** 配方版本组成 Diff 表 — 与 Git diff 风格对应：绿=新增，红=移除。 */
export function FormulaDiffTable({ entries }: { entries: FormulaVersionDiffEntry[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>原料</TableHead>
          <TableHead className="text-right">原版本 %</TableHead>
          <TableHead className="text-right">新版本 %</TableHead>
          <TableHead className="text-right">差异</TableHead>
          <TableHead>变化</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((e) => {
          const meta = CHANGE_META[e.change];
          const Icon = meta.icon;
          return (
            <TableRow key={e.raw_material_name} className={meta.cls}>
              <TableCell className="font-medium">{e.raw_material_name}</TableCell>
              <TableCell className="text-right tabular-nums">
                {e.before === null ? <span className="text-muted-foreground">—</span> : fmtNum(e.before, 2)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {e.after === null ? <span className="text-muted-foreground">—</span> : fmtNum(e.after, 2)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {e.delta === null ? '—' : (
                  <span
                    className={
                      e.delta > 0 ? 'text-sky-600' : e.delta < 0 ? 'text-amber-600' : ''
                    }
                  >
                    {e.delta > 0 ? '+' : ''}{fmtNum(e.delta, 2)}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={meta.variant} className="gap-1">
                  <Icon className="h-3 w-3" /> {meta.label}
                </Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
