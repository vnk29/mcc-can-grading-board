/**
 * TypeScript types matching the Supabase Postgres schema.
 *
 * These are the "database-layer" types — they use snake_case to match
 * column names exactly. The app-layer types in /types/index.ts use
 * camelCase and are what components consume.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export type CanDecision = 'accepted' | 'rejected'

export type ReasonCode =
  | 'LOW_FAT'
  | 'LOW_SNF'
  | 'HIGH_TEMPERATURE'
  | 'ADULTERATION_DETECTED'
  | 'OPERATOR_OVERRIDE'

export type SyncStatus = 'pending' | 'synced' | 'failed'

// ─── Operators ───────────────────────────────────────────────────────────────

export interface OperatorRow {
  id: string
  name: string
  pin: string
  created_at: string
}

export interface OperatorInsert {
  id?: string
  name: string
  pin: string
  created_at?: string
}

// ─── Farmers ─────────────────────────────────────────────────────────────────

export interface FarmerRow {
  id: string
  name: string
  phone: string | null
  village: string | null
  created_at: string
}

export interface FarmerInsert {
  id?: string
  name: string
  phone?: string | null
  village?: string | null
  created_at?: string
}

// ─── Can Tests ───────────────────────────────────────────────────────────────

export interface CanTestRow {
  id: string
  farmer_id: string
  operator_id: string
  can_volume: number
  fat_percent: number
  snf_percent: number
  temperature: number
  adulteration_result: boolean
  decision: CanDecision
  reason_codes: ReasonCode[]
  is_override: boolean
  override_reason: string | null
  reference_code: string
  photo_url: string | null
  created_at: string
  sync_status: SyncStatus
}

export interface CanTestInsert {
  id?: string
  farmer_id: string
  operator_id: string
  can_volume: number
  fat_percent: number
  snf_percent: number
  temperature: number
  adulteration_result: boolean
  decision: CanDecision
  reason_codes?: ReasonCode[]
  is_override?: boolean
  override_reason?: string | null
  reference_code: string
  photo_url?: string | null
  created_at?: string
  sync_status?: SyncStatus
}

// ─── Corrections ─────────────────────────────────────────────────────────────

export interface CorrectionRow {
  id: string
  can_test_id: string
  old_values: Record<string, unknown>
  new_values: Record<string, unknown>
  corrected_by: string
  reason: string
  created_at: string
}

export interface CorrectionInsert {
  id?: string
  can_test_id: string
  old_values: Record<string, unknown>
  new_values: Record<string, unknown>
  corrected_by: string
  reason: string
  created_at?: string
}

// ─── Joined / View Types ─────────────────────────────────────────────────────

/** A can test row joined with farmer and operator names (for display). */
export interface CanTestWithDetails extends CanTestRow {
  farmer: Pick<FarmerRow, 'name' | 'phone' | 'village'>
  operator: Pick<OperatorRow, 'name'>
}

/** A correction row joined with the correcting operator's name. */
export interface CorrectionWithOperator extends CorrectionRow {
  operator: Pick<OperatorRow, 'name'>
}

// ─── Supabase Database Type Map ──────────────────────────────────────────────

/**
 * Top-level type for use with supabase-js generic client:
 *   const supabase = createClient<Database>(url, key)
 */
export interface Database {
  public: {
    Tables: {
      operators: {
        Row: OperatorRow
        Insert: OperatorInsert
        Update: never  // No updates allowed by RLS
      }
      farmers: {
        Row: FarmerRow
        Insert: FarmerInsert
        Update: never  // Not currently needed
      }
      can_tests: {
        Row: CanTestRow
        Insert: CanTestInsert
        Update: never  // Immutable — enforced by RLS
      }
      corrections: {
        Row: CorrectionRow
        Insert: CorrectionInsert
        Update: never  // Append-only — enforced by RLS
      }
    }
  }
}
