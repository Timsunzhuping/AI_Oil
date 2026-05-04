# FluidMind 项目完整结构

## 目录树

```
fluidmind-monorepo/
├── .github/
│   └── workflows/
│       └── ci.yml                 # GitHub Actions CI/CD 流程
│
├── .claude/
│   └── settings.json              # Claude Code 项目设置
│
├── apps/                          # 应用程序
│   ├── web/                       # 前端应用 (React + Vite)
│   │   ├── src/
│   │   │   ├── components/        # React 组件
│   │   │   ├── pages/             # 页面组件
│   │   │   ├── hooks/             # 自定义 hooks
│   │   │   ├── styles/            # 全局样式
│   │   │   ├── utils/             # 工具函数
│   │   │   ├── App.tsx            # 根组件
│   │   │   ├── App.css            # 应用样式
│   │   │   ├── main.tsx           # 应用入口
│   │   │   └── index.css          # 全局样式
│   │   ├── public/                # 静态资源
│   │   ├── tests/                 # 测试文件
│   │   ├── index.html             # HTML 模板
│   │   ├── package.json           # 依赖配置
│   │   ├── tsconfig.json          # TypeScript 配置
│   │   └── vite.config.ts         # Vite 构建配置
│   │
│   └── backend/                   # 后端应用 (Express)
│       ├── src/
│       │   ├── controllers/       # 请求处理器
│       │   │   └── healthController.ts
│       │   ├── routes/            # 路由定义
│       │   │   └── index.ts
│       │   ├── middleware/        # 中间件
│       │   │   └── errorHandler.ts
│       │   ├── services/          # 业务逻辑服务
│       │   ├── models/            # 数据模型
│       │   ├── config/            # 配置文件
│       │   ├── utils/             # 工具函数
│       │   └── index.ts           # 应用入口
│       ├── tests/                 # 测试文件
│       ├── package.json           # 依赖配置
│       └── tsconfig.json          # TypeScript 配置
│
├── packages/                      # 共享包
│   ├── shared-types/              # 共享类型定义
│   │   ├── src/
│   │   │   └── index.ts           # API 响应类型、用户、产品等
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── shared-utils/              # 共享工具函数
│   │   ├── src/
│   │   │   └── index.ts           # 时间、ID 生成、API 错误等
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── api-client/                # HTTP 客户端
│       ├── src/
│       │   └── index.ts           # Axios 包装器和请求工具
│       ├── package.json
│       └── tsconfig.json
│
├── infra/                         # 基础设施
│   ├── docker/                    # Docker 配置
│   │   ├── backend.Dockerfile     # 后端容器
│   │   └── web.Dockerfile         # 前端容器
│   │
│   ├── k8s/                       # Kubernetes 配置
│   │   └── backend-deployment.yaml # 后端部署配置
│   │
│   ├── db/                        # 数据库相关
│   │   └── init.sql               # 数据库初始化脚本
│   │
│   └── scripts/                   # 辅助脚本
│       └── setup.sh               # 项目初始化脚本
│
├── docs/                          # 文档
│   ├── architecture/              # 架构文档
│   │   └── OVERVIEW.md            # 系统设计、架构图、技术栈
│   │
│   ├── api/                       # API 文档
│   │   └── ENDPOINTS.md           # REST API 端点文档
│   │
│   └── delivery/                  # 交付和部署文档
│       └── DEPLOYMENT.md          # 本地、Docker、K8s 部署指南
│
├── 根级配置文件
│   ├── package.json               # monorepo 根配置、脚本
│   ├── pnpm-workspace.yaml        # pnpm 工作区配置
│   ├── tsconfig.json              # 全局 TypeScript 配置
│   ├── .eslintrc.json             # ESLint 规则配置
│   ├── .prettierrc.json           # Prettier 格式化配置
│   ├── .gitignore                 # Git 忽略文件
│   ├── .env.example               # 环境变量模板
│   ├── docker-compose.yml         # Docker Compose 配置
│   ├── README.md                  # 项目说明文档
│   ├── ENGINEERING_STANDARDS.md   # 工程规范文档
│   └── PROJECT_STRUCTURE.md       # 本文件
```

## 主要文件说明

### 配置文件

| 文件 | 用途 |
|------|------|
| `package.json` | Monorepo 根配置，定义工作区和全局脚本 |
| `pnpm-workspace.yaml` | pnpm 工作区定义，声明所有包位置 |
| `tsconfig.json` | 全局 TypeScript 配置，所有包继承此配置 |
| `.eslintrc.json` | ESLint 代码检查规则 |
| `.prettierrc.json` | Prettier 代码格式化配置 |
| `.gitignore` | Git 忽略规则 |
| `.env.example` | 环境变量示例，需复制为 `.env` |

### 应用配置

#### 前端 (apps/web/)

| 文件 | 用途 |
|------|------|
| `package.json` | 前端依赖配置 |
| `tsconfig.json` | 前端 TypeScript 配置（继承根配置）|
| `vite.config.ts` | Vite 构建和开发服务器配置 |
| `index.html` | HTML 模板 |
| `src/main.tsx` | React 应用入口 |
| `src/App.tsx` | 根组件 |

#### 后端 (apps/backend/)

| 文件 | 用途 |
|------|------|
| `package.json` | 后端依赖配置 |
| `tsconfig.json` | 后端 TypeScript 配置 |
| `src/index.ts` | Express 应用入口 |
| `src/routes/index.ts` | 路由配置 |
| `src/controllers/` | 请求处理函数 |
| `src/middleware/` | 中间件（错误处理、认证等）|

### 文档文件

| 文件 | 内容 |
|------|------|
| `README.md` | 项目概述、快速开始、开发指南 |
| `ENGINEERING_STANDARDS.md` | 代码规范、最佳实践、工程标准 |
| `docs/architecture/OVERVIEW.md` | 系统架构、设计决策、技术栈 |
| `docs/api/ENDPOINTS.md` | API 端点文档、请求响应格式 |
| `docs/delivery/DEPLOYMENT.md` | 部署指南、运维说明 |

## 关键特性

### 1. 完整的 Monorepo 结构
- **pnpm workspaces** 管理多个包
- 共享依赖，减少重复安装
- 共享代码通过内部 npm 包实现

### 2. 前后端分离
- **前端**: React 18 + Vite（快速开发体验）
- **后端**: Express + Node.js（轻量级 API 服务）
- 独立部署和扩展

### 3. 共享包系统
- `@fluidmind/shared-types` - TypeScript 类型定义
- `@fluidmind/shared-utils` - 公共工具函数
- `@fluidmind/api-client` - HTTP 客户端

### 4. 完整的工程体系
- **ESLint + Prettier** - 代码质量和格式化
- **Husky + lint-staged** - 提交前检查
- **TypeScript 严格模式** - 类型安全
- **GitHub Actions** - 自动化 CI/CD

### 5. 容器化和编排
- **Docker Compose** - 本地开发环境
- **Kubernetes** - 生产环境部署
- 多服务编排（PostgreSQL、Redis）

### 6. 完整文档
- 架构设计文档
- API 文档
- 部署运维指南
- 工程规范文档

## 工作流程

### 本地开发

```bash
# 1. 克隆并安装
git clone <repo>
cd fluidmind-monorepo
pnpm install

# 2. 配置环境
cp .env.example .env

# 3. 启动开发服务
pnpm dev          # 或使用 Docker Compose
docker-compose up

# 4. 访问应用
# 前端: http://localhost:3000
# 后端: http://localhost:3001
```

### 代码组织原则

1. **功能按功能分组** - 同一功能的代码放在一起
2. **清晰的依赖关系** - 上层依赖下层，避免循环依赖
3. **类型安全** - 充分利用 TypeScript
4. **代码复用** - 通过共享包提高代码复用

### 包与应用的关系

```
apps/web ─┐
          ├─→ @fluidmind/shared-types
          ├─→ @fluidmind/shared-utils
          └─→ @fluidmind/api-client

apps/backend ─┐
              ├─→ @fluidmind/shared-types
              └─→ @fluidmind/shared-utils

@fluidmind/api-client ─┐
                       ├─→ @fluidmind/shared-types
                       └─→ @fluidmind/shared-utils
```

## 可扩展性设计

### 微服务就绪
- 后端可以拆分为多个独立服务
- 共享包保证类型一致性
- API 客户端支持多个服务端点

### 功能扩展
- `apps/` 可添加新的应用（移动端、管理后台等）
- `packages/` 可添加新的共享包
- `infra/` 支持更多基础设施配置

### 示例：添加管理后台

```bash
# 创建新应用
mkdir -p apps/admin

# 共享同样的依赖和工具
# 继承 tsconfig, eslint 配置
```

## 部署拓扑

```
┌─────────────────────────────────────────┐
│          CDN (静态资源)                  │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│          API Gateway / Nginx             │
│      (反向代理、负载均衡)                 │
└─────────────────┬───────────────────────┘
        ┌─────────┴──────────┐
        │                    │
┌───────▼────────┐  ┌────────▼────────┐
│  Frontend Pod  │  │  Backend Pod(s) │
│   (React/Web)  │  │   (Express)     │
└────────────────┘  └────────┬────────┘
                              │
                ┌─────────────┼─────────────┐
                │             │             │
        ┌───────▼───┐  ┌──────▼─────┐  ┌──▼──────┐
        │ PostgreSQL│  │   Redis    │  │  其他   │
        │ (主DB)    │  │  (缓存)     │  │  服务   │
        └───────────┘  └────────────┘  └─────────┘
```

## 开发最佳实践

1. **分支管理**: `feature/`, `fix/`, `docs/` 前缀
2. **提交信息**: 遵循 Conventional Commits
3. **代码审查**: 至少一个审核者批准
4. **测试覆盖**: 新功能需配套测试
5. **文档更新**: API 变更需更新文档

## 下一步

1. **运行 `pnpm install`** - 安装所有依赖
2. **阅读 README.md** - 了解快速开始
3. **查看 ENGINEERING_STANDARDS.md** - 学习工程规范
4. **浏览 docs/** - 查看完整文档

---

**创建时间**: 2024-01-01  
**版本**: 0.0.1  
**状态**: 初始化完成，就绪开发
