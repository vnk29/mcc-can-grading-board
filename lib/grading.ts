import {
  FAT_BORDERLINE_DELTA,
  MAX_TEMPERATURE,
  MIN_FAT_PERCENT,
  MIN_SNF_PERCENT,
  SNF_BORDERLINE_DELTA,
  TEMPERATURE_BORDERLINE_DELTA,
} from '@/lib/config'
import type { CanDecision, CanTestInsert, ReasonCode } from '@/types/database'

/** The quality fields required to grade a can before it is inserted. */
export type CanTestValues = Partial<
  Pick<
    CanTestInsert,
    'fat_percent' | 'snf_percent' | 'temperature' | 'adulteration_result'
  >
>

/**
 * Invalid readings are never suitable for persistence, but are returned as
 * explicit rejection reasons so a caller can ask the operator to retest.
 */
export type InvalidReadingReasonCode =
  | 'INVALID_FAT_PERCENT'
  | 'INVALID_SNF_PERCENT'
  | 'INVALID_TEMPERATURE'
  | 'INVALID_ADULTERATION_RESULT'

export type GradingReasonCode = ReasonCode | InvalidReadingReasonCode

export interface CanTestEvaluation {
  decision: CanDecision
  reasonCodes: GradingReasonCode[]
  isBorderline: boolean
}

/**
 * A valid instrument reading is finite and non-negative. NaN, infinity,
 * missing values, strings, and negative values cannot be relied on for a
 * quality decision and therefore cause a safe rejection.
 */
function isValidReading(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * A result is borderline when it is close to a configured pass/fail boundary
 * on either side. This keeps a narrowly failing result visible for review
 * without weakening the quality rule or changing a passing result to rejected.
 */
function isNearThreshold(value: number, threshold: number, delta: number): boolean {
  return Math.abs(value - threshold) <= delta
}

/**
 * Deterministically grade one can's quality readings.
 *
 * Rules are always evaluated in the same order (fat, SNF, temperature, then
 * adulteration), allowing every applicable rejection reason to be reported.
 * The function reads no UI or external state, so identical inputs always
 * produce identical results.
 */
export function evaluateCanTest(
  values: CanTestValues | null | undefined,
): CanTestEvaluation {
  const reasonCodes: GradingReasonCode[] = []
  let isBorderline = false

  const fatPercent = values?.fat_percent
  if (!isValidReading(fatPercent)) {
    reasonCodes.push('INVALID_FAT_PERCENT')
  } else {
    // Fat below the minimum means the can does not meet the centre's richness standard.
    if (fatPercent < MIN_FAT_PERCENT) {
      reasonCodes.push('LOW_FAT')
    }

    // Readings within the configured instrument tolerance merit operator review.
    if (isNearThreshold(fatPercent, MIN_FAT_PERCENT, FAT_BORDERLINE_DELTA)) {
      isBorderline = true
    }
  }

  const snfPercent = values?.snf_percent
  if (!isValidReading(snfPercent)) {
    reasonCodes.push('INVALID_SNF_PERCENT')
  } else {
    // SNF below the minimum indicates insufficient solids other than fat.
    if (snfPercent < MIN_SNF_PERCENT) {
      reasonCodes.push('LOW_SNF')
    }

    // Near-limit SNF readings can vary with sampling and device precision.
    if (isNearThreshold(snfPercent, MIN_SNF_PERCENT, SNF_BORDERLINE_DELTA)) {
      isBorderline = true
    }
  }

  const temperature = values?.temperature
  if (!isValidReading(temperature)) {
    reasonCodes.push('INVALID_TEMPERATURE')
  } else {
    // Milk warmer than the maximum can deteriorate more quickly, so it is rejected.
    if (temperature > MAX_TEMPERATURE) {
      reasonCodes.push('HIGH_TEMPERATURE')
    }

    // Temperatures close to the limit need attention even when still acceptable.
    if (isNearThreshold(temperature, MAX_TEMPERATURE, TEMPERATURE_BORDERLINE_DELTA)) {
      isBorderline = true
    }
  }

  const adulterationResult = values?.adulteration_result
  if (typeof adulterationResult !== 'boolean') {
    reasonCodes.push('INVALID_ADULTERATION_RESULT')
  } else if (adulterationResult) {
    // Any positive adulteration result is unsafe for acceptance and always rejects.
    reasonCodes.push('ADULTERATION_DETECTED')
  }

  return {
    decision: reasonCodes.length === 0 ? 'accepted' : 'rejected',
    reasonCodes,
    isBorderline,
  }
}
