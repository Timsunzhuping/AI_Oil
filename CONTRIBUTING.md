# Contributing to FluidMind

Thanks for your interest in contributing! This document outlines the workflow, conventions, and quality bars expected for changes to this repository.

## Quick Start

```bash
nvm use                  # uses .nvmrc (Node 20)
corepack enable
pnpm install
cp .env.example .env
pnpm -w build            # build all workspace packages
pnpm dev                 # start dev servers via Turborepo
```

## Branching Model

- `main` — protected; release-ready, deployed to production via tag
- `develop` — integration branch (optional; small teams may work directly off `main`)
- `feature/<scope>-<short-desc>` — net-new functionality
- `fix/<scope>-<short-desc>` — bug fixes
- `chore/<short-desc>` — build/tooling/infra changes
- `docs/<short-desc>` — documentation only

## Conventional Commits

All commits MUST follow [Conventional Commits 1.0](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

Allowed types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `revert`.

`commit-msg` hook (commitlint) blocks non-conforming messages.

Examples:
- `feat(backend): add formula optimization endpoint`
- `fix(web): handle 401 in axios interceptor`
- `chore(infra): bump postgres image to 16.2`

## Pull Request Checklist

Before requesting review:

- [ ] `pnpm lint` clean
- [ ] `pnpm type-check` clean
- [ ] `pnpm test` passes (added tests for new behavior)
- [ ] `pnpm build` succeeds
- [ ] Updated docs under `docs/` when public behavior changes
- [ ] Added/updated an ADR if the change is architectural
- [ ] No secrets, tokens, or large binaries committed
- [ ] PR description includes: motivation, approach, screenshots (for UI), and rollout/rollback plan

## Code Review

- At least one approval required from a CODEOWNER
- Reviewers focus on: correctness, testing, security, observability, public API stability
- Authors squash-merge unless commits represent a meaningful logical history

## Quality Gates

| Gate | Tool | Where |
|------|------|-------|
| Format | Prettier | `pre-commit` + CI |
| Lint | ESLint | `pre-commit` + CI |
| Type | tsc `--noEmit` | CI |
| Unit/integration tests | Vitest | CI |
| Container build | Docker Buildx | CI |
| Dependency audit | `pnpm audit` + Dependabot | CI + scheduled |
| Static security | CodeQL | CI |
| Secret scanning | gitleaks (configurable) | CI |

## Architecture Decisions

Material decisions (data models, framework choices, deployment topology, security boundaries) should be captured as ADRs in `docs/architecture/adr/`. Use the template at `docs/architecture/adr/0000-template.md`.

## Reporting Security Issues

Do **not** open a public issue. See [SECURITY.md](./SECURITY.md).

## Local Conveniences

```bash
pnpm -F @fluidmind/backend dev          # run only backend
pnpm -F @fluidmind/web dev              # run only web
pnpm -F @fluidmind/backend test         # test single package
pnpm --filter "...@fluidmind/web" build # build web and its deps
turbo run build --filter=...[origin/main] # build only changed since main
```
