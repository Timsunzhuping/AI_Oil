'use client';

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts';
import type { ComparisonPayload } from '@/lib/api/types';

const PALETTE = [
  'hsl(220, 90%, 56%)',
  'hsl(150, 65%, 45%)',
  'hsl(35, 95%, 55%)',
  'hsl(0, 85%, 60%)',
  'hsl(265, 65%, 60%)',
];

/**
 * 雷达图 — 把每个 metric 归一化到 0..1（"better" 方向越外越好）后画在
 * 同一图里。每条线是一个候选方案。
 */
export function ComparisonRadar({ data }: { data: ComparisonPayload }) {
  const axes = data.metric_axes;
  // For each axis, compute min/max across all scenarios for normalisation.
  const minMax = axes.map((axis) => {
    const values = data.scenarios.map((s) =>
      axis.key === 'estimated_cost' ? s.estimated_cost : (s.metrics[axis.key] ?? 0),
    );
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { min, max: max === min ? max + 1 : max };
  });

  // Build the chart-friendly dataset: rows = axes, columns = scenarios.
  const rows = axes.map((axis, i) => {
    const row: Record<string, number | string> = { axis: axis.display_name };
    data.scenarios.forEach((s) => {
      const raw = axis.key === 'estimated_cost' ? s.estimated_cost : (s.metrics[axis.key] ?? 0);
      const { min, max } = minMax[i];
      const norm = (raw - min) / (max - min);
      row[s.name] = axis.better === 'higher' ? norm : 1 - norm;
    });
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={360}>
      <RadarChart data={rows} outerRadius="70%">
        <PolarGrid />
        <PolarAngleAxis dataKey="axis" tick={{ fontSize: 12 }} />
        <PolarRadiusAxis domain={[0, 1]} tick={{ fontSize: 10 }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {data.scenarios.map((s, i) => (
          <Radar
            key={s.id}
            name={s.name}
            dataKey={s.name}
            stroke={PALETTE[i % PALETTE.length]}
            fill={PALETTE[i % PALETTE.length]}
            fillOpacity={0.18}
            strokeWidth={2}
          />
        ))}
      </RadarChart>
    </ResponsiveContainer>
  );
}
