/**
 * TypeScript types matching the Supabase Postgres schema.
 *
 * These are database-layer types — snake_case to match column names exactly.
 * Application/grading-layer types in lib/grading.ts use camelCase.
 *
 * ──────────────────────────────────────────────────────
 * TIMESTAMP MODEL
 *   test_performed_at  — when the physical test occurred on the device
 *                        (client-supplied). Correct for offline-queued tests.
 *                        Used on rejection slips, audit trail, and dispute views.
 *   created_at         — when the row arrived at the database (server-stamped,
 *                        DEFAULT now()). Cannot be backdated by the client.
 *
 * TEMPERATURE UNITS
 *   The `temperature` column stores the value in CELSIUS.
 *   In the application layer the field is named `temperatureC` to make the
 *   unit explicit. The mapping between the two names is in mapToDbInsert()
 *   in lib/grading.ts.
 *
 * IMMUTABILITY
 *   Update is typed as `never` for can_tests and corrections to make it
 *   impossible to accidentally build update queries against these tables.
 *
 * REASON CODES
 *   DbReasonCode  — codes that are safe to persist to Postgres.
 *   The grading engine (lib/grading.ts) also produces INVALID_* reason codes
 *   for missing/malformed inputs. Those must never be persisted; they are
 *   typed separately as InvalidReadingReasonCode in lib/grading.ts.
 * ──────────────────────────────────────────────────────
 */

// ─── Decision ─────────────────────────────────────────────────────────────────

export type CanDecision = 'accepted' | 'rejected'

// ─── Reason Codes ─────────────────────────────────────────────────────────────

/**
 * Reason codes that can be stored in the `reason_codes` column of can_tests.
 * This is the canonical persistable set — it does NOT include INVALID_* codes.
 *
 * INVALID_* codes are defensive codes emitted by the grading engine when inputs
 * are missing or malformed. They must be resolved (operator re-tests) before
 * the entry is persisted. They are typed as InvalidReadingReasonCode in
 * lib/grading.ts and are intentionally excluded from this database type.
 */
export type DbReasonCode =
  | 'LOW_FAT'
  | 'LOW_SNF'
  | 'HIGH_TEMPERATURE'
  | 'ADULTERATION_DETECTED'
  | 'OPERATOR_OVERRIDE'

/**
 * @deprecated Use DbReasonCode for database types.
 * Use GradingReasonCode (from lib/grading.ts) for grading engine outputs.
 *
 * This alias exists for backward compatibility with existing imports of
 * ReasonCode from this module and will be removed in a future cleanup.
 */
export type ReasonCode = DbReasonCode

// ─── Sync Status (client-side only, not stored in Postgres) ──────────────────

/**
 * Tracks the offline-queue state of a can test entry on the client.
 * This type is NOT stored in the Postgres database — it lives only in
 * IndexedDB (via idb-keyval) on the device.
 */
export type SyncStatus = 'pending' | 'synced' | 'failed'

// ─── Operators ───────────────────────────────────────────────────────────────

export type OperatorRow = {
  id: string
  name: string
  pin: string
  created_at: string
}

/** Operators are admin/seed-managed. The client API only reads them. */
export type OperatorInsert = {
  id?: string
  name: string
  pin: string
  created_at?: string
}

// ─── Farmers ─────────────────────────────────────────────────────────────────

export type FarmerRow = {
  id: string
  name: string
  phone: string | null
  village: string | null
  created_at: string
}

export type FarmerInsert = {
  id?: string
  name: string
  phone?: string | null
  village?: string | null
  created_at?: string
}

// ─── Can Tests ───────────────────────────────────────────────────────────────

export type CanTestRow = {
  id: string
  farmer_id: string
  operator_id: string
  can_volume: number
  fat_percent: number
  snf_percent: number
  /**
   * Temperature of the milk sample in CELSIUS.
   * Column name is unit-agnostic; the application-layer field is named
   * `temperatureC` (see CanTestAppEntry in lib/grading.ts) for clarity.
   */
  temperature: number
  adulteration_result: boolean
  /** Automatic grading result before any operator override. Null for legacy rows. */
  auto_decision: CanDecision | null
  decision: CanDecision
  /** Borderline status from the original grading evaluation. Null for legacy rows. */
  is_borderline: boolean | null
  /** Persistable reason codes only. Must not contain INVALID_* values. */
  reason_codes: DbReasonCode[]
  /** Reason codes indicating exactly which measurements were near limits. */
  borderline_flags: DbReasonCode[]
  is_override: boolean
  override_reason: string | null
  reference_code: string
  photo_url: string | null
  /** When the physical test was performed on the device (client-supplied). */
  test_performed_at: string
  /** When the row was inserted into the database (server-stamped). */
  created_at: string
}

export type CanTestInsert = {
  id?: string
  farmer_id: string
  operator_id: string
  can_volume: number
  fat_percent: number
  snf_percent: number
  /** Temperature in CELSIUS. Maps from app-layer field `temperatureC`. */
  temperature: number
  adulteration_result: boolean
  auto_decision: CanDecision
  decision: CanDecision
  is_borderline: boolean
  /** Must NOT contain INVALID_* codes — validate before calling. */
  reason_codes?: DbReasonCode[]
  borderline_flags?: DbReasonCode[]
  is_override?: boolean
  override_reason?: string | null
  reference_code: string
  photo_url?: string | null
  /** Must be provided by the client — represents actual test time on device. */
  test_performed_at: string
  created_at?: string  // server-stamped; omit to use DEFAULT now()
}

// ─── Corrections ─────────────────────────────────────────────────────────────

export type CorrectionRow = {
  id: string
  can_test_id: string
  old_values: Record<string, unknown>
  new_values: Record<string, unknown>
  corrected_by: string
  reason: string
  created_at: string
}

export type CorrectionInsert = {
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
  farmer: Pick<FarmerRow, 'name' | 'phone' | 'village'> | null
  operator: Pick<OperatorRow, 'name'> | null
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
export type Database = {
  public: {
    Tables: {
      operators: {
        Row: OperatorRow
        Insert: OperatorInsert
        Update: Partial<Omit<OperatorRow, 'id' | 'created_at'>>
        Relationships: []
      }
      farmers: {
        Row: FarmerRow
        Insert: FarmerInsert
        Update: Partial<Omit<FarmerRow, 'id' | 'created_at'>>
        Relationships: []
      }
      can_tests: {
        Row: CanTestRow
        Insert: CanTestInsert
        Update: never  // Immutable — enforced by Postgres RLS (no UPDATE policy)
        Relationships: [
          {
            foreignKeyName: "can_tests_farmer_id_fkey"
            columns: ["farmer_id"]
            referencedRelation: "farmers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "can_tests_operator_id_fkey"
            columns: ["operator_id"]
            referencedRelation: "operators"
            referencedColumns: ["id"]
          }
        ]
      }
      corrections: {
        Row: CorrectionRow
        Insert: CorrectionInsert
        Update: never  // Append-only — enforced by Postgres RLS
        Relationships: [
          {
            foreignKeyName: "corrections_can_test_id_fkey"
            columns: ["can_test_id"]
            referencedRelation: "can_tests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corrections_corrected_by_fkey"
            columns: ["corrected_by"]
            referencedRelation: "operators"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      submit_correction: {
        Args: {
          p_operator_id: string
          p_pin: string
          p_can_test_id: string

          p_new_values: Record<string, unknown>
          p_reason: string
        }
        Returns: { id: string }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
