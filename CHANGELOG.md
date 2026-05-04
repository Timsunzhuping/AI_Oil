# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial monorepo scaffold (apps/web, apps/backend, services/ai-service, shared packages)
- Turborepo task orchestration with remote-cache-ready configuration
- Prisma schema for formula research domain (Project, Formula, Ingredient, Experiment, Conversation)
- Backend hardening: pino structured logging, helmet, rate limit, zod env validation, request ID, graceful shutdown, OpenAPI/Swagger UI
- Frontend essentials: React Router, TanStack Query, ErrorBoundary, typed env access
- AI service skeleton with provider-agnostic LLM interface (OpenAI/Anthropic/local stubs)
- Vitest test infrastructure with sample tests for backend and web
- Husky `pre-commit` (lint-staged) and `commit-msg` (commitlint) hooks
- GitHub Actions: CI matrix, CodeQL, Dependabot, release workflow, PR/issue templates
- K8s manifests: namespace, configmap, secret template, web/backend/postgres/redis deployments, ingress, HPA
- ADRs and operational runbook
