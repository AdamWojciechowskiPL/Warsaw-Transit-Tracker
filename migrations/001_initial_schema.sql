-- Transit Tracker – Initial Schema Migration
-- Version: 001
-- Uruchom jednorazowo na nowej bazie Neon

-- app_user
CREATE TABLE IF NOT EXISTS app_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_subject TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- route_profile
CREATE TABLE IF NOT EXISTS route_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  is_valid BOOLEAN NOT NULL DEFAULT TRUE,
  validation_errors JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_route_profile_user_active ON route_profile(user_id, is_active);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'route_profile_updated_at') THEN
    CREATE TRIGGER route_profile_updated_at
    BEFORE UPDATE ON route_profile
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- route_segment
CREATE TABLE IF NOT EXISTS route_segment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES route_profile(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('TRAIN', 'BUS', 'WALK')),
  agency TEXT,
  from_stop_id TEXT,
  to_stop_id TEXT,
  allowed_route_ids JSONB,
  stop_variants JSONB,
  notes TEXT,
  UNIQUE(profile_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_route_segment_profile ON route_segment(profile_id, seq);

-- transfer_config
CREATE TABLE IF NOT EXISTS transfer_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES route_profile(id) ON DELETE CASCADE,
  exit_buffer_sec INTEGER NOT NULL DEFAULT 60,
  min_transfer_buffer_sec INTEGER NOT NULL DEFAULT 120,
  walk_times JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
