# FluidMind - Product Formula Development AI Platform

Enterprise-grade product formula development platform with AI-powered insights and collaboration tools.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Development](#development)
- [Building & Testing](#building--testing)
- [Deployment](#deployment)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Formula Management**: Create, manage, and version product formulas
- **AI-Powered Analysis**: Get insights and recommendations powered by AI
- **Collaboration**: Real-time collaboration tools for team members
- **Version Control**: Track changes and maintain formula history
- **Testing Framework**: Integrate and manage product testing workflows
- **Performance Tracking**: Monitor formula performance metrics
- **API First**: REST API for extensibility and integration

## Tech Stack

### Frontend
- **React 18** - UI framework
- **Vite** - Build tool and dev server
- **TypeScript** - Type safety
- **Axios** - HTTP client

### Backend
- **Node.js** - Runtime
- **Express** - Web framework
- **TypeScript** - Type safety
- **PostgreSQL** - Primary database
- **Redis** - Cache and queue

### DevOps
- **Docker & Docker Compose** - Containerization
- **Kubernetes** - Orchestration (production)
- **GitHub Actions** - CI/CD pipeline
- **pnpm** - Monorepo package manager

### Code Quality
- **ESLint** - Linting
- **Prettier** - Code formatting
- **Husky** - Git hooks
- **lint-staged** - Pre-commit hooks

## Project Structure

```
fluidmind-monorepo/
├── apps/
│   ├── web/              # Frontend application
│   └── backend/          # Backend API server
├── packages/
│   ├── shared-types/     # TypeScript type definitions
│   ├── shared-utils/     # Utility functions
│   └── api-client/       # HTTP client
├── infra/
│   ├── docker/           # Docker configurations
│   ├── k8s/              # Kubernetes manifests
│   ├── db/               # Database scripts
│   └── scripts/          # Helper scripts
├── docs/
│   ├── architecture/     # Architecture docs
│   ├── api/              # API documentation
│   └── delivery/         # Deployment guides
└── .github/workflows/    # CI/CD pipelines
```

## Prerequisites

- **Node.js**: v20 or higher
- **pnpm**: v9.1.0 or higher
- **Docker**: v24 or higher (for containerized development)
- **PostgreSQL**: v16 or higher (or use Docker Compose)
- **Redis**: v7 or higher (or use Docker Compose)

### Installation

```bash
# Install Node.js and pnpm
curl -fsSL https://get.pnpm.io/install.sh | sh -

# Verify installation
node --version
pnpm --version
```

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/timsunzhuping/ai_oil.git
cd ai_oil
```

### 2. Setup Environment

```bash
# Copy environment template
cp .env.example .env

# Edit configuration as needed
# nano .env
```

### 3. Install Dependencies

```bash
pnpm install
```

### 4. Start Services

**Using Docker Compose (Recommended):**

```bash
docker-compose up
```

**Or using pnpm directly:**

```bash
pnpm dev
```

### 5. Access the Application

- **Frontend**: http://localhost:3000
- **Backend**: http://localhost:3001
- **API Health**: http://localhost:3001/health

## Development

### Project Commands

```bash
# Install all dependencies
pnpm install

# Start development mode
pnpm dev

# Build all packages
pnpm build

# Run tests
pnpm test

# Run linter
pnpm lint

# Format code
pnpm format

# Type checking
pnpm type-check

# Clean build artifacts
pnpm clean
```

### Development Workflow

1. **Create a branch**: `git checkout -b feature/your-feature`
2. **Make changes**: Edit files in your editor
3. **Test changes**: Run relevant tests
4. **Lint and format**: `pnpm lint && pnpm format`
5. **Commit**: Changes are automatically linted via Husky
6. **Push and create PR**: Follow the contribution guidelines

### Working with Packages

Each package can be developed independently:

```bash
# Run dev in specific workspace
pnpm -F web dev
pnpm -F backend dev
pnpm -F @fluidmind/shared-types build
```

### Database Setup

```bash
# Using Docker Compose
docker-compose up postgres

# Run migrations
docker exec fluidmind-postgres psql -U fluidmind -d fluidmind_dev -f infra/db/init.sql
```

## Building & Testing

### Build

```bash
pnpm build
```

This will:
1. Compile all TypeScript packages
2. Build frontend bundles
3. Generate type declarations

### Testing

```bash
pnpm test
```

### Pre-commit Checks

Husky automatically runs checks before commits:
- ESLint (code quality)
- Prettier (formatting)
- Type checking

To bypass (use with caution):

```bash
git commit --no-verify
```

## Deployment

### Docker Compose

```bash
# Build images
docker-compose build

# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Kubernetes

See [Deployment Guide](./docs/delivery/DEPLOYMENT.md) for detailed Kubernetes deployment instructions.

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Database
DATABASE_URL=postgresql://...

# Redis
REDIS_URL=redis://...

# API Configuration
VITE_API_URL=https://api.example.com

# Secrets (never commit to git!)
JWT_SECRET=your-secret-key
```

## Documentation

- **[Architecture Overview](./docs/architecture/OVERVIEW.md)** - System design and architecture
- **[API Endpoints](./docs/api/ENDPOINTS.md)** - REST API documentation
- **[Deployment Guide](./docs/delivery/DEPLOYMENT.md)** - Production deployment

## Directory Reference

### apps/web
Frontend React application with Vite

### apps/backend
Express.js REST API server

### packages/shared-types
Shared TypeScript interfaces and types

### packages/shared-utils
Shared utility functions and helpers

### packages/api-client
HTTP client for API communication

### infra/docker
Docker configurations for all services

### infra/k8s
Kubernetes deployment manifests

### infra/db
Database initialization and migration scripts

### infra/scripts
Helper scripts for setup and deployment

## Engineering Standards

### Code Quality

- **No console logs** (except warn/error)
- **Type safety**: Use TypeScript strictly
- **Testing**: Write tests for new features
- **Documentation**: Document public APIs

### Git Workflow

- Branch naming: `feature/name`, `fix/name`, `docs/name`
- Commit messages: Clear, descriptive, present tense
- PR reviews required before merge
- Keep commits atomic and logical

### Performance

- Optimize bundle sizes
- Implement lazy loading
- Use efficient data structures
- Monitor API response times

## Troubleshooting

### Port Conflicts

```bash
# Find process using port 3000
lsof -i :3000
kill -9 <PID>
```

### Database Connection Issues

```bash
# Test connection
psql -h localhost -U fluidmind -d fluidmind_dev -c "SELECT 1"
```

### Clear Cache and Dependencies

```bash
pnpm clean
rm -rf node_modules
pnpm install
```

## Roadmap

- [ ] User authentication and authorization
- [ ] Advanced formula versioning
- [ ] Real-time collaboration features
- [ ] Mobile app
- [ ] Advanced analytics dashboard
- [ ] AI-powered insights
- [ ] Integration marketplace
- [ ] Multi-tenant support

## License

MIT License - See LICENSE file for details

---

**Made with ❤️ by the FluidMind Team**
