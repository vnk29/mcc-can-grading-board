-- ============================================================================
-- Seed Data for development / demo
-- 2 operators, 5 farmers, 10 can_tests (mixed decisions & edge cases)
--
-- NOTE: Operators are inserted here as part of the seed process.
-- The seed script runs as a superuser which bypasses RLS. In the live
-- application, operators can only be read — not created — via the client API.
--
-- All can_test override fields (override_reason, is_override) are supplied
-- directly in INSERT statements. No UPDATE statements are used — this mirrors
-- the insert-only immutability enforced by RLS in production.
-- ============================================================================

-- ─── OPERATORS ──────────────────────────────────────────────────────────────

INSERT INTO operators (id, name, pin) VALUES
  ('a1b2c3d4-0001-4000-8000-000000000001', 'Ramesh Kumar', '1234'),
  ('a1b2c3d4-0001-4000-8000-000000000002', 'Sunil Sharma',  '5678');

-- ─── FARMERS ────────────────────────────────────────────────────────────────

INSERT INTO farmers (id, name, phone, village) VALUES
  ('b2c3d4e5-0002-4000-8000-000000000001', 'Lakshmi Devi',  '9876543210', 'Rampur'),
  ('b2c3d4e5-0002-4000-8000-000000000002', 'Suresh Yadav',  '9876543211', 'Bakhtawarpur'),
  ('b2c3d4e5-0002-4000-8000-000000000003', 'Kamla Bai',     '9876543212', 'Chandpur'),
  ('b2c3d4e5-0002-4000-8000-000000000004', 'Mohan Singh',   '9876543213', 'Dharamkot'),
  ('b2c3d4e5-0002-4000-8000-000000000005', 'Anita Kumari',  '9876543214', 'Rampur');

-- ─── CAN TESTS ──────────────────────────────────────────────────────────────
-- Thresholds: Fat >= 3.5%, SNF >= 8.5%, Temp <= 10°C, Adulteration = false
--
-- test_performed_at = when the operator physically ran the test on the device.
-- created_at        = omitted here; the DB will DEFAULT it to now() on insert.
-- For seed data these will differ (seed runs later than the fictional test
-- time), which is intentional and models the offline-sync scenario.

-- 1. Clean accept — all values well within range
INSERT INTO can_tests (
  id, farmer_id, operator_id, can_volume,
  fat_percent, snf_percent, temperature, adulteration_result,
  decision, reason_codes, is_override, override_reason,
  reference_code, test_performed_at
) VALUES (
  'c3d4e5f6-0003-4000-8000-000000000001',
  'b2c3d4e5-0002-4000-8000-000000000001', 'a1b2c3d4-0001-4000-8000-000000000001',
  20, 4.2, 8.9, 6.5, false,
  'accepted', '{}', false, null,
  'MCC-20260915-A001', '2026-09-15 06:15:00+05:30'
);

-- 2. Clean accept — different farmer
INSERT INTO can_tests (
  id, farmer_id, operator_id, can_volume,
  fat_percent, snf_percent, temperature, adulteration_result,
  decision, reason_codes, is_override, override_reason,
  reference_code, test_performed_at
) VALUES (
  'c3d4e5f6-0003-4000-8000-000000000002',
  'b2c3d4e5-0002-4000-8000-000000000002', 'a1b2c3d4-0001-4000-8000-000000000001',
  15, 3.8, 8.7, 7.2, false,
  'accepted', '{}', false, null,
  'MCC-20260915-A002', '2026-09-15 06:18:00+05:30'
);

-- 3. Rejected — low fat
INSERT INTO can_tests (
  id, farmer_id, operator_id, can_volume,
  fat_percent, snf_percent, temperature, adulteration_result,
  decision, reason_codes, is_override, override_reason,
  reference_code, test_performed_at
) VALUES (
  'c3d4e5f6-0003-4000-8000-000000000003',
  'b2c3d4e5-0002-4000-8000-000000000003', 'a1b2c3d4-0001-4000-8000-000000000001',
  25, 2.8, 8.6, 8.0, false,
  'rejected', '{LOW_FAT}', false, null,
  'MCC-20260915-R003', '2026-09-15 06:22:00+05:30'
);

-- 4. Rejected — high temperature + adulteration detected (two reason codes)
INSERT INTO can_tests (
  id, farmer_id, operator_id, can_volume,
  fat_percent, snf_percent, temperature, adulteration_result,
  decision, reason_codes, is_override, override_reason,
  reference_code, test_performed_at
) VALUES (
  'c3d4e5f6-0003-4000-8000-000000000004',
  'b2c3d4e5-0002-4000-8000-000000000004', 'a1b2c3d4-0001-4000-8000-000000000002',
  18, 3.6, 8.5, 14.0, true,
  'rejected', '{HIGH_TEMPERATURE,ADULTERATION_DETECTED}', false, null,
  'MCC-20260915-R004', '2026-09-15 06:25:00+05:30'
);

-- 5. BORDERLINE — fat exactly at threshold (3.5%)
INSERT INTO can_tests (
  id, farmer_id, operator_id, can_volume,
  fat_percent, snf_percent, temperature, adulteration_result,
  decision, reason_codes, is_override, override_reason,
  reference_code, test_performed_at
) VALUES (
  'c3d4e5f6-0003-4000-8000-000000000005',
  'b2c3d4e5-0002-4000-8000-000000000005', 'a1b2c3d4-0001-4000-8000-000000000001',
  22, 3.5, 8.8, 9.0, false,
  'accepted', '{}', false, null,
  'MCC-20260915-B005', '2026-09-15 06:30:00+05:30'
);

-- 6. BORDERLINE — temperature exactly at threshold (10°C), SNF barely passing (8.51%)
INSERT INTO can_tests (
  id, farmer_id, operator_id, can_volume,
  fat_percent, snf_percent, temperature, adulteration_result,
  decision, reason_codes, is_override, override_reason,
  reference_code, test_performed_at
) VALUES (
  'c3d4e5f6-0003-4000-8000-000000000006',
  'b2c3d4e5-0002-4000-8000-000000000001', 'a1b2c3d4-0001-4000-8000-000000000002',
  20, 3.7, 8.51, 10.0, false,
  'accepted', '{}', false, null,
  'MCC-20260915-B006', '2026-09-15 06:35:00+05:30'
);

-- 7. OPERATOR OVERRIDE — auto-grading would reject (low SNF), operator accepts
--    All override fields supplied directly in INSERT. No post-insert UPDATE.
INSERT INTO can_tests (
  id, farmer_id, operator_id, can_volume,
  fat_percent, snf_percent, temperature, adulteration_result,
  decision, reason_codes, is_override, override_reason,
  reference_code, test_performed_at
) VALUES (
  'c3d4e5f6-0003-4000-8000-000000000007',
  'b2c3d4e5-0002-4000-8000-000000000002', 'a1b2c3d4-0001-4000-8000-000000000001',
  12, 4.0, 8.3, 7.5, false,
  'accepted', '{LOW_SNF}', true,
  'Instrument recalibrated — re-tested SNF reads 8.55%, within tolerance',
  'MCC-20260915-O007', '2026-09-15 06:40:00+05:30'
);

-- 8. Rejected — multiple failures (low fat + low SNF)
INSERT INTO can_tests (
  id, farmer_id, operator_id, can_volume,
  fat_percent, snf_percent, temperature, adulteration_result,
  decision, reason_codes, is_override, override_reason,
  reference_code, test_performed_at
) VALUES (
  'c3d4e5f6-0003-4000-8000-000000000008',
  'b2c3d4e5-0002-4000-8000-000000000003', 'a1b2c3d4-0001-4000-8000-000000000002',
  30, 2.1, 7.9, 8.0, false,
  'rejected', '{LOW_FAT,LOW_SNF}', false, null,
  'MCC-20260915-R008', '2026-09-15 06:45:00+05:30'
);

-- 9. Clean accept — afternoon shift, second operator
INSERT INTO can_tests (
  id, farmer_id, operator_id, can_volume,
  fat_percent, snf_percent, temperature, adulteration_result,
  decision, reason_codes, is_override, override_reason,
  reference_code, test_performed_at
) VALUES (
  'c3d4e5f6-0003-4000-8000-000000000009',
  'b2c3d4e5-0002-4000-8000-000000000004', 'a1b2c3d4-0001-4000-8000-000000000002',
  16, 4.5, 9.1, 5.0, false,
  'accepted', '{}', false, null,
  'MCC-20260915-A009', '2026-09-15 16:10:00+05:30'
);

-- 10. OPERATOR OVERRIDE — auto-grading would accept, operator rejects on visual grounds
--     All override fields supplied directly in INSERT. No post-insert UPDATE.
INSERT INTO can_tests (
  id, farmer_id, operator_id, can_volume,
  fat_percent, snf_percent, temperature, adulteration_result,
  decision, reason_codes, is_override, override_reason,
  reference_code, test_performed_at
) VALUES (
  'c3d4e5f6-0003-4000-8000-000000000010',
  'b2c3d4e5-0002-4000-8000-000000000005', 'a1b2c3d4-0001-4000-8000-000000000002',
  20, 3.9, 8.7, 8.5, false,
  'rejected', '{OPERATOR_OVERRIDE}', true,
  'Milk has unusual yellowish tint and off-smell — rejecting as precaution despite passing instrument tests',
  'MCC-20260915-O010', '2026-09-15 16:15:00+05:30'
);
