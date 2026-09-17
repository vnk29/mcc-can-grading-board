/**
 * Milk-quality thresholds for automatic can grading.
 *
 * All temperature values are in degrees CELSIUS. This prototype does not
 * support Fahrenheit. Temperature fields throughout the application are named
 * temperatureC / MAX_TEMPERATURE_C to make this explicit at every call site.
 *
 * Keep these values in one place so a chilling centre can tune its quality
 * policy without touching the grading algorithm.
 */

/** Minimum acceptable fat content (percent by weight). */
export const MIN_FAT_PERCENT = 3.5

/** Minimum acceptable Solids-Not-Fat content (percent by weight). */
export const MIN_SNF_PERCENT = 8.5

/**
 * Maximum acceptable temperature in CELSIUS.
 * Milk warmer than this deteriorates more quickly and must be rejected.
 */
export const MAX_TEMPERATURE_C = 10

/** Maximum acceptable titratable acidity (percent lactic acid). */
export const MAX_ACIDITY_PERCENT = 0.16

/**
 * Borderline detection deltas (same units as their corresponding threshold).
 *
 * A reading within this distance of a pass/fail boundary is flagged for
 * operator attention. The flag does not change the accept/reject decision —
 * it only highlights that the reading is near the edge.
 *
 * These values account for typical instrument measurement tolerance at
 * rural collection booths.
 */
export const FAT_BORDERLINE_DELTA = 0.1      // percent
export const SNF_BORDERLINE_DELTA = 0.1      // percent
export const TEMPERATURE_BORDERLINE_DELTA = 0.5  // °C
export const ACIDITY_BORDERLINE_DELTA = 0.01 // percent
