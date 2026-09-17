-- ============================================================================
-- Migration 004: Disputes & Rejection Evidence
--
-- REJECTION EVIDENCE:
--   Adds two immutable columns to can_tests to record the evidence captured at
--   test time for every rejection. This preserves the insert-only model — these
--   fields are populated at INSERT time and cannot be changed retroactively.
--
--   evidence_type  — 'photo' | 'sensory' — declares which evidence form was used.
--   sensory_note   — free-text field populated when evidence_type = 'sensory'.
--                    photo_url (from migration 001) is used when type = 'photo'.
--
--   A CHECK constraint enforces that rejected cans must have evidence at INSERT.
--
-- REJECTION REASON CODES:
--   The existing reason_codes TEXT[] column in can_tests already accepts any
--   text value. The grading engine enforces the canonical set in application
--   code. No migration change is needed to support the new codes
--   HIGH_ACIDITY and SEDIMENT_DETECTED — they will be stored correctly in the
--   existing column. We add a comment update only.
--
-- DISPUTES MODEL:
--   A minimal append-friendly table. Farmers submit disputes via an RPC
--   (submit_dispute) to prevent arbitrary record creation. Operators resolve
--   disputes via a second RPC (resolve_dispute) that is PIN-authenticated.
--
--   Dispute rows are never modified after creation — resolution is recorded as
--   a completed state via the resolve_dispute RPC which sets status,
--   resolved_at, resolved_by, resolution_type, and resolution_reason atomically.
--   The underlying can_test row remains completely untouched.
--
-- SECURITY:
--   - No UPDATE or DELETE policy on disputes.
--   - Public INSERT is blocked; farmers must go through submit_dispute RPC.
--   - Operator resolution goes through resolve_dispute RPC with PIN check.
--   - Neither RPC exposes or returns operator PIN values.
--   - SECURITY DEFINER RPCs operate with SET search_path = public, pg_temp.
-- ============================================================================

-- ─── 1. REJECTION EVIDENCE COLUMNS ON CAN_TESTS ─────────────────────────────
-- These columns are intentionally nullable to preserve backward compatibility
-- with rows inserted before this migration. The constraint below applies
-- NOT VALID so existing rows are not retroactively checked.

ALTER TABLE can_tests
  ADD COLUMN evidence_type TEXT CHECK (evidence_type IN ('photo', 'sensory')),
  ADD COLUMN sensory_note  TEXT;

COMMENT ON COLUMN can_tests.evidence_type IS
  'The type of mandatory evidence captured for a rejected can: ''photo'' (photo_url populated) '
  'or ''sensory'' (sensory_note populated). NULL for accepted cans and pre-migration rows.';

COMMENT ON COLUMN can_tests.sensory_note IS
  'Free-text sensory or inspector note describing the rejection reason in detail. '
  'Populated when evidence_type = ''sensory''. NULL otherwise. '
  'Immutable — set at INSERT time and never changed.';

-- Enforce that evidence is provided for rejected cans and correctly structured.
-- NOT VALID: skips checking rows already in the table (pre-migration rows).
ALTER TABLE can_tests
  ADD CONSTRAINT can_tests_evidence_consistency
    CHECK (
      (decision = 'accepted' AND evidence_type IS NULL AND photo_url IS NULL AND sensory_note IS NULL)
      OR
      (decision = 'rejected' AND evidence_type = 'photo' AND photo_url IS NOT NULL AND trim(photo_url) <> '' AND sensory_note IS NULL)
      OR
      (decision = 'rejected' AND evidence_type = 'sensory' AND sensory_note IS NOT NULL AND trim(sensory_note) <> '' AND photo_url IS NULL)
    ) NOT VALID;

-- Update the reason_codes comment to document all accepted codes including new ones.
COMMENT ON COLUMN can_tests.reason_codes IS
  'Persistable reason codes explaining a rejection. '
  'Allowed values: LOW_FAT, LOW_SNF, HIGH_TEMPERATURE, ADULTERATION_DETECTED, '
  'HIGH_ACIDITY, SEDIMENT_DETECTED, OPERATOR_OVERRIDE. '
  'Empty array for accepted cans. Present on rejection slips. '
  'INVALID_* codes produced by the grading engine must never be persisted here.';


-- ─── 2. DISPUTES TABLE ───────────────────────────────────────────────────────

CREATE TABLE disputes (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  can_test_id      UUID NOT NULL REFERENCES can_tests(id),

  -- Submitted by farmer
  farmer_message   TEXT NOT NULL,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Resolution (populated atomically by resolve_dispute RPC)
  status           TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'resolved')),
  resolved_at      TIMESTAMPTZ,
  resolved_by      UUID REFERENCES operators(id),  -- operator who resolved
  resolution_type  TEXT CHECK (resolution_type IN ('adjustment', 'final_rejection')),
  resolution_reason TEXT,

  -- Consistency: resolved fields must all be present together or all absent
  CONSTRAINT disputes_resolution_consistency CHECK (
    (status = 'open'
      AND resolved_at IS NULL
      AND resolved_by IS NULL
      AND resolution_type IS NULL
      AND resolution_reason IS NULL)
    OR
    (status = 'resolved'
      AND resolved_at IS NOT NULL
      AND resolved_by IS NOT NULL
      AND resolution_type IS NOT NULL
      AND resolution_reason IS NOT NULL)
  )
);

COMMENT ON TABLE disputes IS
  'Farmer-submitted disputes against a can test result. '
  'Append-only: INSERT via submit_dispute RPC only; resolution via resolve_dispute RPC. '
  'The underlying can_test row is NEVER modified by a dispute or its resolution.';

COMMENT ON COLUMN disputes.can_test_id IS
  'The can test being disputed. The original row is never modified.';
COMMENT ON COLUMN disputes.farmer_message IS
  'The farmer''s description of the dispute — why they believe the result is incorrect.';
COMMENT ON COLUMN disputes.status IS
  '''open'' until an operator resolves it via resolve_dispute RPC.';
COMMENT ON COLUMN disputes.resolved_by IS
  'The operator UUID who resolved the dispute. References operators(id).';
COMMENT ON COLUMN disputes.resolution_type IS
  '''adjustment'' when the operator agrees and files a correction; '
  '''final_rejection'' when the operator upholds the original decision after review.';
COMMENT ON COLUMN disputes.resolution_reason IS
  'The operator''s explanation of the resolution decision.';

-- Indexes
CREATE INDEX idx_disputes_can_test_id  ON disputes(can_test_id);
CREATE INDEX idx_disputes_status       ON disputes(status);
CREATE INDEX idx_disputes_submitted_at ON disputes(submitted_at DESC);
CREATE UNIQUE INDEX idx_disputes_single_open ON disputes(can_test_id) WHERE status = 'open';


-- ─── 3. RLS ON DISPUTES ──────────────────────────────────────────────────────
-- Public INSERT is blocked. Farmers use the submit_dispute RPC.
-- Direct operator INSERT is also blocked. Resolution uses resolve_dispute RPC.
-- SELECT is public so farmers and operators can read dispute status.

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

-- NO SELECT policy — all reads go through get_dispute_status RPC (SECURITY DEFINER).

-- NO INSERT policy — all writes go through RPCs (SECURITY DEFINER).
-- NO UPDATE policy.
-- NO DELETE policy.


-- ─── 4. SUBMIT_DISPUTE RPC ───────────────────────────────────────────────────
-- Farmer-facing. No authentication required — the can_test_id is the
-- "proof" that the farmer knows which record they are disputing.
-- Rate-limiting and abuse prevention are handled at the Supabase/platform
-- layer for the prototype scope.
--
-- Constraints enforced by the RPC:
--   - The can_test must exist.
--   - The can_test must have decision = 'rejected' (accepted cans cannot be disputed).
--   - The can_test must not already have an open dispute.
--   - farmer_message must be non-empty.

CREATE OR REPLACE FUNCTION public.submit_dispute(
  p_can_test_id    UUID,
  p_reference_code TEXT,
  p_farmer_message TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_decision    TEXT;
  v_ref_code    TEXT;
  v_dispute_id  UUID;
BEGIN
  -- 1. Validate inputs
  IF p_farmer_message IS NULL OR trim(p_farmer_message) = '' THEN
    RAISE EXCEPTION 'Invalid request: farmer_message must not be empty';
  END IF;

  IF length(trim(p_farmer_message)) > 1000 THEN
    RAISE EXCEPTION 'Invalid request: farmer_message must be 1000 characters or fewer';
  END IF;

  -- 2. Verify the can_test exists, is owned by the reference code, and was rejected
  SELECT decision, reference_code INTO v_decision, v_ref_code
  FROM public.can_tests
  WHERE id = p_can_test_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid request: Can test not found';
  END IF;

  IF p_reference_code IS NULL OR v_ref_code IS DISTINCT FROM p_reference_code THEN
    RAISE EXCEPTION 'Unauthorized: Invalid reference code';
  END IF;

  IF v_decision <> 'rejected' THEN
    RAISE EXCEPTION 'Invalid request: Only rejected tests can be disputed';
  END IF;

  -- 3. Insert the dispute (bypasses RLS via SECURITY DEFINER)
  -- Catches unique_violation from idx_disputes_single_open to prevent duplicates
  BEGIN
    INSERT INTO public.disputes (can_test_id, farmer_message)
    VALUES (p_can_test_id, trim(p_farmer_message))
    RETURNING id INTO v_dispute_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Invalid request: An open dispute already exists for this test';
  END;

  RETURN jsonb_build_object('id', v_dispute_id);
END;
$$;

COMMENT ON FUNCTION public.submit_dispute IS
  'Farmer-facing RPC to file a dispute against a rejected can test. '
  'No authentication required. Validates that the test exists, was rejected, '
  'and has no existing open dispute. Inserts via SECURITY DEFINER to bypass RLS '
  'without exposing a public INSERT policy on disputes.';

REVOKE EXECUTE ON FUNCTION public.submit_dispute FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_dispute TO anon, authenticated;

-- ─── 4b. GET_DISPUTE_STATUS RPC ──────────────────────────────────────────────
-- Farmer-facing. Requires the can test reference code for proof of ownership.
-- Returns only safe status fields, without sensitive notes or operator IDs.

CREATE OR REPLACE FUNCTION public.get_dispute_status(
  p_can_test_id    UUID,
  p_reference_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ref_code TEXT;
  v_status   JSONB;
BEGIN
  -- Validate ownership
  SELECT reference_code INTO v_ref_code
  FROM public.can_tests
  WHERE id = p_can_test_id;

  IF NOT FOUND OR p_reference_code IS NULL OR v_ref_code IS DISTINCT FROM p_reference_code THEN
    RAISE EXCEPTION 'Unauthorized: Invalid test or reference code';
  END IF;

  SELECT jsonb_build_object(
    'status', d.status,
    'submitted_at', d.submitted_at,
    'resolved_at', d.resolved_at,
    'resolution_type', d.resolution_type
  ) INTO v_status
  FROM public.disputes d
  WHERE d.can_test_id = p_can_test_id;

  RETURN v_status; -- Will be NULL if no dispute exists
END;
$$;

COMMENT ON FUNCTION public.get_dispute_status IS
  'Farmer-facing RPC to read dispute status securely using reference code.';

REVOKE EXECUTE ON FUNCTION public.get_dispute_status FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dispute_status TO anon, authenticated;


-- ─── 5. RESOLVE_DISPUTE RPC ──────────────────────────────────────────────────
-- Operator-facing. PIN-authenticated. Atomically sets all resolution fields.
-- Does NOT modify the original can_test row.
-- Does NOT expose operator PIN in return value.

CREATE OR REPLACE FUNCTION public.resolve_dispute(
  p_operator_id     UUID,
  p_pin             TEXT,
  p_dispute_id      UUID,
  p_resolution_type TEXT,
  p_resolution_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_valid      BOOLEAN;
  v_updated_id    UUID;
BEGIN
  -- 1. Validate operator PIN
  SELECT EXISTS(
    SELECT 1 FROM public.operators WHERE id = p_operator_id AND pin = p_pin
  ) INTO v_is_valid;

  IF NOT v_is_valid THEN
    RAISE EXCEPTION 'Unauthorized: Invalid operator ID or PIN';
  END IF;

  -- 2. Validate resolution_type
  IF p_resolution_type NOT IN ('adjustment', 'final_rejection') THEN
    RAISE EXCEPTION 'Invalid request: resolution_type must be adjustment or final_rejection';
  END IF;

  -- 3. Validate resolution_reason
  IF p_resolution_reason IS NULL OR trim(p_resolution_reason) = '' THEN
    RAISE EXCEPTION 'Invalid request: resolution_reason must not be empty';
  END IF;

  IF length(trim(p_resolution_reason)) > 1000 THEN
    RAISE EXCEPTION 'Invalid request: resolution_reason must be 1000 characters or fewer';
  END IF;

  -- 4. Atomically resolve the dispute (bypasses RLS via SECURITY DEFINER)
  UPDATE public.disputes
  SET
    status            = 'resolved',
    resolved_at       = now(),
    resolved_by       = p_operator_id,
    resolution_type   = p_resolution_type,
    resolution_reason = trim(p_resolution_reason)
  WHERE id = p_dispute_id AND status = 'open'
  RETURNING id INTO v_updated_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid request: Dispute not found or already resolved';
  END IF;

  RETURN jsonb_build_object(
    'id',               v_updated_id,
    'resolution_type',  p_resolution_type
  );
END;
$$;

COMMENT ON FUNCTION public.resolve_dispute IS
  'Operator-facing PIN-authenticated RPC to resolve an open dispute. '
  'Atomically sets status, resolved_at, resolved_by, resolution_type, '
  'and resolution_reason in a single UPDATE. '
  'The original can_test row is NEVER modified. '
  'Does not return or expose operator PIN values.';

REVOKE EXECUTE ON FUNCTION public.resolve_dispute FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_dispute TO anon, authenticated;
