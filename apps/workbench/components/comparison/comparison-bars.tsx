'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ComparisonPayload } from '@/lib/api/types';

const PALETTE = [
  'hsl(220, 90%, 56%)',
  'hsl(150, 65%, 45%)',
  'hsl(35, 95%, 55%)',
  'hsl(0, 85%, 60%)',
  'hsl(265, 65%, 60%)',
];

/** 柱状图：每个指标一组柱，柱按方案分色。 */
export function ComparisonBars({ data }: { data: ComparisonPayload }) {
  const rows = data.metric_axes.map((axis) => {
    const row: Record<string, string | number> = { metric: axis.display_name };
    data.scenarios.forEach((s) => {
      row[s.name] = axis.key === 'estimated_cost' ? s.estimated_cost : (s.metrics[axis.key] ?? 0);
    });
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="metric" tick={{ fontSize: 12 }} interval={0} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {data.scenarios.map((s, i) => (
          <Bar
            key={s.id}
            dataKey={s.name}
            fill={PALETTE[i % PALETTE.length]}
            radius={[3, 3, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
