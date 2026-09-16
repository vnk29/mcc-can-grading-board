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
CREATE OR REPLACE FUNCTION public.submit_correction(
  p_operator_id UUID,
  p_pin TEXT,
  p_can_test_id UUID,
  p_new_values JSONB,
  p_reason TEXT
) 
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with privileges of the creator (bypassing RLS for the insert)
SET search_path = public, pg_temp
AS $$
DECLARE
  v_isValid BOOLEAN;
  v_correction_id UUID;
  v_old_values JSONB;
BEGIN
  -- 1. Validate Operator Identity & PIN
  SELECT EXISTS(
    SELECT 1 FROM public.operators WHERE id = p_operator_id AND pin = p_pin
  ) INTO v_isValid;

  IF NOT v_isValid THEN
    RAISE EXCEPTION 'Unauthorized: Invalid operator ID or PIN';
  END IF;

  -- 2. Validate that the can_test exists and capture old_values
  SELECT to_jsonb(t.*) INTO v_old_values
  FROM public.can_tests t WHERE id = p_can_test_id;

  IF v_old_values IS NULL THEN
    RAISE EXCEPTION 'Invalid request: Target can test does not exist';
  END IF;

  -- 3. Validate new_values keys, types, and ranges
  -- Reject empty objects
  IF p_new_values IS NULL OR p_new_values = '{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid request: p_new_values must not be empty';
  END IF;

  -- Expected fields for a correction are farmer_id, can_volume, fat_percent,
  -- snf_percent, temperature, and decision. Reject any unexpected fields.
  IF (p_new_values - array['farmer_id', 'can_volume', 'fat_percent', 'snf_percent', 'temperature', 'decision']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid request: p_new_values contains unpermitted fields';
  END IF;

  -- Validate farmer_id type
  IF p_new_values ? 'farmer_id' THEN
    IF jsonb_typeof(p_new_values->'farmer_id') <> 'string' THEN
      RAISE EXCEPTION 'Invalid request: farmer_id must be a string';
    END IF;
  END IF;

  -- Validate can_volume type and range (> 0)
  IF p_new_values ? 'can_volume' THEN
    IF jsonb_typeof(p_new_values->'can_volume') <> 'number' OR (p_new_values->>'can_volume')::numeric <= 0 THEN
      RAISE EXCEPTION 'Invalid request: can_volume must be a positive number';
    END IF;
  END IF;

  -- Validate fat_percent type and range (0 to 100)
  IF p_new_values ? 'fat_percent' THEN
    IF jsonb_typeof(p_new_values->'fat_percent') <> 'number' OR (p_new_values->>'fat_percent')::numeric < 0 OR (p_new_values->>'fat_percent')::numeric > 100 THEN
      RAISE EXCEPTION 'Invalid request: fat_percent must be a number between 0 and 100';
    END IF;
  END IF;

  -- Validate snf_percent type and range (0 to 100)
  IF p_new_values ? 'snf_percent' THEN
    IF jsonb_typeof(p_new_values->'snf_percent') <> 'number' OR (p_new_values->>'snf_percent')::numeric < 0 OR (p_new_values->>'snf_percent')::numeric > 100 THEN
      RAISE EXCEPTION 'Invalid request: snf_percent must be a number between 0 and 100';
    END IF;
  END IF;

  -- Validate temperature type and range (0 to 40)
  IF p_new_values ? 'temperature' THEN
    IF jsonb_typeof(p_new_values->'temperature') <> 'number' OR (p_new_values->>'temperature')::numeric < 0 OR (p_new_values->>'temperature')::numeric > 40 THEN
      RAISE EXCEPTION 'Invalid request: temperature must be a number between 0 and 40';
    END IF;
  END IF;

  -- Validate decision type and allowed values
  IF p_new_values ? 'decision' THEN
    IF jsonb_typeof(p_new_values->'decision') <> 'string' OR p_new_values->>'decision' NOT IN ('accepted', 'rejected') THEN
      RAISE EXCEPTION 'Invalid request: decision must be either accepted or rejected';
    END IF;
  END IF;

  -- 4. Insert the correction (bypasses RLS due to SECURITY DEFINER)
  INSERT INTO public.corrections (can_test_id, old_values, new_values, corrected_by, reason)
  VALUES (p_can_test_id, v_old_values, p_new_values, p_operator_id, p_reason)
  RETURNING id INTO v_correction_id;

  RETURN jsonb_build_object('id', v_correction_id);
END;
$$;

COMMENT ON FUNCTION public.submit_correction IS 
  'Securely authorizes an operator via PIN and submits an immutable correction. Enforces authorization on the database side rather than trusting the client session.';

-- Grant execute to authenticated and anon users (the function itself verifies the PIN)
REVOKE EXECUTE ON FUNCTION public.submit_correction FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_correction TO authenticated, anon;
