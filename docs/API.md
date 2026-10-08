# REST API

Base URL: `http://localhost:4100/api`. JSON in/out. Authenticated routes need `Authorization: Bearer <token>`.

Success: `{ "success": true, "data": …, "meta"?: { page, pageSize, total, totalPages } }`
Error: `{ "success": false, "error": { "code", "message", "details"? } }`

| Status | Meaning |
|---|---|
| 400 | Validation failed / malformed id or JSON |
| 401 | Missing, invalid or expired token; deactivated user |
| 403 | Role not allowed |
| 404 | Not found **or not visible to you** (row-level scoping hides existence) |
| 409 | Business-rule conflict (invalid transition, duplicate, wrong state) |
| 429 | Rate limited (`Retry-After` header) |

## Endpoints

Roles: **A**=ADMIN, **S**=HOSPITAL_STAFF, **C**=WASTE_COLLECTOR, **T**=TRANSPORTER, **O**=TREATMENT_OPERATOR, **U**=AUDITOR.

| Method & path | Roles | Description |
|---|---|---|
| `GET /health` | public | DB + Redis status (`ok` / `degraded` when Redis is down) |
| `POST /auth/login` | public (rate-limited) | `{email,password}` → `{token,user}` |
| `GET /auth/me` | any | Current user |
| `POST /auth/register` | A | Create a user (`email,name,password,role,facilityId?`) |
| `GET /waste` | any (scoped) | Query: `search,status,categoryId,facilityId,from,to,sortBy,sortDir,page,pageSize` |
| `POST /waste` | A,S | Create record → `SEGREGATED` (staff bound to own facility) |
| `GET /waste/:id` | any (scoped) | Detail + status history, collections, transports, disposals, audit trail |
| `PATCH /waste/:id` | A,S | Edit category/quantity/unit/notes while `SEGREGATED` or `COLLECTION_PENDING` |
| `DELETE /waste/:id` | A | Only while `SEGREGATED` |
| `POST /waste/:id/transition` | A,S,O | `{status,note?}` for `TREATMENT_PENDING` (A,O), `CLOSED`, `REJECTED` |
| `GET /collections` | any (scoped) | `status,page,pageSize` |
| `POST /collections` | A,S | `{wasteId,scheduledFor?}` → waste `COLLECTION_PENDING` |
| `PATCH /collections/:id` | A,S (assign) · A,C (complete) | `{collectorId}` or `{status:"COMPLETED",collectedQuantity?}` |
| `GET /transport` | any (scoped) | `status,delayed,page,pageSize` |
| `POST /transport` | A,T | `{wasteId,vehicleId,destinationId,expectedArrivalAt,transporterId?}`; waste must be `COLLECTED` |
| `PATCH /transport/:id` | A,T | `{status:"IN_TRANSIT"}` or `{status:"ARRIVED",arrivedAt?}` (late arrival ⇒ alert) |
| `GET /disposals` | any (scoped) | |
| `POST /disposals` | A,O | `{wasteId,method,treatmentFacilityId?,certificateNo?}` → TREATED → DISPOSED |
| `GET /facilities`, `/treatment-facilities`, `/vehicles`, `/categories` | any | Reference data |
| `GET /users?role=` | A,S | Assignable users (no hashes) |
| `GET /alerts` | A,S,O,U | `status,severity,type,facilityId` |
| `POST /alerts` | A,S,T | Manual `VEHICLE_ISSUE` / `SEGREGATION_PROBLEM` |
| `PATCH /alerts/:id` | A,S,O | `{status:"ACKNOWLEDGED"|"RESOLVED"}` |
| `POST /alerts/scan` | A | Run the rule scan now; `GET /alerts/scan/last` (A,U) |
| `GET /analytics/operational` | A,U,S,O | Avg collection / transport / disposal-turnaround / lifecycle hours, delayed-transport %, collection completion %, per-facility breakdown. Filters `from,to,facilityId`; `X-Cache` header |
| `POST /ai/chat` | A,U,S,O | `{message, history?}` -> `{answer, mode, sources[], memoriesUsed[], memoriesRetained[], warnings[]}`; rate-limited; tools run as the caller |
| `GET /ai/status` | A,U,S,O | LLM configured?, Hindsight reachable?, tool list |
| `GET /ai/memories` | A,U | The memory ledger (what the assistant has retained) |
| `GET /analytics/dashboard` | A,U,S,O | Filters `from,to,facilityId,categoryId,status`; header `X-Cache: HIT|MISS` |
| `GET /audit-logs` | A,U | `entity,entityId,action,userId,from,to,page,pageSize` (read-only) |

## Row-level scoping

HOSPITAL_STAFF → own facility only · WASTE_COLLECTOR → only collections assigned to them · TRANSPORTER → only their jobs.

## Example

```bash
TOKEN=$(curl -s localhost:4100/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"staff.dgh@bmw.demo","password":"Demo@1234"}' | jq -r .data.token)
curl -s localhost:4100/api/waste -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"categoryId":1,"quantity":12.5,"unit":"kg"}'
```
