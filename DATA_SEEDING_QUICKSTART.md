# FluidMind 平台数据注入快速指南

## 概述

已为 FluidMind 平台注入了全面的模拟数据，涵盖所有 13 个后端模块，能充分展示系统的完整能力。

**数据量**:

- 35+ 原料材料
- 8+ 配方（已发布 + 草稿）
- 3 个 ML 模型 + 生产部署版本
- 4 个验收测试集（forward/inverse/stability）
- 4 个 R&D 任务（不同生命周期阶段）
- 3 篇知识文档 + 3 个专家问答对
- 2 个推荐请求 + 3 个候选 BOM
- 2 个预测历史记录

## 快速启动

### 选项 1：Shell 脚本（推荐）

```bash
cd infra/db

# 使用 .env.local 中的数据库凭证
./seed.sh

# 或指定连接字符串
./seed.sh --pgconnect "postgres://user:pass@localhost/fluidmind"

# 干运行模式（不执行，只显示）
./seed.sh --dry-run
```

### 选项 2：TypeScript / Node.js

```bash
cd infra/db

# 需要先编译 TypeScript
npx ts-node seed.ts

# 或
pnpm exec ts-node seed.ts -- --dry-run
```

### 选项 3：直接 SQL

```bash
psql -d fluidmind -f seeds/13_evaluation_and_acceptance.sql
psql -d fluidmind -f seeds/14_prediction_and_recommendation.sql
psql -d fluidmind -f seeds/15_tasks_knowledge_qa.sql
```

## 注入的数据结构

### 1. 评估 & 验收模块 (`13_evaluation_and_acceptance.sql`)

**内容**：

- 4 个验收测试集（包含 8 个测试 case）
- Forward acceptance: 2 个测试集（PCMO 5W-30 + 齿轮油 ISO VG 220）
- Inverse acceptance: 1 个测试集（推荐约束检验）
- Stability acceptance: 1 个测试集（预测器确定性检验）

**访问 API**：

```bash
# 列出测试集
curl http://localhost:3000/v1/evaluation/test-sets

# 获取特定测试集
curl http://localhost:3000/v1/evaluation/test-sets/22222222-2222-2222-2222-222222222201

# 运行验收（forward）
curl -X POST http://localhost:3000/v1/evaluation/runs \
  -H "Content-Type: application/json" \
  -d '{
    "test_set_id": "22222222-2222-2222-2222-222222222201",
    "trigger_type": "manual"
  }'

# 导出报告
curl http://localhost:3000/v1/evaluation/runs/<run_id>/export?format=markdown \
  -o report.md
```

### 2. 预测 & 推荐模块 (`14_prediction_and_recommendation.sql`)

**内容**：

- 3 个 ML 模型 + 生产部署版本
  - `pred-viscosity-v1`: 单输出粘度预测
  - `pred-multioutput-v1`: 多输出物理特性预测
  - `rec-formula-gen-v1`: 配方推荐引擎
- 2 个预测历史记录（实际预测结果）
- 2 个推荐请求 + 3 个候选 BOM

**场景**：

- **成本优化**: KV_100C=11.5 @ <$35/L
- **高端**: KV_100C=12.0 + VI=165 + TBN=10 @ <$50/L

**访问 API**：

```bash
# 列出模型
curl http://localhost:3000/v1/ml/models

# 获取模型版本
curl http://localhost:3000/v1/ml/models/33333333-3333-3333-3333-333333333301/versions

# 执行预测
curl -X POST http://localhost:3000/v1/predict \
  -H "Content-Type: application/json" \
  -d '{
    "product_category": "engine_oil_pcmo",
    "bom_items": [
      {"material_code": "PAO-6", "ratio": 0.50},
      {"material_code": "GIII-4cSt", "ratio": 0.30},
      {"material_code": "OCP", "ratio": 0.12},
      {"material_code": "PKG-A", "ratio": 0.08}
    ]
  }'

# 获取推荐请求及候选
curl http://localhost:3000/v1/recommend/requests/66666666-6666-6666-6666-666666666601/candidates
```

### 3. 任务 & 知识库模块 (`15_tasks_knowledge_qa.sql`)

**内容**：

- 3 个任务模板 + 4 个任务实例
  - TASK-2026-001: 开发 5W-30 PCMO 变体（进行中）
  - TASK-2026-002: 座舱测试（已分配）
  - TASK-2026-003: 齿轮油 ISO VG 220（草稿）
  - TASK-2026-004: 知识库审计（待审）

- 3 篇知识文档
  - PAO 基础油：性质、选择指南、成本
  - 粘度指数改进剂 (VII)：功能、用量、供应商
  - 洗涤-分散剂包：TBN 目标、选择标准

- 3 个专家问答对（置信度 0.88-0.94）

**访问 API**：

```bash
# 列出任务
curl http://localhost:3000/v1/tasks

# 获取特定任务
curl http://localhost:3000/v1/tasks/99999999-9999-9999-9999-999999999901

# 列出知识文档
curl http://localhost:3000/v1/knowledge/documents

# 执行知识库搜索
curl http://localhost:3000/v1/qa/search?q=PAO%20base%20oil
```

## 数据特点

### ✅ 生产级特性

- **幂等性**: 所有脚本使用 `ON CONFLICT DO NOTHING` 或 `WHERE NOT EXISTS`
- **可重复执行**: 安全重新运行多次，不会重复插入或覆盖现有数据
- **跟踪**: 所有记录包含 `trace_id`、`created_by`、时间戳
- **关系一致性**: 外键正确链接，无孤立记录

### 🔄 模拟工作流

- **Forward 验收**: 3 个 case，4 个指标，混合的相对误差
- **Inverse 验收**: 2 个请求，不同的策略（cost_priority vs quality_balance）
- **Stability 验收**: 5 次运行，检验确定性（应该有 >0.99 的相似性）
- **R&D 任务**: 从草稿 → 审批 → 进行中的完整生命周期

### 📊 前端 Workbench 友好

- 报告和聚合数据已准备好在 workbench 仪表板中显示
- 所有时间戳使用 ISO 8601 格式（UTC）
- JSON payload 结构一致，支持深度钻取

## 重置数据

如果要完全重新开始：

```bash
# 选项 1：使用 TypeScript 脚本
cd infra/db
npx ts-node seed.ts -- --reset

# 选项 2：手动重置
psql -d fluidmind -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
# 重新运行所有迁移
pnpm run migrate:latest
# 重新注入数据
./seed.sh
```

## 扩展数据

要添加更多场景或自定义数据：

1. **创建新的种子文件**: `infra/db/seeds/16_custom_scenario.sql`
2. **遵循现有模式**:
   ```sql
   INSERT INTO your_table (...) VALUES (...)
   ON CONFLICT DO NOTHING;
   ```
3. **添加到 `seed.sh`**:
   ```bash
   SEED_FILES=(
     ...
     "16_custom_scenario.sql"
   )
   ```
4. **运行**: `./seed.sh`

## 常见问题

**Q: 我可以在生产环境使用这些数据吗？**
A: 不建议。这些是演示数据。在生产环境中，应该使用真实数据迁移脚本。

**Q: 数据何时过期？**
A: 时间戳基于播种时间。对于演示，可以手动更新时间戳或使用相对日期。

**Q: 我可以修改已经播种的数据吗？**
A: 可以。数据是普通的 PostgreSQL 记录，可以通过 API 或直接 SQL 修改。

**Q: 如何在测试中使用播种？**
A: 查看 `infra/db/SEEDING.md` 中的"程序化播种"部分。

## 相关文档

- **详细指南**: [`infra/db/SEEDING.md`](./infra/db/SEEDING.md)
- **评估模块 README**: [`apps/backend/src/modules/evaluation/README.md`](./apps/backend/src/modules/evaluation/README.md)
- **数据库迁移**: [`infra/db/migrations/README.md`](./infra/db/migrations/README.md)

## 下一步

1. **启动后端**: `pnpm --filter @fluidmind/backend dev`
2. **连接前端**: 在 workbench 登录（例如 scientist001 / initial123）
3. **浏览数据**: 查看配方、任务、验收报告
4. **运行验收**: 尝试 POST `/evaluation/runs` 来执行模型验收

享受完整的平台演示！🚀
