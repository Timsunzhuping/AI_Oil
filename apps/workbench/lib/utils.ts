import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn-style className merger. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Pretty-format a number with N decimals; returns '—' for null/NaN. */
export function fmtNum(n: number | null | undefined, places = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return Number(n).toFixed(places);
}

/** Format a percentage in 0..1 as 87.4 %. */
export function fmtPct01(n: number | null | undefined, places = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(places)} %`;
}

/** Format a date / ISO string. */
export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Map a confidence score (0..1) to a coarse band used by the badge. */
export function confidenceBand(score: number | null | undefined): 'low' | 'medium' | 'high' | 'unknown' {
  if (score === null || score === undefined || !Number.isFinite(score)) return 'unknown';
  if (score >= 0.8) return 'high';
  if (score >= 0.6) return 'medium';
  return 'low';
}
