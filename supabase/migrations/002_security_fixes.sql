-- ============================================================================
-- Migration 002: Security Fixes & Borderline Flags
-- 
-- Fixes critical security/integrity issues from Stage 5:
-- 1. Adds borderline_flags to persist exactly which thresholds were near limits.
-- 2. Removes client-side trust for correction authorization.
-- 3. Creates a secure RPC for correction submission.
-- ============================================================================

-- ─── 1. PRESERVE AFFECTED BORDERLINE MEASUREMENTS ───────────────────────────

-- Add borderline_flags to can_tests
ALTER TABLE can_tests 
  ADD COLUMN borderline_flags TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN can_tests.borderline_flags IS 
  'Persisted array of reason codes (e.g. LOW_FAT, LOW_SNF) indicating exactly which measurements were borderline at the time of the test. Immutable like the rest of the row.';


-- ─── 2. FIX CORRECTION AUTHORIZATION ────────────────────────────────────────

-- Drop the existing INSERT policy on corrections so clients cannot insert directly.
-- (The table defaults to Deny All for INSERT now).
DROP POLICY IF EXISTS "corrections_insert" ON corrections;

-- Create the secure RPC for submitting corrections
CREATE OR REPLACE FUNCTION submit_correction(
  p_operator_id UUID,
  p_pin TEXT,
  p_can_test_id UUID,
  p_old_values JSONB,
  p_new_values JSONB,
  p_reason TEXT
) 
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with privileges of the creator (bypassing RLS for the insert)
AS $$
DECLARE
  v_isValid BOOLEAN;
  v_correction_id UUID;
BEGIN
  -- 1. Validate Operator Identity & PIN
  SELECT EXISTS(
    SELECT 1 FROM operators WHERE id = p_operator_id AND pin = p_pin
  ) INTO v_isValid;

  IF NOT v_isValid THEN
    RAISE EXCEPTION 'Unauthorized: Invalid operator ID or PIN';
  END IF;

  -- 2. Validate that the can_test exists
  IF NOT EXISTS (SELECT 1 FROM can_tests WHERE id = p_can_test_id) THEN
    RAISE EXCEPTION 'Invalid request: Target can test does not exist';
  END IF;

  -- 3. Insert the correction (bypasses RLS due to SECURITY DEFINER)
  INSERT INTO corrections (can_test_id, old_values, new_values, corrected_by, reason)
  VALUES (p_can_test_id, p_old_values, p_new_values, p_operator_id, p_reason)
  RETURNING id INTO v_correction_id;

  RETURN jsonb_build_object('id', v_correction_id);
END;
$$;

COMMENT ON FUNCTION submit_correction IS 
  'Securely authorizes an operator via PIN and submits an immutable correction. Enforces authorization on the database side rather than trusting the client session.';

-- Grant execute to authenticated and anon users (the function itself verifies the PIN)
GRANT EXECUTE ON FUNCTION submit_correction TO authenticated, anon;
