# FluidMind Architecture Overview

## System Design

FluidMind is a monorepo-based Product Formula Development AI Platform designed for enterprise-grade, long-term evolution.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Client Applications                      │
│  ┌──────────────┐          ┌─────────────────────────────┐  │
│  │   Web App    │          │  Mobile Apps (Future)       │  │
│  │ (React/Vite)│          │                             │  │
│  └──────────────┘          └─────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP/REST
┌────────────────────────▼────────────────────────────────────┐
│                  API Gateway / Reverse Proxy               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Rate Limiting, Auth, Request Validation, Logging    │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│              Backend Services (Node.js/Express)            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  API Routes  │  │ Controllers  │  │  Services    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Middleware  │  │   Models     │  │   Utils      │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────┬──────────────────────────────────────────────────┬───┘
      │                                                  │
┌─────▼──────────────┐                    ┌─────────────▼──┐
│   PostgreSQL       │                    │    Redis      │
│  (Data Storage)    │                    │  (Cache/Queue)│
└────────────────────┘                    └───────────────┘
```

## Directory Structure

```
fluidmind-monorepo/
├── apps/
│   ├── web/                 # Frontend application (React/Vite)
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── pages/
│   │   │   ├── hooks/
│   │   │   ├── styles/
│   │   │   └── utils/
│   │   └── public/
│   └── backend/             # Backend API server (Express)
│       ├── src/
│       │   ├── routes/
│       │   ├── controllers/
│       │   ├── services/
│       │   ├── models/
│       │   ├── middleware/
│       │   └── config/
│       └── tests/
├── packages/
│   ├── shared-types/        # TypeScript type definitions
│   ├── shared-utils/        # Utility functions and helpers
│   └── api-client/          # HTTP client for API communication
├── infra/
│   ├── docker/              # Docker configurations
│   ├── k8s/                 # Kubernetes manifests
│   ├── db/                  # Database initialization scripts
│   └── scripts/             # Infrastructure helper scripts
├── docs/
│   ├── architecture/        # Architecture documentation
│   ├── api/                 # API documentation
│   └── delivery/            # Deployment guides
└── .github/
    └── workflows/           # CI/CD pipelines (GitHub Actions)
```

## Core Technologies

- **Frontend**: React 18, Vite, TypeScript
- **Backend**: Node.js, Express, TypeScript
- **Database**: PostgreSQL
- **Cache**: Redis
- **Containerization**: Docker, Docker Compose
- **Orchestration**: Kubernetes (future support)
- **Package Manager**: pnpm (workspaces)
- **Code Quality**: ESLint, Prettier, Husky

## Key Design Decisions

1. **Monorepo Structure**: Using pnpm workspaces for better dependency management and code sharing.
2. **Shared Packages**: Common types, utilities, and API clients in separate packages for reusability.
3. **Service Separation**: Backend and frontend are separate applications for independent scaling.
4. **Container Ready**: Docker Compose for local development, Kubernetes manifests for production.
5. **Type Safety**: Full TypeScript coverage across all packages.
6. **Code Quality**: Integrated linting, formatting, and pre-commit hooks.

## Scalability Considerations

### Horizontal Scaling
- Backend services can be replicated and load-balanced
- Stateless design for horizontal scaling
- Redis for distributed caching

### Microservices Ready
- Service-oriented architecture with clear boundaries
- Can be split into separate services as needed
- Shared types and utilities for inter-service communication

### Database Scaling
- PostgreSQL with replication support
- Connection pooling for efficient resource usage
- Migration system for schema evolution

## Development Workflow

1. **Setup**: `pnpm install` to install all dependencies
2. **Development**: `pnpm dev` to start all services in development mode
3. **Building**: `pnpm build` to build all packages
4. **Testing**: `pnpm test` to run tests
5. **Linting**: `pnpm lint` to check code quality
6. **Docker**: `docker-compose up` for containerized development

## Deployment Strategy

See [deployment guide](../delivery/DEPLOYMENT.md) for detailed deployment instructions.
