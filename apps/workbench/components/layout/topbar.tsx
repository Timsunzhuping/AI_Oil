'use client';

import Link from 'next/link';
import { Bell, PlusCircle, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Top bar with global search, new task CTA, and a notification placeholder. */
export function TopBar() {
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-4 border-b bg-background/85 px-6 backdrop-blur">
      <div className="hidden flex-1 lg:block">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="搜索任务"
            placeholder="搜索任务编号、标题、配方版本号…"
            className="pl-9"
          />
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button asChild size="sm" className="gap-1.5">
          <Link href="/tasks/new">
            <PlusCircle className="h-4 w-4" /> 新建任务
          </Link>
        </Button>
        <Button variant="ghost" size="icon" aria-label="通知">
          <Bell className="h-4 w-4" />
        </Button>
        <div className="ml-2 flex h-9 w-9 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
          R
        </div>
      </div>
    </header>
  );
}
