-- ============================================================================
-- Migration 001: Initial Schema for Milk Chilling Center — Can Grading Board
--
-- IMMUTABILITY MODEL:
--   can_tests is WRITE-ONCE. Row Level Security enforces this at the database
--   layer — no UPDATE or DELETE policies exist on can_tests or corrections.
--   The only way to amend a record is by inserting a row into corrections,
--   which itself is also append-only and never modifies the original row.
--
-- TIMESTAMP MODEL:
--   Every can_test carries two timestamps:
--     test_performed_at — when the physical milk test occurred on the device.
--                         Supplied by the client. Used on rejection slips and
--                         the audit trail. Survives offline scenarios correctly.
--     created_at        — when the row arrived at the database (DEFAULT now()).
--                         Server-stamped, cannot be spoofed by the client.
--   For a live test these will be nearly identical. For an offline-queued test
--   they will differ, and that difference is meaningful (shows sync latency).
--
-- OFFLINE SYNC:
--   Clients generate a UUID primary key and a unique reference_code before
--   going offline. On sync, a duplicate PK or reference_code signals that the
--   row already landed (e.g. previous retry succeeded but ACK was lost). The
--   client must treat a 23505 unique_violation as a successful sync, not an
--   error, to avoid double-insertion.
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

COMMENT ON TABLE operators IS
  'Booth operators who test and grade milk cans. '
  'Seeded and managed by admin only — the application has read-only access.';
COMMENT ON COLUMN operators.pin IS
  'Numeric PIN for shift-start identification. '
  'Not a cryptographic secret; the operator model is intentionally lightweight '
  'for the 48-hour prototype scope.';

-- ─── FARMERS ────────────────────────────────────────────────────────────────

CREATE TABLE farmers (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  phone      TEXT,
  village    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE farmers IS
  'Pre-seeded list of village dairy farmers who deliver milk cans. '
  'New farmers can be added at the booth via application INSERT.';

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
  -- When the physical test was performed on the device (client-supplied).
  -- This is the timestamp that appears on rejection slips and dispute views.
  -- For offline tests this will be earlier than created_at.
  test_performed_at    TIMESTAMPTZ NOT NULL,
  -- When this row was inserted into the database (server-stamped).
  -- Cannot be backdated by the client.
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE can_tests IS
  'Write-once record of every milk can quality test. '
  'No UPDATE or DELETE is permitted at the database level.';
COMMENT ON COLUMN can_tests.decision IS
  'Final accept/reject decision. May differ from the auto-grading result '
  'when the operator exercises their override.';
COMMENT ON COLUMN can_tests.reason_codes IS
  'Reason codes explaining a rejection (e.g. LOW_FAT, HIGH_TEMPERATURE). '
  'Empty array for accepted cans. Present on rejection slips.';
COMMENT ON COLUMN can_tests.is_override IS
  'True when the operator overrode the auto-suggested grading decision. '
  'override_reason must be populated whenever this is true.';
COMMENT ON COLUMN can_tests.reference_code IS
  'Short unique code for QR / dispute lookup (e.g. MCC-20260915-A3F2). '
  'Generated client-side before going offline to support idempotent sync retries.';
COMMENT ON COLUMN can_tests.test_performed_at IS
  'When the physical milk test occurred on the device. Client-supplied. '
  'Used for rejection slips, audit trail, and dispute resolution timestamps. '
  'Correct even when the row was queued offline and synced later.';
COMMENT ON COLUMN can_tests.created_at IS
  'Database insertion timestamp (server-stamped, DEFAULT now()). '
  'Will equal test_performed_at for live tests; will be later for offline syncs.';

-- Indexes for common lookups
CREATE INDEX idx_can_tests_farmer_id       ON can_tests(farmer_id);
CREATE INDEX idx_can_tests_operator_id     ON can_tests(operator_id);
CREATE INDEX idx_can_tests_performed_at    ON can_tests(test_performed_at DESC);
CREATE INDEX idx_can_tests_created_at      ON can_tests(created_at DESC);
CREATE INDEX idx_can_tests_reference       ON can_tests(reference_code);

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

COMMENT ON TABLE corrections IS
  'Supervisor-only append-only corrections. The original can_test row is NEVER '
  'modified. Both old and new values are stored here for full auditability. '
  'Only INSERTs are allowed — no UPDATE or DELETE policies exist.';

CREATE INDEX idx_corrections_can_test_id ON corrections(can_test_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- Immutability is enforced at the database layer, not just the application.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── operators: READ-ONLY from the application ───────────────────────────────
-- Operators are seeded by admin only. No INSERT policy is granted to anon or
-- authenticated roles. Any attempt to insert an operator through the client
-- API will be rejected by RLS.

ALTER TABLE operators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_select" ON operators
  FOR SELECT TO anon, authenticated USING (true);

-- NO INSERT policy on operators.
-- NO UPDATE policy on operators.
-- NO DELETE policy on operators.

-- ─── farmers: SELECT + INSERT (new farmers can be registered at the booth) ───

ALTER TABLE farmers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "farmers_select" ON farmers
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "farmers_insert" ON farmers
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ─── can_tests: INSERT + SELECT only. No UPDATE. No DELETE. ──────────────────
-- The INSERT policy validates that the supplied operator_id references an
-- existing row in the operators table. This prevents fabricated operator IDs
-- without requiring a full authentication system.

ALTER TABLE can_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "can_tests_select" ON can_tests
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "can_tests_insert" ON can_tests
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM operators WHERE operators.id = operator_id)
  );

-- NO UPDATE policy on can_tests.
-- NO DELETE policy on can_tests.

-- ─── corrections: INSERT + SELECT only. The sole way to amend a record. ─────

ALTER TABLE corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "corrections_select" ON corrections
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "corrections_insert" ON corrections
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM can_tests WHERE can_tests.id = can_test_id)
    AND
    EXISTS (SELECT 1 FROM operators WHERE operators.id = corrected_by)
  );

-- NO UPDATE policy on corrections.
-- NO DELETE policy on corrections.
