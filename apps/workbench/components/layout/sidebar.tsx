'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  GitCompareArrows,
  History,
  Home,
  LineChart,
  ListChecks,
  PlusCircle,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  { href: '/', label: '工作台首页', icon: Home },
  { href: '/tasks', label: '研发任务', icon: ListChecks },
  { href: '/tasks/new', label: '新建任务', icon: PlusCircle },
  { href: '/results/forward/t-1001', label: '正向预测示例', icon: LineChart },
  { href: '/results/inverse/t-1003', label: '逆向推荐示例', icon: Sparkles },
  { href: '/comparison', label: '方案对比', icon: Activity },
  { href: '/diff', label: '版本 Diff', icon: GitCompareArrows },
  { href: '/history', label: '历史记录', icon: History },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-card lg:flex lg:flex-col">
      <div className="flex h-16 items-center gap-2 px-5 font-semibold">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          F
        </span>
        <span className="text-base tracking-tight">FluidMind 研发工作台</span>
      </div>
      <nav className="flex-1 space-y-0.5 px-3 pb-4 text-sm">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active =
            href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'group flex items-center gap-2 rounded-md px-3 py-2 text-muted-foreground transition-colors',
                'hover:bg-accent hover:text-foreground',
                active && 'bg-accent font-medium text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-4 text-xs text-muted-foreground">
        v0.1 · 模型：mock-v1
      </div>
    </aside>
  );
}
