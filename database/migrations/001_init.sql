-- Biomedical Waste Tracking: initial schema. All demo data is synthetic.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM
  ('ADMIN','HOSPITAL_STAFF','WASTE_COLLECTOR','TRANSPORTER','TREATMENT_OPERATOR','AUDITOR');

CREATE TYPE waste_status AS ENUM
  ('SEGREGATED','COLLECTION_PENDING','COLLECTED','IN_TRANSIT','ARRIVED',
   'TREATMENT_PENDING','TREATED','DISPOSED','CLOSED','REJECTED');

CREATE TYPE collection_status AS ENUM ('PENDING','ASSIGNED','COMPLETED','CANCELLED');
CREATE TYPE transport_status  AS ENUM ('PLANNED','IN_TRANSIT','ARRIVED','CANCELLED');
CREATE TYPE disposal_method   AS ENUM ('INCINERATION','AUTOCLAVE','MICROWAVE','DEEP_BURIAL','CHEMICAL_DISINFECTION','SHREDDING');
CREATE TYPE alert_severity    AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');
CREATE TYPE alert_status      AS ENUM ('OPEN','ACKNOWLEDGED','RESOLVED');
CREATE TYPE alert_type        AS ENUM
  ('DELAYED_COLLECTION','DELAYED_TRANSPORT','EXCESSIVE_QUANTITY','MISSING_DISPOSAL',
   'INVALID_TRANSITION','VEHICLE_ISSUE','UNASSIGNED_WASTE','SEGREGATION_PROBLEM');

CREATE TABLE facilities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(20) NOT NULL UNIQUE,
  name        VARCHAR(150) NOT NULL,
  type        VARCHAR(30) NOT NULL CHECK (type IN ('HOSPITAL','CLINIC','LABORATORY','BLOOD_BANK')),
  address     TEXT,
  city        VARCHAR(80),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE treatment_facilities (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                VARCHAR(20) NOT NULL UNIQUE,
  name                VARCHAR(150) NOT NULL,
  address             TEXT,
  city                VARCHAR(80),
  methods             disposal_method[] NOT NULL,
  capacity_kg_per_day NUMERIC(10,2) NOT NULL CHECK (capacity_kg_per_day > 0),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  name          VARCHAR(120) NOT NULL,
  password_hash TEXT NOT NULL,
  role          user_role NOT NULL,
  facility_id   UUID REFERENCES facilities(id),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- hospital staff must belong to a facility
  CONSTRAINT staff_has_facility CHECK (role <> 'HOSPITAL_STAFF' OR facility_id IS NOT NULL)
);
CREATE INDEX idx_users_role ON users(role);

CREATE TABLE waste_categories (
  id                 SMALLSERIAL PRIMARY KEY,
  code               VARCHAR(20) NOT NULL UNIQUE,
  name               VARCHAR(80) NOT NULL,
  color              VARCHAR(20) NOT NULL,
  description        TEXT,
  default_method     disposal_method NOT NULL,
  max_storage_hours  INT NOT NULL DEFAULT 48 CHECK (max_storage_hours > 0),
  alert_quantity_kg  NUMERIC(10,2) NOT NULL DEFAULT 50 CHECK (alert_quantity_kg > 0)
);

CREATE TABLE vehicles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration  VARCHAR(20) NOT NULL UNIQUE,
  type          VARCHAR(40) NOT NULL,
  capacity_kg   NUMERIC(10,2) NOT NULL CHECK (capacity_kg > 0),
  status        VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','IN_USE','MAINTENANCE')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE waste_record_seq START 1;

CREATE TABLE waste_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_code   VARCHAR(30) NOT NULL UNIQUE
                DEFAULT ('BMW-' || to_char(now(),'YYYY') || '-' || lpad(nextval('waste_record_seq')::text, 6, '0')),
  category_id   SMALLINT NOT NULL REFERENCES waste_categories(id),
  facility_id   UUID NOT NULL REFERENCES facilities(id),
  quantity      NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
  unit          VARCHAR(10) NOT NULL DEFAULT 'kg' CHECK (unit IN ('kg','g','l')),
  status        waste_status NOT NULL DEFAULT 'SEGREGATED',
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes         TEXT,
  is_demo       BOOLEAN NOT NULL DEFAULT FALSE,
  created_by    UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at     TIMESTAMPTZ
);
CREATE INDEX idx_waste_status ON waste_records(status);
CREATE INDEX idx_waste_facility ON waste_records(facility_id);
CREATE INDEX idx_waste_category ON waste_records(category_id);
CREATE INDEX idx_waste_generated ON waste_records(generated_at DESC);

CREATE TABLE waste_status_history (
  id          BIGSERIAL PRIMARY KEY,
  waste_id    UUID NOT NULL REFERENCES waste_records(id) ON DELETE CASCADE,
  from_status waste_status,
  to_status   waste_status NOT NULL,
  changed_by  UUID REFERENCES users(id),
  note        TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_history_waste ON waste_status_history(waste_id, changed_at);

CREATE TABLE collection_records (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  waste_id           UUID NOT NULL REFERENCES waste_records(id),
  requested_by       UUID NOT NULL REFERENCES users(id),
  collector_id       UUID REFERENCES users(id),
  status             collection_status NOT NULL DEFAULT 'PENDING',
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  scheduled_for      TIMESTAMPTZ,
  collected_at       TIMESTAMPTZ,
  collected_quantity NUMERIC(10,2) CHECK (collected_quantity IS NULL OR collected_quantity > 0),
  notes              TEXT,
  CONSTRAINT completed_has_time CHECK (status <> 'COMPLETED' OR collected_at IS NOT NULL)
);
-- at most one live (non-cancelled) collection per waste record
CREATE UNIQUE INDEX uq_collection_active ON collection_records(waste_id) WHERE status <> 'CANCELLED';
CREATE INDEX idx_collection_collector ON collection_records(collector_id);
CREATE INDEX idx_collection_status ON collection_records(status);

CREATE TABLE transport_records (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  waste_id                UUID NOT NULL REFERENCES waste_records(id),
  vehicle_id              UUID NOT NULL REFERENCES vehicles(id),
  transporter_id          UUID NOT NULL REFERENCES users(id),
  origin_facility_id      UUID NOT NULL REFERENCES facilities(id),
  destination_id          UUID NOT NULL REFERENCES treatment_facilities(id),
  status                  transport_status NOT NULL DEFAULT 'PLANNED',
  departed_at             TIMESTAMPTZ,
  expected_arrival_at     TIMESTAMPTZ NOT NULL,
  actual_arrival_at       TIMESTAMPTZ,
  is_delayed              BOOLEAN NOT NULL DEFAULT FALSE,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT arrival_after_departure CHECK (actual_arrival_at IS NULL OR departed_at IS NULL OR actual_arrival_at >= departed_at)
);
CREATE UNIQUE INDEX uq_transport_active ON transport_records(waste_id) WHERE status <> 'CANCELLED';
CREATE INDEX idx_transport_transporter ON transport_records(transporter_id);
CREATE INDEX idx_transport_status ON transport_records(status);

CREATE TABLE disposal_records (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  waste_id               UUID NOT NULL UNIQUE REFERENCES waste_records(id),
  treatment_facility_id  UUID NOT NULL REFERENCES treatment_facilities(id),
  operator_id            UUID NOT NULL REFERENCES users(id),
  method                 disposal_method NOT NULL,
  treated_at             TIMESTAMPTZ NOT NULL,
  disposed_at            TIMESTAMPTZ NOT NULL,
  certificate_no         VARCHAR(50),
  notes                  TEXT,
  CONSTRAINT disposed_after_treated CHECK (disposed_at >= treated_at)
);

CREATE TABLE alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type         alert_type NOT NULL,
  severity     alert_severity NOT NULL,
  status       alert_status NOT NULL DEFAULT 'OPEN',
  message      TEXT NOT NULL,
  waste_id     UUID REFERENCES waste_records(id) ON DELETE SET NULL,
  facility_id  UUID REFERENCES facilities(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  resolved_by  UUID REFERENCES users(id)
);
CREATE INDEX idx_alerts_status ON alerts(status, severity);
-- one open alert per (type, waste) prevents duplicates even if Redis is down
CREATE UNIQUE INDEX uq_alert_open ON alerts(type, waste_id) WHERE status <> 'RESOLVED' AND waste_id IS NOT NULL;

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       VARCHAR(150) NOT NULL,
  body        TEXT,
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);

CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id),
  action      VARCHAR(60) NOT NULL,
  entity      VARCHAR(40) NOT NULL,
  entity_id   VARCHAR(64),
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

-- audit logs are append-only: block UPDATE and DELETE from the application
CREATE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
