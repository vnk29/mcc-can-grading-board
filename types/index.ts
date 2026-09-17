/**
 * Shared application-layer TypeScript types for the Can Grading Board.
 *
 * These types are camelCase and used by UI components, the offline queue,
 * and the grading engine. Database-layer types (snake_case) live in
 * /types/database.ts and are only used at the Supabase boundary.
 */

// ─── Re-export canonical types from their authoritative sources ───────────────

// The canonical decision type lives in database.ts because the database schema
// defines the allowed values ('accepted' | 'rejected'). Re-exported here for
// convenience so other modules don't need two imports.
export type { CanDecision as Decision, DbReasonCode as ReasonCode, SyncStatus } from '@/types/database'

// ─── Test Values (application layer, camelCase) ───────────────────────────────

/**
 * Quality readings from a single can test.
 * All fields are camelCase. Temperature is CELSIUS — named with C suffix.
 *
 * This is the application-layer shape. The database layer stores these
 * in snake_case columns (see CanTestRow in /types/database.ts).
 */
export interface TestValues {
  fatPercent: number
  snfPercent: number
  /**
   * Temperature of the milk sample in CELSIUS.
   * Named with C suffix to make the unit explicit at every call site.
   */
  temperatureC: number
  adulterationPositive: boolean
  acidityPercent?: number
  sedimentDetected?: boolean
}

// ─── Grading Thresholds ───────────────────────────────────────────────────────

/** Configurable quality thresholds for a chilling centre. */
export interface GradingThresholds {
  minFatPercent: number
  minSnfPercent: number
  /** Maximum acceptable temperature in CELSIUS. */
  maxTemperatureC: number
  adulterationAllowed: boolean
}

// ─── Core Domain ──────────────────────────────────────────────────────────────

export interface Farmer {
  id: string
  name: string
  phone?: string
  villageName?: string
}

export interface Operator {
  id: string
  name: string
}

/**
 * A complete can test entry as held in the application / IndexedDB queue.
 * Uses camelCase throughout. Converted to CanTestInsert (snake_case) by
 * mapToDbInsert() in lib/grading.ts before being sent to Supabase.
 */
export interface CanTestEntry {
  /** UUID generated client-side for idempotent offline sync. */
  id: string

  farmerId: string
  farmerName: string
  canVolume?: number

  operatorId: string
  operatorName: string

  /** Raw test readings — what the instrument produced. */
  fatPercent: number
  snfPercent: number
  /** Temperature in CELSIUS. */
  temperatureC: number
  adulterationPositive: boolean
  acidityPercent?: number
  sedimentDetected?: boolean

  /** Auto-graded decision before any operator override. */
  autoDecision: 'accepted' | 'rejected'
  /** Reason codes from auto-grading. */
  reasonCodes: import('@/types/database').DbReasonCode[]
  /** Whether any reading was near a threshold. */
  isBorderline: boolean
  borderlineFlags: import('@/types/database').DbReasonCode[]

  /** Final decision — may differ from autoDecision if operator overrides. */
  finalDecision: 'accepted' | 'rejected'
  isOverride: boolean
  overrideReason?: string

  /** Short reference code for QR / dispute lookup (e.g. "MCC-20260915-A3F2"). */
  referenceCode: string

  /** Optional photo evidence (URL or base64 data URL). */
  photoUrl?: string
  
  evidenceType?: 'photo' | 'sensory' | null
  sensoryNote?: string | null

  /** ISO string: when the physical test was performed on the device. */
  testPerformedAt: string

  /** Client-side sync state — NOT stored in Postgres. */
  syncStatus: 'pending' | 'synced' | 'failed'

  /** ISO timestamp of when the entry was enqueued locally. Used for sort order during sync. */
  queuedAt: string

  /** Device/session metadata for audit trail. */
  deviceInfo?: string
}

// ─── Correction Record ────────────────────────────────────────────────────────

/** Supervisor-only correction. Both old and new values are stored. */
export interface CorrectionRecord {
  id: string
  originalEntryId: string
  correctedAt: string
  supervisorId: string
  oldValues: Partial<CanTestEntry>
  newValues: Partial<CanTestEntry>
  correctionReason: string
}
