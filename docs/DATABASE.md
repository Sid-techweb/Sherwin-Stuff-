# Database design (PostgreSQL 16)

Schema source of truth: [`database/migrations/001_init.sql`](../database/migrations/001_init.sql). Applied by
`npm run migrate` (tracked in `schema_migrations`). Roles are a Postgres `ENUM` (`user_role`) rather than a table
because the set is fixed and enforced in code; this keeps queries join-free.

## Entity-relationship overview

```
facilities ──< users                          waste_categories
    │                                               │
    └──< waste_records >────────────────────────────┘
            │  (created_by → users)
            ├──< waste_status_history   (every state change)
            ├──< collection_records     (collector → users)
            ├──< transport_records >── vehicles, users(transporter), facilities(origin), treatment_facilities(destination)
            ├──1 disposal_records >── treatment_facilities, users(operator)
            └──< alerts (nullable link)           users ──< notifications        audit_logs (append-only)
```

## Tables

| Table | Purpose | Key constraints |
|---|---|---|
| `facilities` | Waste generators (hospital, clinic, lab…) | unique `code` |
| `treatment_facilities` | Where waste is treated; `methods disposal_method[]`, capacity | `capacity > 0` |
| `users` | Accounts, bcrypt hash, `role`, optional `facility_id` | unique email; CHECK: HOSPITAL_STAFF must have a facility |
| `waste_categories` | Colour category, default method, `max_storage_hours`, `alert_quantity_kg` | unique code |
| `vehicles` | Fleet; `status` AVAILABLE / IN_USE / MAINTENANCE | unique registration; capacity > 0 |
| `waste_records` | One row per waste batch; unique `record_code` like `BMW-2026-000123` (sequence); `status` enum | quantity > 0, FKs to category / facility / creator |
| `waste_status_history` | Immutable transition log (from, to, who, when, note) | cascade with record |
| `collection_records` | Request → assign → complete | partial unique index: one non-cancelled collection per waste; completed ⇒ `collected_at` set |
| `transport_records` | Vehicle, transporter, origin, destination, expected/actual arrival, `is_delayed` | one non-cancelled transport per waste; arrival ≥ departure |
| `disposal_records` | Method, times, certificate | `waste_id` UNIQUE; disposed ≥ treated |
| `alerts` | type, severity, status, message, linked waste/facility | partial unique `(type, waste_id)` while not RESOLVED |
| `notifications` | Per-user messages | |
| `ai_memories` | Memory ledger for the AI assistant (`category`, redacted `text`, `text_hash`, generated `tsvector` + GIN index for full-text recall, `synced_to_hindsight`) | category CHECK (7 allowed values), text length 10-800 |
| `audit_logs` | Who did what to which entity, JSONB metadata | **trigger blocks UPDATE/DELETE** |

## Indexes

Chosen from the actual query patterns: `waste_records(status)`, `(facility_id)`, `(category_id)`, `(generated_at DESC)`;
`collection_records(collector_id)`, `(status)`; `transport_records(transporter_id)`, `(status)`;
`alerts(status, severity)`; `audit_logs(entity, entity_id)`, `(created_at DESC)`; `waste_status_history(waste_id, changed_at)`.

## Integrity rules enforced in the database (not just in code)

* Foreign keys everywhere; `ON DELETE CASCADE` only for history rows and notifications.
* Enums for statuses/methods/severity, so invalid values cannot be stored.
* Audit log immutability via trigger `trg_audit_no_update`.
* Concurrency: services `SELECT … FOR UPDATE` the waste row before each transition, so two simultaneous requests cannot both move it.

## Demo data

`npm run seed` truncates and loads **synthetic** data: 5 facilities, 3 treatment facilities, 5 vehicles, 4 categories,
12 users, ~260 waste records over 45 days with matching collections, transports, disposals, alerts and ~3.7k audit rows.
Deliberate scenarios: normal and delayed transports, Demo Riverside Hospital with repeated delays, waste pending
disposal, high-quantity spikes at Demo General Hospital, overdue collections, repeated segregation problems at Demo City Clinic.
Records carry `is_demo = TRUE` and a `[DEMO]` note.
