CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS endpoints (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url         TEXT NOT NULL,
  secret      TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- status: pending | delivered | failed
CREATE TABLE IF NOT EXISTS deliveries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending',
  attempts    INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id            BIGSERIAL PRIMARY KEY,
  delivery_id   UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  attempt       INTEGER NOT NULL,
  status_code   INTEGER,
  error         TEXT,
  duration_ms   INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_endpoint ON events(endpoint_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_event ON deliveries(event_id);
CREATE INDEX IF NOT EXISTS idx_attempts_delivery ON delivery_attempts(delivery_id);
