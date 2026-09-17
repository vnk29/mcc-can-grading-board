-- Minimum secure correction for operator queue read access
-- The operator queue needs to query open and resolved disputes, joining with can_tests and farmers.
-- In the public/demo architecture, all reads are anonymous.

-- 1. Grant SQL SELECT privilege so the table appears in the schema cache (fixes PGRST205)
GRANT SELECT ON public.disputes TO anon, authenticated;

-- 2. Add an RLS policy to allow reading disputes. 
-- Since the operator queue has no secure session token, and the rest of the application
-- (can_tests, farmers, corrections) uses `USING (true)` for reads, this is the compatible approach.
CREATE POLICY "disputes_select" ON public.disputes
  FOR SELECT TO anon, authenticated USING (true);
