/**
 * Grading logic for milk can quality assessment.
 *
 * Thresholds are configurable per chilling center.
 * Operators have final override authority but must provide a reason.
 */

import type { GradingThresholds, TestValues, GradingResult, ReasonCode } from '@/types'

/** Default thresholds — override via center configuration in Supabase. */
export const DEFAULT_THRESHOLDS: GradingThresholds = {
  minFatPercent: 3.5,
  minSnfPercent: 8.5,
  maxTemperatureCelsius: 10,
  adulterationAllowed: false,
}

/**
 * Evaluate test values against thresholds and return a grading result.
 * Result carries a decision (ACCEPT | REJECT), reason codes for any failures,
 * and a flag indicating whether values are borderline (near threshold).
 */
export function gradeCanEntry(
  values: TestValues,
  thresholds: GradingThresholds = DEFAULT_THRESHOLDS,
): GradingResult {
  const reasons: ReasonCode[] = []
  const borderline: ReasonCode[] = []

  const BORDERLINE_MARGIN = 0.1 // within 10% of threshold → flag as borderline

  // Fat %
  if (values.fatPercent < thresholds.minFatPercent) {
    reasons.push('LOW_FAT')
  } else if (values.fatPercent < thresholds.minFatPercent * (1 + BORDERLINE_MARGIN)) {
    borderline.push('LOW_FAT')
  }

  // SNF %
  if (values.snfPercent < thresholds.minSnfPercent) {
    reasons.push('LOW_SNF')
  } else if (values.snfPercent < thresholds.minSnfPercent * (1 + BORDERLINE_MARGIN)) {
    borderline.push('LOW_SNF')
  }

  // Temperature
  if (values.temperatureCelsius > thresholds.maxTemperatureCelsius) {
    reasons.push('HIGH_TEMPERATURE')
  } else if (
    values.temperatureCelsius >
    thresholds.maxTemperatureCelsius * (1 - BORDERLINE_MARGIN)
  ) {
    borderline.push('HIGH_TEMPERATURE')
  }

  // Adulteration
  if (values.adulterationPositive && !thresholds.adulterationAllowed) {
    reasons.push('ADULTERATION_DETECTED')
  }

  const decision = reasons.length > 0 ? 'REJECT' : 'ACCEPT'

  return {
    decision,
    reasons,
    borderlineFlags: borderline,
    isBorderline: borderline.length > 0,
  }
}
