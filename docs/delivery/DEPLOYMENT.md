# Deployment Guide

## Prerequisites

- Docker and Docker Compose installed
- Node.js 20+ installed
- pnpm package manager installed
- Kubernetes cluster (optional, for production)

## Local Development Setup

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd fluidmind-monorepo
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your local configuration
```

### 3. Start Services

**Option A: Using Docker Compose (Recommended)**
```bash
docker-compose up
```

**Option B: Using pnpm (Direct)**
```bash
pnpm dev
```

### 4. Verify Services

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- Health Check: http://localhost:3001/health

## Docker Compose Deployment

### Build Images

```bash
docker-compose build
```

### Start All Services

```bash
docker-compose up -d
```

### View Logs

```bash
docker-compose logs -f backend
docker-compose logs -f web
```

### Stop Services

```bash
docker-compose down
```

### Clean Up (Remove Volumes)

```bash
docker-compose down -v
```

## Kubernetes Deployment

### Prerequisites

- Kubernetes cluster running
- kubectl configured
- Docker images built and pushed to registry

### 1. Create Namespace

```bash
kubectl create namespace fluidmind
```

### 2. Deploy Backend

```bash
kubectl apply -f infra/k8s/backend-deployment.yaml -n fluidmind
```

### 3. Verify Deployment

```bash
kubectl get pods -n fluidmind
kubectl logs -n fluidmind deployment/fluidmind-backend
```

### 4. Access Services

```bash
kubectl port-forward -n fluidmind svc/fluidmind-backend 3001:3001
```

## Environment Variables

### Backend Environment Variables

```
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://user:password@host:5432/dbname
REDIS_URL=redis://localhost:6379
LOG_LEVEL=info
```

### Web Environment Variables

```
VITE_API_URL=https://api.fluidmind.example.com
```

## Database Migrations

### Initialize Database

```bash
docker exec fluidmind-postgres psql -U fluidmind -d fluidmind_dev -f /infra/db/init.sql
```

### Run Migrations

```bash
# Migrations will be added as the project grows
cd apps/backend
pnpm migrate
```

## Production Deployment Checklist

- [ ] Configure production environment variables
- [ ] Set up SSL/TLS certificates
- [ ] Configure database backups
- [ ] Set up monitoring and logging
- [ ] Configure auto-scaling policies
- [ ] Run security scans
- [ ] Load test the application
- [ ] Set up CI/CD pipeline
- [ ] Document runbook for operations team
- [ ] Plan rollback strategy

## Monitoring and Logging

### Health Checks

The backend provides health check endpoints:

```bash
curl http://localhost:3001/health
```

### Logs

Logs are printed to stdout. Use container orchestration tools to aggregate logs.

## Troubleshooting

### Port Already in Use

```bash
# Find and kill process using port
lsof -i :3001
kill -9 <PID>
```

### Database Connection Failed

```bash
# Check database service
docker-compose ps postgres

# Test connection
psql -h localhost -U fluidmind -d fluidmind_dev -c "SELECT 1"
```

### Service Not Responding

```bash
# Check logs
docker-compose logs backend

# Restart service
docker-compose restart backend
```

## Scaling Strategies

### Horizontal Scaling (Backend)

Update docker-compose or Kubernetes replicas:

```yaml
# In docker-compose.yml or K8s deployment
replicas: 3  # Scale to 3 instances
```

### Database Scaling

- Use read replicas for read-heavy workloads
- Implement connection pooling
- Use caching layer (Redis)

### Frontend Optimization

- Enable CDN for static assets
- Implement lazy loading
- Optimize bundle size

## Backup and Recovery

### Database Backup

```bash
docker exec fluidmind-postgres pg_dump -U fluidmind -d fluidmind_dev > backup.sql
```

### Restore from Backup

```bash
docker exec -i fluidmind-postgres psql -U fluidmind -d fluidmind_dev < backup.sql
```

## Security Considerations

- [ ] Keep dependencies updated
- [ ] Use secrets management for sensitive data
- [ ] Enable HTTPS in production
- [ ] Implement rate limiting
- [ ] Set up Web Application Firewall (WAF)
- [ ] Regular security audits and penetration testing
- [ ] Enable database encryption at rest
- [ ] Implement audit logging
