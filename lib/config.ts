/**
 * Milk-quality limits for automatic can grading.
 *
 * Keep these values in one place so a chilling centre can tune its policy
 * without changing the grading algorithm.
 */
export const MIN_FAT_PERCENT = 3.5
export const MIN_SNF_PERCENT = 8.5
export const MAX_TEMPERATURE = 10

/**
 * A reading within these measurement-unit deltas of its pass/fail limit is
 * flagged for operator attention. These flags do not change the decision.
 */
export const FAT_BORDERLINE_DELTA = 0.1
export const SNF_BORDERLINE_DELTA = 0.1
export const TEMPERATURE_BORDERLINE_DELTA = 0.5
