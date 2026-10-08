# Architecture

> Scope note: this repository currently implements **Phases 0–7** (architecture, scaffolding, database,
> backend, auth/RBAC, waste lifecycle, REST API, Redis). Frontend, analytics UI, Hindsight/AI are designed
> here but **not yet built** (see "Roadmap").

## System overview

```
 React SPA (planned)  ──HTTP/JSON──▶  Express API (Node + TypeScript)
                                         │        │         │
                                         ▼        ▼         ▼
                                    PostgreSQL   Redis   Hindsight + LLM (planned)
```

| Layer | Choice | Why |
|---|---|---|
| API | Express + TypeScript | Small, well understood, easy to layer |
| DB | PostgreSQL 16 | Relational integrity (FKs, constraints, enums, triggers) fits a regulated lifecycle |
| Cache | Redis 7 | Dashboard cache, rate limiting, alert de-duplication state |
| Validation | zod | One schema gives runtime validation and TS types |
| Auth | JWT (HS256) + bcrypt | Stateless, simple to explain |
| Tests | vitest + supertest on real Postgres/Redis | Integration tests catch SQL/constraint bugs |

## Backend layering

```
routes  →  controllers  →  services  →  repositories  →  PostgreSQL
 (URL +      (HTTP in/out,   (business     (parameterised
  middleware) validation)     rules, tx,    SQL only)
                              audit, cache)
```

* **routes**: map URL + method to a controller, attach `authenticate` and `requireRole`.
* **controllers**: parse/validate input with zod, call one service, shape the response.
* **services**: all business rules (state machine, alerts, audit, cache invalidation). Own DB transactions.
* **repositories**: SQL only. Every query is parameterised (`$1, $2…`); sort columns come from a whitelist.
* **middleware**: auth, RBAC, rate limit, error handler, request logging.

## Authentication and authorization

* `POST /api/auth/login` verifies bcrypt hash, returns a JWT (`sub`, `role`, `facilityId`, 8h expiry).
* `authenticate` middleware verifies the token **and re-loads the user** so deactivated users lose access immediately.
* `requireRole(...roles)` enforces permissions server-side. Row-level scoping is done in services/repositories:
  hospital staff only see their facility, collectors only their assigned collections, transporters only their jobs.
* `POST /api/auth/register` is **ADMIN-only** (no open self-registration in a regulated system).

| Role | Capabilities |
|---|---|
| ADMIN | Everything |
| HOSPITAL_STAFF | Create/edit waste for own facility, request collections, close records |
| WASTE_COLLECTOR | View assigned collections, mark collected |
| TRANSPORTER | View assigned transport jobs, start/arrive |
| TREATMENT_OPERATOR | Record treatment/disposal, move arrived waste to treatment |
| AUDITOR | Read-only on operational data, alerts, audit logs |

## Waste lifecycle (state machine)

```
SEGREGATED → COLLECTION_PENDING → COLLECTED → IN_TRANSIT → ARRIVED → TREATMENT_PENDING → TREATED → DISPOSED → CLOSED
     └──────────── REJECTED (allowed before treatment starts) ────────────┘
```

The transition table lives in one file (`services/lifecycle.ts`) and is the only authority on legal moves.
Each move: (1) is validated, (2) runs in a DB transaction together with the domain record change,
(3) writes `waste_status_history`, (4) writes an audit log, (5) invalidates the dashboard cache.

Transitions are driven by workflows rather than by free-form status edits:

| Action | Endpoint | Resulting waste status |
|---|---|---|
| Register waste | `POST /waste` | SEGREGATED |
| Request collection | `POST /collections` | COLLECTION_PENDING |
| Assign collector | `PATCH /collections/:id` `{collectorId}` | (unchanged) |
| Complete collection | `PATCH /collections/:id` `{status: COMPLETED}` | COLLECTED |
| Plan transport | `POST /transport` | (unchanged, needs COLLECTED) |
| Depart / arrive | `PATCH /transport/:id` | IN_TRANSIT / ARRIVED |
| Start treatment queue | `POST /waste/:id/transition` | TREATMENT_PENDING |
| Treat + dispose | `POST /disposals` | TREATED → DISPOSED |
| Close / reject | `POST /waste/:id/transition` | CLOSED / REJECTED |

## Alerts

Created by (a) event hooks (transport arrives late, quantity above threshold on creation) and
(b) a periodic scan (`alertService.scan`, every `ALERT_SCAN_INTERVAL_MS`, also `POST /api/alerts/scan`) for
overdue collections, overdue in-transit transports, unassigned waste and arrived-but-undisposed waste.
A partial unique index `(type, waste_id) WHERE status <> 'RESOLVED'` prevents duplicate open alerts, so the scan is idempotent. Alerts auto-resolve when the cause is fixed (e.g. recording a disposal resolves MISSING_DISPOSAL).

## Redis usage

| Purpose | Key | Notes |
|---|---|---|
| Dashboard cache | `dash:v<N>:<hash(filters)>` | TTL 60s; invalidated by bumping `cache:version` (INCR) on any data change |
| Rate limiting | `rl:<scope>:<ip>` | Fixed window; login has a strict limit |
| Alert scan lock | `alert:scan:lock` | `SET NX EX 60` so overlapping scans (multiple instances) do not run together |
| Last scan summary | `alert:scan:last` | Temporary state shown to admins |

If Redis is down, all Redis features **fail open**: dashboard reads go to PostgreSQL, rate limiting is skipped, and
the unique index still prevents duplicate alerts. The API stays correct, just slower.

## Error handling and validation

* All input validated with zod; failures → `400` with field details.
* `AppError(status, code, message)` for expected errors; unknown errors → `500` with a generic message (no stack leak).
* Uniform envelope: `{ "success": true, "data": … , "meta"?: … }` or `{ "success": false, "error": { "code", "message", "details"? } }`.

## Environment variables

See `backend/.env.example`. Secrets are never committed.

## Roadmap (designed, not built)

* Frontend (React + Vite + TS), dashboards, charts.
* Hindsight memory bank + LLM tool-calling assistant (see `docs/AI.md`).
* Analytics endpoints beyond the dashboard summary.
