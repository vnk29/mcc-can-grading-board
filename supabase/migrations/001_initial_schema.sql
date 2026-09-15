-- ============================================================================
-- Migration 001: Initial Schema for Milk Chilling Center — Can Grading Board
--
-- Core design principle: INSERT-ONLY IMMUTABILITY
-- can_tests and corrections only allow INSERT + SELECT.
-- No UPDATE or DELETE policies exist, enforcing tamper-proof audit trails
-- at the database level, not just the application level.
-- ============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── OPERATORS ──────────────────────────────────────────────────────────────

CREATE TABLE operators (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  pin        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE operators IS 'Booth operators who test and grade milk cans.';
COMMENT ON COLUMN operators.pin IS 'Simple numeric PIN for shift-start authentication (not a security boundary).';

-- ─── FARMERS ────────────────────────────────────────────────────────────────

CREATE TABLE farmers (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  phone      TEXT,
  village    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE farmers IS 'Pre-seeded list of village dairy farmers who deliver milk cans.';

-- ─── CAN TESTS (immutable) ─────────────────────────────────────────────────

CREATE TABLE can_tests (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farmer_id            UUID NOT NULL REFERENCES farmers(id),
  operator_id          UUID NOT NULL REFERENCES operators(id),
  can_volume           NUMERIC NOT NULL,
  fat_percent          NUMERIC NOT NULL,
  snf_percent          NUMERIC NOT NULL,
  temperature          NUMERIC NOT NULL,
  adulteration_result  BOOLEAN NOT NULL DEFAULT false,
  decision             TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  reason_codes         TEXT[] NOT NULL DEFAULT '{}',
  is_override          BOOLEAN NOT NULL DEFAULT false,
  override_reason      TEXT,
  reference_code       TEXT NOT NULL UNIQUE,
  photo_url            TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status          TEXT NOT NULL DEFAULT 'synced'
);

COMMENT ON TABLE can_tests IS 'Write-once record of every milk can quality test. No updates allowed.';
COMMENT ON COLUMN can_tests.decision IS 'Final accept/reject decision. May differ from auto-grading if operator overrides.';
COMMENT ON COLUMN can_tests.reason_codes IS 'Array of reason codes explaining why a can was rejected (e.g. LOW_FAT, HIGH_TEMPERATURE).';
COMMENT ON COLUMN can_tests.is_override IS 'True if the operator overrode the auto-suggested grading decision.';
COMMENT ON COLUMN can_tests.reference_code IS 'Short unique code for QR / dispute lookup (e.g. MCC-20260915-A3F2).';
COMMENT ON COLUMN can_tests.sync_status IS 'Tracks offline queue state: pending | synced | failed.';

-- Indexes for common lookups
CREATE INDEX idx_can_tests_farmer_id    ON can_tests(farmer_id);
CREATE INDEX idx_can_tests_operator_id  ON can_tests(operator_id);
CREATE INDEX idx_can_tests_created_at   ON can_tests(created_at DESC);
CREATE INDEX idx_can_tests_reference    ON can_tests(reference_code);

-- ─── CORRECTIONS (append-only amendments) ───────────────────────────────────

CREATE TABLE corrections (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  can_test_id  UUID NOT NULL REFERENCES can_tests(id),
  old_values   JSONB NOT NULL,
  new_values   JSONB NOT NULL,
  corrected_by UUID NOT NULL REFERENCES operators(id),
  reason       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE corrections IS 'Supervisor-only append-only corrections. The original can_test row is never modified; both old and new values are stored here for full auditability.';

CREATE INDEX idx_corrections_can_test_id ON corrections(can_test_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY — Enforcing insert-only immutability at the DB level
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── operators: read-only for the app (seeded by admin) ─────────────────────

ALTER TABLE operators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_select" ON operators
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "operators_insert" ON operators
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ─── farmers: read + insert (new farmers can be added at the booth) ─────────

ALTER TABLE farmers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "farmers_select" ON farmers
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "farmers_insert" ON farmers
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ─── can_tests: INSERT + SELECT only. No UPDATE. No DELETE. ─────────────────

ALTER TABLE can_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "can_tests_select" ON can_tests
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "can_tests_insert" ON can_tests
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Intentionally NO update or delete policies.
-- Any attempt to UPDATE or DELETE will be blocked by RLS.

-- ─── corrections: INSERT + SELECT only. The sole way to amend a record. ─────

ALTER TABLE corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "corrections_select" ON corrections
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "corrections_insert" ON corrections
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Intentionally NO update or delete policies on corrections either.
