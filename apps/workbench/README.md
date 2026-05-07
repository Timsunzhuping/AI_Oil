# FluidMind 研发工作台 (`@fluidmind/workbench`)

Next.js + TypeScript + Tailwind + shadcn/ui frontend for the FluidMind R&D
platform. Implements the 10 deliverables of the workbench module:

1. Dashboard 首页 — `/`
2. 新建研发任务页 — `/tasks/new` (3 入口：结构化 / 自然语言 / 模板)
3. 结构化需求输入页 — `components/tasks/structured-form.tsx` (产品场景 / 目标性能 / 成本 / 原料 / 法规 / 工艺)
4. 自然语言输入面板 — `components/tasks/nl-chat-panel.tsx` (Chat-style)
5. 历史配方模板加载弹窗 — `components/tasks/template-loader-dialog.tsx`
6. 正向预测结果页 — `/results/forward/[id]` (表格 + 柱状图 + 风险 + 来源)
7. 逆向推荐结果页 — `/results/inverse/[id]` (3-5 张候选卡片 + 详情抽屉)
8. 方案对比页 — `/comparison?ids=…` (雷达图 + 柱状图 + 指标表)
9. 配方版本对比页 — `/diff?base=…&target=…` (Diff 表 + 指标 delta)
10. 导出入口 — `components/export/export-button.tsx` (PDF / Excel / CSV，先做 mock)

## Run

```bash
# from repo root, with pnpm workspaces
pnpm install
pnpm --filter @fluidmind/workbench dev   # http://localhost:3100

# or with the backend running on :3001
BACKEND_URL=http://localhost:3001 pnpm --filter @fluidmind/workbench dev
```

Mock-only mode (no backend required):

```bash
NEXT_PUBLIC_USE_MOCK=1 pnpm --filter @fluidmind/workbench dev
```

## Architecture

```
app/                  Next.js App Router pages
  layout.tsx          Root layout with Providers + WorkbenchShell
  providers.tsx       React Query / TooltipProvider / ToastProvider
  page.tsx            Dashboard 首页
  tasks/              任务相关路由
    new/              新建任务页 (3 tab 入口)
    [id]/             任务详情 + 跳转到结果页
  results/forward/[id]/ 正向预测结果
  results/inverse/[id]/ 逆向推荐结果
  comparison/         方案对比
  diff/               版本 Diff
  history/            历史记录

components/
  ui/                 shadcn/ui 基础组件 (button/card/input/dialog/sheet/...)
  layout/             侧边栏 / Topbar / 整体壳
  states/             loading / empty / error 三态
  results/            置信度徽标 / 风险提示 / 来源引用 / 预测表 / 候选卡 / 详情抽屉
  comparison/         雷达图 / 柱状图 / 指标对比表
  diff/               配方组成 Diff 表
  tasks/              结构化表单 / NL Chat / 模板加载弹窗 / 状态徽标
  dashboard/          统计卡片
  export/             导出按钮 (含格式下拉 + toast)

lib/
  api/
    types.ts          所有 API 数据契约
    mocks.ts          离线 mock fixtures (与 types 同形)
    client.ts         fetch 封装，解开统一信封
    adapters.ts       mock-or-real 适配器层
  hooks/queries.ts    React Query 封装 (tasks/formulas/templates/export/qa)
  schemas/structured-input.ts  Zod schema (6 分组 + NL prompt)
  utils.ts            cn / fmtNum / fmtPct01 / fmtDate / confidenceBand
```

## 三态规范

- **Loading** — 所有列表 / 详情页统一使用 `<LoadingState />`，提供卡片骨架；
  小区域可用 `<InlineLoading />`。
- **Empty** — `<EmptyState />` 居中卡片，提供描述与可选 action 按钮。
- **Error** — `<ErrorState />` 解析 `ApiError` 的 code / message / traceId，
  并提供「重试」按钮。

## 结果页固定区域

每个结果页（正向 / 逆向 / 对比 / 候选详情）都会渲染三个固定区域：

- 置信度 — `<ConfidenceBadge score={...} />` 自动按 0.8 / 0.6 阈值映射高 / 中 / 低；
- 风险提示 — `<RiskWarnings risks={...} />` 列出 critical / warning / info 三档，
  无风险时显示明确的「无显著风险」空态；
- 来源说明 — `<SourceCitations sources={...} />` 按文献 / 试验 / 模型 / 标准
  四类图标展示，附相关性分数。

## 表单校验

结构化录入与自然语言录入均使用 `react-hook-form + @hookform/resolvers/zod`：
- `lib/schemas/structured-input.ts::structuredInputSchema` — 6 分组结构。
- `lib/schemas/structured-input.ts::nlPromptSchema` — 标题 / 提示词 / 类型 / 优先级。

校验失败时 toast 提示「请检查表单」，单字段错误显示在字段下方。

## API 适配

- `apiClient` 解开统一信封 `{ code, message, data, traceId, timestamp }`，
  非零 `code` 抛出 `ApiError`。
- `withFallback` 在网络失败或 `NEXT_PUBLIC_USE_MOCK=1` 时切换到 `mocks.ts`，
  保证前端可独立开发。
- 所有 Hook 经由 `lib/hooks/queries.ts` 暴露，统一管理 queryKey 与失效。
