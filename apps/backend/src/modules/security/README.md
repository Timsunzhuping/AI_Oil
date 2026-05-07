# Security / RBAC / Audit Module

`apps/backend/src/modules/security` — the canonical security surface for
the platform: authentication (password + SSO), role-based access control
(menu / action / data-scope), append-only audit log, export-approval
workflow with watermark policy, and the model asset registry.

```
HTTP                          Middleware                    Service / Repo / Audit
─────                         ──────────                    ────────────────────
POST   /security/login    ─┐                                 ┌─ users
POST   /security/logout   ─┤  authenticate ─▶ req.user ─┐    ├─ roles / permissions / role_permissions / user_roles
GET    /security/me       ─┘                            │    ├─ user_sessions
                                                         │    ├─ data_scope_grants
POST   /security/users/:id/roles      ─┐                 │    ├─ audit_logs (partitioned)
POST   /security/users/:id/data-scopes ─┼─▶ requirePermission(...) ──▶ SecurityService
DELETE /security/users/:id/data-scopes ─┘   requireRole(...)    │    ├─ export_logs
                                            requireDataScope(...) │    └─ model_asset_registry
GET    /security/audit                          │                  │
                                                 ▼                  ▼
POST   /security/exports                  Action handler      AuditRecorder
GET    /security/exports                                       (every mutation)
POST   /security/exports/:id/approve
POST   /security/exports/:id/download

POST   /security/assets
GET    /security/assets[/:id]
PATCH  /security/assets/:id
```

## Roles

Five canonical roles — seeded by migration 0022:

| Role          | Coverage                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `super_admin` | Everything. The only role that can grant `super_admin`. Bypasses every permission and data-scope check. |
| `model_admin` | ML datasets, training jobs, model release/rollback, asset registry, audit read, export approval.        |
| `researcher`  | Full R&D loop: formulas, predictions, recommendations, KB, docs, QA, exports.                           |
| `lims_user`   | LIMS task push/pull, read-only formulas, master data, KB.                                               |
| `viewer`      | Read-only dashboards, formulas, KB, QA.                                                                 |

The full permission catalogue is enumerated in
[`types.ts → PERMISSION_CODES`](./types.ts) and seeded by
[`infra/db/migrations/0022_security_extensions.sql`](../../../../infra/db/migrations/0022_security_extensions.sql).

## Three-tier authorisation

### 1. Menu-level (`menu-level auth`)

`GET /security/me` returns a `menu` array shaped for the workbench
sidebar; each entry has `required_permissions` and a computed `visible`
flag. The frontend hides entries marked `visible: false`.

### 2. Action-level (`action-level auth`)

Express middleware:

```ts
import {
  requirePermission, requireAnyPermission,
  requireRole, requireAnyRole,
} from '@/modules/security';

router.post('/predict/single', requirePermission('predict:execute'), …);
router.post('/ml/release',    requireAnyRole(['model_admin', 'super_admin']), …);
```

Service-layer helpers cover non-HTTP paths (background runners, RPC):

```ts
import { assertPermission, withPermission } from '@/modules/security';

await assertPermission(ctx, 'formula:write');
const release = withPermission('ml:release', async (ctx, …) => { … });
```

### 3. Data-scope (`data-scope auth`)

```ts
router.get('/formulas',
  requireDataScope({
    scope_type: 'product_category',
    extract: (req) => String(req.query.product_category ?? ''),
    strategy: 'allow_unrestricted', // 'deny_unrestricted' to lock by default
  }),
  …);
```

Per-user grants live in `data_scope_grants`. Wildcards (`scope_value='*'`)
are honoured. `super_admin` bypasses scope checks unconditionally. Use
`SecurityService.grantDataScope` / `revokeDataScope` to manage them.

## Authentication

`AuthRegistry` accepts:

- `password`: a `PasswordAuthAdapter` (default — uses
  `users.password_hash` + `users.metadata.password_salt` with sha256-salt;
  swap in argon2 / bcrypt by replacing `hashPassword` / `verify`).
- `providers`: a map of named SSO adapters
  (`'oidc:azure'`, `'saml:keycloak'`, `'oauth2:github'`, …). Each
  implements `AuthAdapter`.
- `defaultSso`: optional fallback when `provider` hint is absent.

The bundled `MockSsoAdapter` parses tokens shaped
`sso:<email>[:role1,role2,…]` — handy for local development and tests.
Replace with your real implementation:

```ts
import { buildSecurityModule } from '@/modules/security';
import { MyOidcAdapter } from './adapters/my-oidc.js';

buildSecurityModule(pool, logger, {
  auth: {
    password: undefined, // disables password login (SSO-only deployments)
    providers: {
      'oidc:azure': new MyOidcAdapter({ … }),
      'oidc:google': new MyOidcAdapter({ … }),
    },
    defaultSso: new MyOidcAdapter({ … }),
  },
});
```

The `authenticate` middleware reads `Authorization: Bearer <token>` (or
`x-fluidmind-token`) and resolves the active session into `req.user`
(`AuthContext`). It does NOT reject unauthenticated requests — that's
the job of `requirePermission` / `requireRole`.

## Audit scope

The `AuditRecorder` writes append-only rows to the partitioned
`audit_logs` table. Every audit row carries `trace_id`, `user_id`,
`impersonator_id`, `before_state`, `after_state`, `changes` (auto-diff),
and request-context fields.

Stable action labels (in `types.ts → AUDIT_ACTIONS`):

| Action label                                                              | Source                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------ |
| `login` / `logout` / `login_failed`                                       | `SecurityService.login` / `logout`                     |
| `demand_input`                                                            | task center submit handler                             |
| `formula_generation` / `formula_modification`                             | recommendation + formula service                       |
| `export_request` / `export_approve` / `export_reject` / `export_download` | this module                                            |
| `model_release` / `model_rollback`                                        | ML service                                             |
| `retrain`                                                                 | ML service `manualRetrain` / `fireAutoFinetuneTrigger` |
| `lims_task_create`                                                        | ERP service `createLimsTask`                           |
| `permission_change` / `data_scope_change`                                 | this module                                            |
| `asset_register` / `asset_update` / `asset_revoke`                        | this module                                            |

Any business module wires the recorder by importing it from the security
factory result and calling `audit.record(...)` after committing the
change. Audit-write failures NEVER bubble up — they are logged and the
business call returns successfully.

## Export approval + watermark

| Step                                  | What happens                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /security/exports`              | Creates an `export_logs` row. If `classification ≤ autoApproveBelowClassification` (default `internal`) the row is `auto_approved`; otherwise `pending`. `watermark_required` is `true` for `confidential` / `restricted` by default.                                                                                                      |
| `POST /security/exports/:id/approve`  | Requires `export:approve`. Sets `approval_status='approved'`/'rejected', stamps `output_url`, sets `output_expires_at` (default 24 h, configurable per request), and records `watermark_metadata` describing the policy. The actual rendering / watermarking is performed by a downstream exporter — this row is the security-side record. |
| `POST /security/exports/:id/download` | Requires `export:download`. Owner OR an approver can download. Refuses expired links. Increments `download_count` + writes `export_download` audit row.                                                                                                                                                                                    |

The watermark column is a placeholder for the downstream exporter — the
service captures `watermark_text`, `watermark_required`, and a JSON
`watermark_metadata` payload that the exporter applies when materialising
the bytes.

## Model asset registry

`model_asset_registry` is the **physical** asset store — distinct from
`ml_model_registry` which describes the **logical** model identity. Each
row carries:

- `asset_type`: `model_artifact` / `training_dataset` / `feature_store` /
  `prompt_template` / `tokenizer` / `embeddings` / `other`
- `classification` and per-asset `allowed_role_codes` for fine-grained gating
- `watermark_required` (mirrors export semantics)
- Provenance via `ml_model_version_id` / `ml_dataset_id`
- Audit-friendly `created_by` / `updated_by` / soft-delete

Endpoints:

```
POST   /security/assets         asset:manage
GET    /security/assets         asset:read
GET    /security/assets/:id     asset:read   (+ per-asset role gate)
PATCH  /security/assets/:id     asset:manage
```

## Database

| Table                                                                                   | Source migration | Notes                          |
| --------------------------------------------------------------------------------------- | ---------------- | ------------------------------ |
| `users` / `roles` / `permissions` / `role_permissions` / `user_roles` / `user_sessions` | 0002             | Identity + RBAC base.          |
| `audit_logs`                                                                            | 0003             | Partitioned by month.          |
| `export_logs`                                                                           | **0022**         | Approval + watermark workflow. |
| `model_asset_registry`                                                                  | **0022**         | Physical asset registry.       |
| `data_scope_grants`                                                                     | **0022**         | Per-user data-scope rules.     |

## Wiring

```ts
const security = buildSecurityModule(pool, logger, {
  auth: {
    password: new PasswordAuthAdapter({ lookup: repository }),
    providers: { 'oidc:azure': azureAdapter },
  },
  defaultWatermarkText: 'CONFIDENTIAL — FluidMind R&D',
  autoApproveBelowClassification: 'internal',
});

v1.use(security.authenticateMiddleware);   // populates req.user globally
v1.use('/security', security.router);

// Other modules can require permissions:
v1.post('/predict/single', requirePermission('predict:execute'), …);
```

The migration seeds the canonical roles + permissions; admins assign roles
via `POST /security/users/:id/roles`.

## Tests

```
tests/unit/security/
  guards.test.ts    permission / role / data-scope checks + decorators
  audit.test.ts     diff computation + DB-failure resilience
  auth.test.ts      Password / SSO adapters + AuthRegistry routing
  menu.test.ts      visibility resolution
  service.test.ts   login / logout / role assignment / audit / export workflow / asset registry / scope grants
  schemas.test.ts   Zod parsing for every endpoint body
  _fakes.ts         FakeSecurityRepository
```

74 / 74 pass.

```bash
pnpm --filter @fluidmind/backend test -- tests/unit/security
```

## Extension cookbook

| Need                                        | Where to plug                                                                                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Custom OIDC / SAML / OAuth2 / corporate JWT | implement `AuthAdapter`, register via `buildSecurityModule({ auth: { providers: { … } } })`                                                                 |
| Argon2 / bcrypt password hashing            | replace `hashPassword` / `verify` in `auth/password.ts`; record the new algo on `users.password_algo`                                                       |
| Per-row data filtering                      | wrap your list query so it AND-merges `req.user.data_scopes` matching the resource's scope_type                                                             |
| Export bytes + watermark rendering          | call `service.approveExport(id, { approve: true })` to mint the policy, then have your exporter read `output_url` + `watermark_metadata` to render the file |
| Tighter audit retention                     | drop old monthly partitions of `audit_logs`; new partitions are pre-created in migration 0003 (extend with pg_partman or a scheduled job)                   |
| Impersonation flow                          | the `authenticate` middleware honours `x-fluidmind-impersonate: <user_id>` already; gate the route with `requirePermission('user:manage')`                  |

## Environment variables

| Var                           | Default           | Purpose                                                      |
| ----------------------------- | ----------------- | ------------------------------------------------------------ |
| `SECURITY_SESSION_TTL_MS`     | `43200000` (12 h) | Override via `buildSecurityModule({ sessionTtlMs })`.        |
| `SECURITY_AUTO_APPROVE_BELOW` | `internal`        | `public` to require approval for everything internal-and-up. |
| `SECURITY_DEFAULT_WATERMARK`  | (none)            | Default text stamped on confidential exports.                |

(Wire these into `buildSecurityModule(...)` from `routes/v1/index.ts` if
production deployments need env-driven overrides.)
