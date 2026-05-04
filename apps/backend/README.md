# @fluidmind/backend

The FluidMind backend API service. Express + TypeScript on Node 20.

## What's in here

| Concern | Where | Notes |
|---|---|---|
| Layered env config | `src/config/env.ts` + `.env.{local,test,prod}` | Zod-validated, fail-fast |
| Structured logging | `src/config/logger.ts` | Pino, trace_id auto-injected |
| Request context | `src/lib/context.ts` | `AsyncLocalStorage`-based |
| Trace ID middleware | `src/middleware/requestId.ts` | `x-trace-id` / `x-request-id` / `traceparent` |
| Unified response | `src/lib/response.ts` | `success`, `paginated`, `failure` |
| Error hierarchy | `src/lib/errors.ts` | `AppError` + typed subclasses |
| Validation | `src/middleware/validate.ts` | Zod for body/query/params/headers |
| Global exception handler | `src/middleware/errorHandler.ts` | One shape for every error |
| Security | `src/middleware/security.ts` | Helmet + rate limit |
| Health | `src/controllers/healthController.ts` | Liveness + readiness |
| OpenAPI 3.1 | `src/lib/openapi.ts` + `/api/docs` (Swagger UI) | |
| App factory | `src/app.ts` | Pure factory, decouples from `listen()` for tests |
| Bootstrap | `src/index.ts` | Wires app + graceful shutdown + crash handlers |

## Layered env configuration

The loader reads files in this order, with later files **overriding** earlier ones:

```
.env                       # base defaults shared across environments
.env.{NODE_ENV}            # environment-specific (local | test | prod)
.env.{NODE_ENV}.local      # personal/secret overrides (gitignored)
```

`NODE_ENV` selects the layer. If unset, it defaults to `local`.

```bash
NODE_ENV=local pnpm dev    # uses .env.local + .env.local.local
NODE_ENV=test  pnpm test   # uses .env.test
NODE_ENV=prod  pnpm start  # uses .env.prod (k8s/Vault preferred in real prod)
```

Schema is in `src/config/env.ts`. Add a key there before referencing it anywhere in the app — invalid configs fail-fast at boot:

```
❌ Invalid environment configuration:
{
  "DATABASE_URL": ["Invalid url"]
}
```

## Unified response envelope

**Every** endpoint — including errors — returns this shape:

```json
{
  "code": 0,
  "message": "success",
  "data": { "id": "fmla_01" },
  "traceId": "9c1e6f0a-1c1f-4a6f-b1b1-9d8e2f4d3a2b",
  "timestamp": "2026-05-04T07:30:00.123Z"
}
```

Errors:

```json
{
  "code": 40002,
  "message": "Validation failed",
  "errors": [
    { "field": "body.email", "message": "Invalid email", "code": "invalid_string" }
  ],
  "traceId": "...",
  "timestamp": "..."
}
```

### Error code map

| HTTP | Code   | Class                | When |
|------|--------|----------------------|------|
| 400  | 40001  | `BadRequestError`    | Generic 400 |
| 400  | 40002  | `ValidationError`    | Zod validation failed |
| 401  | 40100  | `UnauthorizedError`  | No / invalid auth |
| 403  | 40300  | `ForbiddenError`     | Authenticated but not allowed |
| 404  | 40400  | `NotFoundError`      | Resource not found |
| 409  | 40900  | `ConflictError`      | Duplicate / state conflict |
| 429  | 42900  | `RateLimitError`     | Rate limit exceeded |
| 500  | 50000  | (generic)            | Unhandled error |
| 503  | 50300  | `UpstreamError`      | Downstream unavailable |

In handlers/services, **throw a typed error** — never craft response shapes by hand:

```ts
import { NotFoundError, ValidationError } from '../lib/errors.js';

if (!formula) throw new NotFoundError('Formula');
```

## Trace IDs end-to-end

`requestIdMiddleware` runs first. It:

1. Reads `x-trace-id`, `x-request-id`, or W3C `traceparent` from the request — or mints a UUID v4
2. Echoes the value back in the `x-trace-id` response header
3. Stores it in `AsyncLocalStorage` for the rest of the request

Every Pino log line in the request lifecycle is automatically tagged via the logger's `mixin` hook:

```json
{"level":30,"time":"...","traceId":"abc","msg":"GET /api/v1/health → 200"}
```

Throw an error from anywhere — the global handler picks the trace_id from context and includes it in the response. Clients can correlate any failure with server logs in one query.

To call a downstream service while preserving the trace:

```ts
import { getTraceId } from '../lib/context.js';

await fetch(url, { headers: { 'x-trace-id': getTraceId() ?? '' } });
```

## Request validation

```ts
import { z } from 'zod';
import { validate } from '../middleware/validate.js';

const createFormula = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

router.post(
  '/formulas',
  validate({
    body: createFormula,
    query: z.object({ dryRun: z.coerce.boolean().default(false) }),
  }),
  async (req, res) => {
    // req.body and req.query are now strongly typed and validated
  }
);
```

The middleware accumulates errors across `body`/`query`/`params`/`headers` and forwards a single `ValidationError` — clients see all problems at once.

## Endpoints

| Path | Description |
|------|-------------|
| `GET  /health` | Liveness — minimal, used by k8s |
| `GET  /api` | Service banner |
| `GET  /api/v1` | V1 surface listing |
| `GET  /api/v1/health` | Readiness with dependency checks |
| `GET  /api/v1/health/live` | Alias for liveness |
| `GET  /api/v1/health/ready` | Alias for readiness |
| `GET  /api/docs` | Swagger UI (when `ENABLE_SWAGGER=true`) |
| `GET  /api/openapi.json` | Raw OpenAPI 3.1 spec |

## Local development

```bash
# from monorepo root
pnpm install

# in this directory
cp .env.local .env.local.local  # optional: personal overrides (gitignored)
pnpm dev                        # tsx watch on src/index.ts
```

The server prints its URL and Swagger location on boot:

```
🚀 fluidmind-backend listening on port 3001
{ port: 3001, env: 'local', apiPrefix: '/api', swagger: 'http://localhost:3001/api/docs' }
```

## Testing

```bash
pnpm test              # one-shot, with coverage thresholds (70%)
pnpm test:watch        # watch mode
pnpm test:coverage     # explicit coverage report (lcov + html)
```

Test layout:

```
tests/
├── setup.ts                      # global setup, forces NODE_ENV=test
├── unit/
│   ├── response.test.ts          # success/paginated/failure helpers
│   ├── errors.test.ts            # AppError hierarchy
│   ├── context.test.ts           # AsyncLocalStorage isolation
│   ├── validate.test.ts          # zod middleware
│   └── env.test.ts               # layered env loading
└── integration/
    ├── health.test.ts            # supertest GET /health, /api/v1/health, openapi
    └── errorHandler.test.ts      # full error pipeline (Zod, AppError, 404, async)
```

Vitest config: `vitest.config.ts`. Coverage thresholds are enforced; raise them as you add coverage rather than disabling checks.

## Production build

```bash
pnpm build           # tsc → dist/
NODE_ENV=prod pnpm start
```

The build emits ESM with `.d.ts`. Container image is at `infra/docker/backend.Dockerfile`.

## Adding a new feature module

1. **Routes** — `src/routes/v1/<feature>.ts` with `Router()` and handlers
2. **Controllers** — thin glue between Express and services
3. **Services** — domain logic, throws typed errors from `lib/errors.ts`
4. **Schemas** — colocated zod schemas; reuse via `validate({ body: <schema> })`
5. **Mount** — register the router in `src/routes/v1/index.ts`
6. **OpenAPI** — add the path entry in `src/lib/openapi.ts`
7. **Tests** — unit for the service, integration via supertest

The unified envelope, trace_id, validation, and error handling are already wired — feature code should not have to think about them.

## Operational notes

- **Graceful shutdown** — `SIGTERM` / `SIGINT` triggers `server.close()` with a 30 s deadline; bumps to `process.exit(1)` if connections refuse to drain.
- **Crash handlers** — `uncaughtException` and `unhandledRejection` log fatal and exit 1, letting the orchestrator restart the pod.
- **PII redaction** — Pino redacts `authorization`, `cookie`, `x-api-key`, `*.password`, `*.token`, `*.secret` automatically.
- **Trust proxy** — `app.set('trust proxy', 1)` so client IPs and `x-forwarded-*` headers behave correctly behind a load balancer.
- **Health vs rate limit** — `/health` is exempted from rate limiting so probes never trip the limiter.
