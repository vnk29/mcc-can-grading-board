-- Migration 006: Operator Access Hardening
-- Resolves security audit finding by removing public select access to the raw operators table,
-- which previously exposed the `pin` column to any client querying `select(*)`.
-- Replaces it with a secure `operator_profiles` view.

-- 1. Create a safe view projecting only the necessary frontend fields
CREATE OR REPLACE VIEW public.operator_profiles AS
SELECT 
  id, 
  name, 
  created_at
FROM public.operators;

-- 2. Grant access to the view for anon and authenticated users
GRANT SELECT ON public.operator_profiles TO anon, authenticated;

-- 3. Revoke public SELECT access on the raw operators table
DROP POLICY IF EXISTS "operators_select" ON public.operators;
REVOKE SELECT ON public.operators FROM anon, authenticated;
