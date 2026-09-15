-- Create the table for can test entries
CREATE TABLE can_test_entries (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  farmer_id TEXT NOT NULL,
  farmer_name TEXT NOT NULL,
  can_id TEXT NOT NULL,
  volume_litres NUMERIC,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  
  -- Test Values
  fat_percent NUMERIC NOT NULL,
  snf_percent NUMERIC NOT NULL,
  temperature_celsius NUMERIC NOT NULL,
  adulteration_positive BOOLEAN NOT NULL,
  
  -- Grading Results
  decision TEXT NOT NULL,
  final_decision TEXT NOT NULL,
  is_override BOOLEAN NOT NULL DEFAULT FALSE,
  override_reason TEXT,
  reference_code TEXT NOT NULL UNIQUE,
  photo_url TEXT,
  device_info TEXT,
  sync_status TEXT NOT NULL DEFAULT 'SYNCED'
);

-- Enable Row Level Security (RLS)
ALTER TABLE can_test_entries ENABLE ROW LEVEL SECURITY;

-- Create an "insert-only" policy to enforce immutability!
-- This ensures that once a record is created, it cannot be modified or deleted.
CREATE POLICY "Allow inserts from anyone" ON can_test_entries FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Allow reads from anyone" ON can_test_entries FOR SELECT TO public USING (true);
