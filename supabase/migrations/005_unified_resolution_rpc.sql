-- Migration 005: Unified Resolution RPC
-- Creates a single RPC that performs correction and dispute resolution in a single transaction block.

CREATE OR REPLACE FUNCTION public.resolve_dispute_with_correction(
  p_operator_id UUID,
  p_pin TEXT,
  p_can_test_id UUID,
  p_dispute_id UUID,
  p_new_values JSONB,
  p_reason TEXT,
  p_resolution_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actual_can_test_id UUID;
BEGIN
  SELECT can_test_id INTO v_actual_can_test_id FROM public.disputes WHERE id = p_dispute_id;
  IF v_actual_can_test_id IS NULL OR v_actual_can_test_id != p_can_test_id THEN
    RAISE EXCEPTION 'Dispute % does not match can_test %', p_dispute_id, p_can_test_id;
  END IF;

  -- Call existing submit_correction to handle PIN validation, diffing, and inserting the correction
  PERFORM public.submit_correction(p_operator_id, p_pin, p_can_test_id, p_new_values, p_reason);
  
  -- Call existing resolve_dispute to mark the dispute as resolved
  PERFORM public.resolve_dispute(p_operator_id, p_pin, p_dispute_id, p_resolution_type, 'Amended via Correction');
  
  RETURN jsonb_build_object('success', true);
END;
$$;
