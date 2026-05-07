import * as React from 'react';
import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { WorkbenchShell } from '@/components/layout/workbench-shell';

export const metadata: Metadata = {
  title: 'FluidMind 研发工作台',
  description: '润滑油 AI 研发工作台 — 配方预测、优化、对比与版本管理',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Providers>
          <WorkbenchShell>{children}</WorkbenchShell>
        </Providers>
      </body>
    </html>
  );
}
