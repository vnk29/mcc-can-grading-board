/**
 * Shared TypeScript types for the Can Grading Board.
 *
 * These types are used across the app, Supabase schema, and offline queue.
 */

// ─── Identifiers ─────────────────────────────────────────────────────────────

export type Decision = 'ACCEPT' | 'REJECT'

export type ReasonCode =
  | 'LOW_FAT'
  | 'LOW_SNF'
  | 'HIGH_TEMPERATURE'
  | 'ADULTERATION_DETECTED'
  | 'OPERATOR_OVERRIDE'

export type SyncStatus = 'PENDING' | 'SYNCED' | 'FAILED'

// ─── Test Values ──────────────────────────────────────────────────────────────

export interface TestValues {
  fatPercent: number
  snfPercent: number
  temperatureCelsius: number
  adulterationPositive: boolean
}

// ─── Grading Thresholds ───────────────────────────────────────────────────────

export interface GradingThresholds {
  minFatPercent: number
  minSnfPercent: number
  maxTemperatureCelsius: number
  adulterationAllowed: boolean
}

// ─── Grading Result ───────────────────────────────────────────────────────────

export interface GradingResult {
  decision: Decision
  reasons: ReasonCode[]
  borderlineFlags: ReasonCode[]
  isBorderline: boolean
}

// ─── Core Domain ──────────────────────────────────────────────────────────────

export interface Farmer {
  id: string
  name: string
  villageName?: string
}

export interface Operator {
  id: string
  name: string
}

export interface CanTestEntry {
  /** UUID, generated client-side for idempotent offline sync */
  id: string

  /** Immutable timestamp set at the moment of entry creation */
  createdAt: string

  farmerId: string
  farmerName: string
  canId: string
  volumeLitres?: number

  operatorId: string
  operatorName: string

  testValues: TestValues
  gradingResult: GradingResult

  /** Final decision — may differ from gradingResult.decision if overridden */
  finalDecision: Decision

  /** Set if the operator overrode the auto-suggested decision */
  isOverride: boolean
  overrideReason?: string

  /** Short reference code for QR / dispute lookup (e.g. "MCC-20240115-A3F2") */
  referenceCode: string

  /** Optional photo evidence (URL or base64 data URL) */
  photoUrl?: string

  /** Sync state for offline queue */
  syncStatus: SyncStatus

  /** Device/session metadata for audit trail */
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
