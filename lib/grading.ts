/**
 * ============================================================
 * CANONICAL GRADING ENGINE  —  lib/grading.ts
 * ============================================================
 *
 * This is the single source of truth for milk can quality evaluation.
 * lib/gradingLogic.ts is a compatibility re-export of this module;
 * it must not be used for new code.
 *
 * DATA FLOW
 *   form values (camelCase)
 *       ↓
 *   evaluateCanTest(CanTestInput)
 *       ↓
 *   CanTestEvaluation  (canonical grading result, camelCase)
 *       ↓
 *   mapToDbInsert()   (explicit app → database mapping, snake_case)
 *       ↓
 *   CanTestInsert     (Supabase row shape)
 *
 * NAMING CONVENTIONS
 *   - Application / grading layer: camelCase (temperatureC, fatPercent, …)
 *   - Database layer: snake_case  (temperature, fat_percent, …)
 *   - The mapping boundary is the mapToDbInsert() function in this file.
 *
 * TEMPERATURE UNITS
 *   All temperature values are CELSIUS throughout this module.
 *   Field names use the suffix C (temperatureC, MAX_TEMPERATURE_C) to
 *   make the unit explicit at every call site. No Fahrenheit conversion
 *   is provided or needed for this prototype.
 */

import {
  ACIDITY_BORDERLINE_DELTA,
  FAT_BORDERLINE_DELTA,
  MAX_ACIDITY_PERCENT,
  MAX_TEMPERATURE_C,
  MIN_FAT_PERCENT,
  MIN_SNF_PERCENT,
  SNF_BORDERLINE_DELTA,
  TEMPERATURE_BORDERLINE_DELTA,
} from '@/lib/config'
import type { CanDecision, CanTestInsert, DbReasonCode } from '@/types/database'

// ─── Input Types ─────────────────────────────────────────────────────────────

/**
 * Application-layer inputs to the grading engine.
 * All fields are camelCase. Temperature is explicitly Celsius.
 *
 * Using Partial<> here so the engine can defensively handle
 * incomplete form state and return INVALID_* reason codes rather than
 * throwing. The caller must validate that all fields are present before
 * persisting to the database.
 */
export interface CanTestInput {
  /** Volume of the can in litres. Must be finite and > 0. */
  canVolume?: number | null
  /** Fat content (percent by weight). Must be finite and non-negative. */
  fatPercent?: number | null
  /** Solids-Not-Fat content (percent by weight). Must be finite and non-negative. */
  snfPercent?: number | null
  /**
   * Temperature of the milk sample in CELSIUS.
   * Named with the C suffix to prevent unit confusion at call sites.
   */
  temperatureC?: number | null
  /** True when the adulteration test strip returns a positive result. */
  adulterationPositive?: boolean | null
  /** Acidity content (percent). Must be finite and non-negative. */
  acidityPercent?: number | null
  /** True when the sediment test returns a positive result. */
  sedimentDetected?: boolean | null
}

// ─── Result Types ─────────────────────────────────────────────────────────────

/**
 * Reason codes returned by the grading engine.
 *
 * DbReasonCode covers the codes that can be persisted to the database.
 * InvalidReadingReasonCode covers defensive codes for missing/malformed inputs;
 * these must NOT be persisted — they signal that the operator needs to retest.
 *
 * GradingReasonCode is the union used within the engine output.
 */
export type InvalidReadingReasonCode =
  | 'INVALID_VOLUME'
  | 'INVALID_FAT_PERCENT'
  | 'INVALID_FAT_PERCENT_RANGE'
  | 'INVALID_SNF_PERCENT'
  | 'INVALID_SNF_PERCENT_RANGE'
  | 'INVALID_TEMPERATURE'
  | 'INVALID_TEMPERATURE_RANGE'
  | 'INVALID_ADULTERATION_RESULT'
  | 'INVALID_ACIDITY'
  | 'INVALID_SEDIMENT_RESULT'

/** All reason codes the grading engine can return. */
export type GradingReasonCode = DbReasonCode | InvalidReadingReasonCode

/**
 * Result of evaluating one can's quality readings.
 * All fields are camelCase (application layer).
 */
export interface CanTestEvaluation {
  /** 'accepted' or 'rejected'. Lowercase to match the database canonical value. */
  decision: CanDecision
  /**
   * All reason codes that contributed to the decision.
   * May include INVALID_* codes if inputs were missing or malformed.
   * The caller must ensure no INVALID_* codes remain before persisting.
   */
  reasonCodes: GradingReasonCode[]
  /**
   * True when any quality reading is within the borderline detection window
   * of its threshold. Does not change the accept/reject decision —
   * used only to prompt the operator to double-check the reading.
   */
  isBorderline: boolean
  /**
   * The specific reason codes (e.g. 'LOW_FAT') that triggered the borderline flag.
   */
  borderlineFlags: GradingReasonCode[]
  /** Convenience: true if any INVALID_* reason code is present. */
  hasInvalidReadings: boolean
}

// ─── Human-Readable Labels ───────────────────────────────────────────────────

export const REASON_LABELS: Record<GradingReasonCode, string> = {
  // DB Codes
  LOW_FAT: 'Low fat percentage',
  LOW_SNF: 'Low SNF percentage',
  HIGH_TEMPERATURE: 'Temperature above limit',
  ADULTERATION_DETECTED: 'Adulteration detected',
  HIGH_ACIDITY: 'High acidity detected',
  SEDIMENT_DETECTED: 'Sediment detected',
  OPERATOR_OVERRIDE: 'Operator override',
  
  // Invalid Input Codes
  INVALID_VOLUME: 'Volume must be greater than 0',
  INVALID_FAT_PERCENT: 'Fat % must be a number',
  INVALID_FAT_PERCENT_RANGE: 'Fat % must be between 0.1 and 15',
  INVALID_SNF_PERCENT: 'SNF % must be a number',
  INVALID_SNF_PERCENT_RANGE: 'SNF % must be between 4 and 15',
  INVALID_TEMPERATURE: 'Temperature must be a number',
  INVALID_TEMPERATURE_RANGE: 'Temperature must be between 0°C and 40°C',
  INVALID_ADULTERATION_RESULT: 'Adulteration result is required',
  INVALID_ACIDITY: 'Acidity % must be a number',
  INVALID_SEDIMENT_RESULT: 'Sediment result is required'
}

// ─── Precision-Safe Numeric Helpers ──────────────────────────────────────────

/**
 * A valid instrument reading must be a finite, non-negative number.
 * NaN, Infinity, negative values, null, undefined, and non-numbers
 * cannot be relied on for a quality decision and cause a safe rejection.
 */
function isValidReading(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * Precision-safe borderline detection.
 *
 * Naive floating-point subtraction in JavaScript produces small rounding
 * errors. For example:
 *   3.6 - 3.5  =>  0.09999999999999964  (not exactly 0.1)
 *   2.5 - 2.4  =>  0.09999999999999787
 *
 * When a delta is expressed in the same decimal magnitude as the values
 * being compared, these errors can cause a reading that is exactly on the
 * borderline to incorrectly appear outside it (or vice versa).
 *
 * The fix: round both operands to a safe number of decimal places before
 * comparing. We use 6 significant decimal places — more than enough for
 * milk quality measurements while still catching real differences.
 *
 * The PRECISION constant is the number of decimal places to round to.
 */
const PRECISION = 6

function roundTo(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/**
 * Returns true if `value` is within `delta` of `threshold` on either side.
 *
 * Uses PRECISION-rounded arithmetic to avoid JavaScript floating-point
 * errors at decimal boundary values like 3.5, 8.5, 10.0, etc.
 */
function isNearThreshold(value: number, threshold: number, delta: number): boolean {
  const distance = roundTo(Math.abs(value - threshold), PRECISION)
  return distance <= delta
}

// ─── Canonical Grading Evaluator ─────────────────────────────────────────────

/**
 * Deterministically grade one can's quality readings.
 *
 * Rules are evaluated in a fixed order (fat → SNF → temperature →
 * adulteration) so every applicable rejection reason is always reported.
 *
 * This function is pure: it reads no external state, so identical inputs
 * always produce identical outputs. It is safe to call multiple times.
 *
 * @param values - The quality readings from the form (application camelCase).
 * @returns A CanTestEvaluation with decision, reason codes, and borderline flag.
 */
export function evaluateCanTest(
  values: CanTestInput | null | undefined,
): CanTestEvaluation {
  const reasonCodes: GradingReasonCode[] = []
  const borderlineFlags: GradingReasonCode[] = []
  let isBorderline = false

  // ── Volume ─────────────────────────────────────────────────────────────────
  const canVolume = values?.canVolume
  if (!isValidReading(canVolume) || canVolume <= 0) {
    reasonCodes.push('INVALID_VOLUME')
  }

  // ── Fat % ──────────────────────────────────────────────────────────────────
  const fatPercent = values?.fatPercent
  if (!isValidReading(fatPercent)) {
    reasonCodes.push('INVALID_FAT_PERCENT')
  } else if (fatPercent < 0.1 || fatPercent > 15) {
    reasonCodes.push('INVALID_FAT_PERCENT_RANGE')
  } else {
    if (fatPercent < MIN_FAT_PERCENT) {
      // Fat below the minimum means the can does not meet the centre's richness standard.
      reasonCodes.push('LOW_FAT')
    }
    if (isNearThreshold(fatPercent, MIN_FAT_PERCENT, FAT_BORDERLINE_DELTA)) {
      // Reading is within instrument tolerance of the threshold — flag for review.
      isBorderline = true
      borderlineFlags.push('LOW_FAT')
    }
  }

  // ── SNF % ──────────────────────────────────────────────────────────────────
  const snfPercent = values?.snfPercent
  if (!isValidReading(snfPercent)) {
    reasonCodes.push('INVALID_SNF_PERCENT')
  } else if (snfPercent < 4 || snfPercent > 15) {
    reasonCodes.push('INVALID_SNF_PERCENT_RANGE')
  } else {
    if (snfPercent < MIN_SNF_PERCENT) {
      // Insufficient solids-not-fat indicates the milk may be watered down.
      reasonCodes.push('LOW_SNF')
    }
    if (isNearThreshold(snfPercent, MIN_SNF_PERCENT, SNF_BORDERLINE_DELTA)) {
      isBorderline = true
      borderlineFlags.push('LOW_SNF')
    }
  }

  // ── Temperature (°C) ───────────────────────────────────────────────────────
  const temperatureC = values?.temperatureC
  if (!isValidReading(temperatureC)) {
    reasonCodes.push('INVALID_TEMPERATURE')
  } else if (temperatureC < 0 || temperatureC > 40) {
    reasonCodes.push('INVALID_TEMPERATURE_RANGE')
  } else {
    if (temperatureC > MAX_TEMPERATURE_C) {
      // Milk warmer than the maximum deteriorates more quickly and must be rejected.
      reasonCodes.push('HIGH_TEMPERATURE')
    }
    if (isNearThreshold(temperatureC, MAX_TEMPERATURE_C, TEMPERATURE_BORDERLINE_DELTA)) {
      isBorderline = true
      borderlineFlags.push('HIGH_TEMPERATURE')
    }
  }

  // ── Adulteration ───────────────────────────────────────────────────────────
  const adulterationPositive = values?.adulterationPositive
  if (typeof adulterationPositive !== 'boolean') {
    reasonCodes.push('INVALID_ADULTERATION_RESULT')
  } else if (adulterationPositive) {
    // Any positive adulteration result is unsafe and always causes rejection.
    reasonCodes.push('ADULTERATION_DETECTED')
  }

  // ── Acidity ────────────────────────────────────────────────────────────────
  const acidityPercent = values?.acidityPercent
  if (!isValidReading(acidityPercent)) {
    reasonCodes.push('INVALID_ACIDITY')
  } else {
    if (acidityPercent > MAX_ACIDITY_PERCENT) {
      reasonCodes.push('HIGH_ACIDITY')
    }
    if (isNearThreshold(acidityPercent, MAX_ACIDITY_PERCENT, ACIDITY_BORDERLINE_DELTA)) {
      isBorderline = true
      borderlineFlags.push('HIGH_ACIDITY')
    }
  }

  // ── Sediment ───────────────────────────────────────────────────────────────
  const sedimentDetected = values?.sedimentDetected
  if (typeof sedimentDetected !== 'boolean') {
    reasonCodes.push('INVALID_SEDIMENT_RESULT')
  } else if (sedimentDetected) {
    reasonCodes.push('SEDIMENT_DETECTED')
  }

  const hasInvalidReadings = reasonCodes.some((c) => c.startsWith('INVALID_'))

  return {
    decision: reasonCodes.length === 0 ? 'accepted' : 'rejected',
    reasonCodes,
    isBorderline,
    borderlineFlags,
    hasInvalidReadings,
  }
}

// ─── App → Database Mapping Layer ────────────────────────────────────────────

/**
 * Application-layer representation of a can test entry.
 * All fields are camelCase. This is what the form/UI works with.
 * Converted to CanTestInsert (snake_case) before persisting to Supabase.
 */
export interface CanTestAppEntry {
  id: string
  farmerId: string
  operatorId: string
  /** Volume of the milk can in litres. */
  canVolume: number
  /** Fat content in percent. */
  fatPercent: number
  /** Solids-Not-Fat in percent. */
  snfPercent: number
  /** Temperature in CELSIUS. Named with C suffix for clarity. */
  temperatureC: number
  adulterationPositive: boolean
  acidityPercent?: number
  sedimentDetected?: boolean
  /** Automatic decision before any operator override. */
  autoDecision: CanDecision
  decision: CanDecision
  /** Borderline status from the canonical evaluation before persistence. */
  isBorderline: boolean
  /** Reason codes that will be persisted. Must NOT contain INVALID_* codes. */
  reasonCodes: DbReasonCode[]
  /** Reason codes indicating exactly which measurements were near limits. */
  borderlineFlags: DbReasonCode[]
  isOverride: boolean
  overrideReason: string | null
  referenceCode: string
  photoUrl: string | null
  evidenceType: 'photo' | 'sensory' | null
  sensoryNote: string | null
  /** ISO string: when the physical test was performed on the device. */
  testPerformedAt: string
}

/**
 * Explicit mapping from the application-layer entry (camelCase) to the
 * Supabase insert shape (snake_case).
 *
 * This is the ONLY place where application values become database values.
 * The grading engine and form layer must never use snake_case field names.
 *
 * Note: temperatureC maps to the database column `temperature`.
 * The column stores Celsius; the app-layer name makes the unit explicit.
 */
export function mapToDbInsert(entry: CanTestAppEntry): CanTestInsert {
  return {
    id: entry.id,
    farmer_id: entry.farmerId,
    operator_id: entry.operatorId,
    can_volume: entry.canVolume,
    fat_percent: entry.fatPercent,
    snf_percent: entry.snfPercent,
    temperature: entry.temperatureC,     // °C — column name is unit-agnostic; app name is explicit
    adulteration_result: entry.adulterationPositive,
    auto_decision: entry.autoDecision,
    decision: entry.decision,
    is_borderline: entry.isBorderline,
    reason_codes: entry.reasonCodes,
    borderline_flags: entry.borderlineFlags,
    is_override: entry.isOverride,
    override_reason: entry.overrideReason,
    reference_code: entry.referenceCode,
    photo_url: entry.photoUrl,
    evidence_type: entry.evidenceType,
    sensory_note: entry.sensoryNote,
    test_performed_at: entry.testPerformedAt,
    // created_at is omitted — the database DEFAULT now() stamps it on arrival.
  }
}
