-- Local "memory ledger": every memory the assistant retains is recorded here (transparency + fallback recall
-- when Hindsight is unavailable). Hindsight remains the primary long-term memory when configured.
CREATE TABLE ai_memories (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category            VARCHAR(30) NOT NULL CHECK (category IN
    ('USER_PREFERENCE','OPERATIONAL_CONTEXT','INCIDENT','COMPLIANCE_PATTERN','FACILITY_HISTORY','TRANSPORT_HISTORY','CONVERSATION_CONTEXT')),
  text                TEXT NOT NULL CHECK (char_length(text) BETWEEN 10 AND 800),
  text_hash           CHAR(40) NOT NULL,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  facility_id         UUID REFERENCES facilities(id) ON DELETE SET NULL,
  synced_to_hindsight BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  tsv                 TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);
CREATE INDEX idx_ai_memories_tsv ON ai_memories USING GIN (tsv);
CREATE INDEX idx_ai_memories_hash ON ai_memories (text_hash, created_at DESC);
CREATE INDEX idx_ai_memories_category ON ai_memories (category, created_at DESC);
