-- Preserve the canonical evaluation state separately from the final decision.
-- These fields are append-only evidence and are populated for new submissions.
-- Existing rows remain NULL where the original evaluation was not recorded.

ALTER TABLE can_tests
  ADD COLUMN auto_decision TEXT CHECK (auto_decision IN ('accepted', 'rejected')),
  ADD COLUMN is_borderline BOOLEAN;

ALTER TABLE can_tests
  ADD CONSTRAINT can_tests_auto_decision_required
    CHECK (auto_decision IS NOT NULL AND auto_decision IN ('accepted', 'rejected')) NOT VALID,
  ADD CONSTRAINT can_tests_is_borderline_required
    CHECK (is_borderline IS NOT NULL) NOT VALID;

COMMENT ON COLUMN can_tests.auto_decision IS
  'The canonical system decision before any operator override. NULL for legacy rows.';

COMMENT ON COLUMN can_tests.is_borderline IS
  'The canonical borderline flag at test time. NULL for legacy rows.';