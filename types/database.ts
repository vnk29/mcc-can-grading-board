/**
 * TypeScript types matching the Supabase Postgres schema.
 *
 * These are database-layer types — snake_case to match column names exactly.
 * App-layer/component types in /types/index.ts use camelCase.
 *
 * TIMESTAMP MODEL
 *   test_performed_at — when the physical test occurred on the device (client-
 *                       supplied). Correct even for offline-queued tests. Used
 *                       on rejection slips, audit trail, and dispute views.
 *   created_at        — when the row arrived at the database (server-stamped,
 *                       DEFAULT now()). Cannot be backdated by the client.
 *
 * IMMUTABILITY
 *   Update is typed as `never` for can_tests and corrections to make it
 *   impossible to accidentally build update queries against these tables.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export type CanDecision = 'accepted' | 'rejected'

export type ReasonCode =
  | 'LOW_FAT'
  | 'LOW_SNF'
  | 'HIGH_TEMPERATURE'
  | 'ADULTERATION_DETECTED'
  | 'OPERATOR_OVERRIDE'

// sync_status is client-side (IndexedDB) metadata only — not stored in Postgres.
export type SyncStatus = 'pending' | 'synced' | 'failed'

// ─── Operators ───────────────────────────────────────────────────────────────

export interface OperatorRow {
  id: string
  name: string
  pin: string
  created_at: string
}

/** Operators are admin/seed-managed. The client API only reads them. */
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
  /** When the physical test was performed on the device (client-supplied). */
  test_performed_at: string
  /** When the row was inserted into the database (server-stamped). */
  created_at: string
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
  /** Must be provided by the client — represents actual test time on device. */
  test_performed_at: string
  created_at?: string  // server-stamped; omit to use DEFAULT now()
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
 * Top-level type for the supabase-js generic client:
 *   const supabase = createClient<Database>(url, key)
 *
 * Update is `never` on can_tests and corrections — these tables are
 * insert-only. Any attempt to build an `.update()` query against them
 * will be caught at compile time.
 */
export interface Database {
  public: {
    Tables: {
      operators: {
        Row: OperatorRow
        Insert: OperatorInsert
        Update: Partial<Omit<OperatorRow, 'id' | 'created_at'>>
      }
      farmers: {
        Row: FarmerRow
        Insert: FarmerInsert
        Update: Partial<Omit<FarmerRow, 'id' | 'created_at'>>
      }
      can_tests: {
        Row: CanTestRow
        Insert: CanTestInsert
        Update: never  // Immutable — enforced by RLS (no UPDATE policy)
      }
      corrections: {
        Row: CorrectionRow
        Insert: CorrectionInsert
        Update: never  // Append-only — enforced by RLS (no UPDATE policy)
      }
    }
  }
}
