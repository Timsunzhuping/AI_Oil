'use client';

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PredictionRow } from '@/lib/api/types';

/**
 * Predicted-vs-spec bar chart. Each bar normalises the prediction to its
 * spec midpoint so different metric scales fit on one axis.
 */
export function PredictionBarChart({ rows }: { rows: PredictionRow[] }) {
  const data = rows.map((r) => {
    const lo = r.spec_low ?? r.ci_low;
    const hi = r.spec_high ?? r.ci_high;
    const mid = (lo + hi) / 2 || 1;
    const range = (hi - lo) / 2 || mid * 0.1;
    return {
      metric: r.display_name,
      normalised: ((r.point_estimate - mid) / range).toFixed(3),
      raw: r.point_estimate,
      status: r.status,
    };
  });

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="metric" tick={{ fontSize: 12 }} interval={0} />
        <YAxis
          tick={{ fontSize: 12 }}
          domain={[-1.5, 1.5]}
          label={{ value: '相对规格中点（>0 为偏高，<0 为偏低）', angle: -90, position: 'insideLeft', fontSize: 11 }}
        />
        <Tooltip
          formatter={(value, _, item) => [`${value} (raw=${(item.payload as { raw: number }).raw})`, '相对位置']}
        />
        <ReferenceLine y={0} stroke="#64748b" strokeDasharray="4 2" />
        <ReferenceLine y={1} stroke="#f59e0b" strokeDasharray="2 2" />
        <ReferenceLine y={-1} stroke="#f59e0b" strokeDasharray="2 2" />
        <Bar dataKey="normalised" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
