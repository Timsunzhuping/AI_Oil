# Security Policy

## Supported Versions

Until 1.0, only the `main` branch receives security fixes.

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub issues, discussions, or pull requests.

Instead, email **security@fluidmind.local** (replace with the actual address before public release) with:

1. A description of the issue and its potential impact
2. Steps to reproduce (PoC if available)
3. Affected versions / commits
4. Your contact for follow-up and credit (if desired)

We aim to:

- Acknowledge within **48 hours**
- Provide an initial assessment within **5 business days**
- Coordinate a fix and disclosure timeline (typically ≤ 90 days)

## Scope

In scope:

- Code in this repository (apps, services, packages)
- Container images we publish
- Default infrastructure manifests under `infra/`

Out of scope:

- Third-party services we integrate with (report to the respective vendor)
- Issues requiring physical access or social engineering
- DoS that requires unreasonable resources

## Hardening Defaults

The platform ships with the following defenses by default:

- HTTP security headers via `helmet`
- Rate limiting on the public API
- Input validation via `zod` at all REST boundaries
- Parameterized DB access via Prisma
- Structured request logs with correlation IDs (no PII by default)
- Secrets sourced from environment / external secret store, never committed

See `docs/architecture/SECURITY.md` for the threat model.
