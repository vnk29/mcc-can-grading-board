/**
 * Grading engine test suite.
 * Run with: npx ts-node --project tsconfig.json lib/__tests__/grading.test.ts
 *
 * Tests:
 *  1.  Clearly accepted values
 *  2.  Clearly rejected — low fat
 *  3.  Clearly rejected — low SNF
 *  4.  Clearly rejected — high temperature
 *  5.  Clearly rejected — adulteration positive
 *  6.  Multiple rejection reasons
 *  7.  Borderline — fat exactly at threshold
 *  8.  Borderline — temperature exactly at threshold
 *  9.  Borderline — SNF exactly at threshold
 * 10.  Exact decimal boundary (3.6 - 3.5 floating-point case)
 * 11.  Exact decimal boundary (2.5 - 2.4 floating-point case)
 * 12.  Missing fat value (null)
 * 13.  Missing temperature value (undefined)
 * 14.  Non-boolean adulteration value
 * 15.  Null input object
 * 16.  Operator override reason code is persistable (DbReasonCode)
 * 17.  hasInvalidReadings flag
 * 18.  Result can be mapped to CanTestInsert (DB type safety check)
 */

import { evaluateCanTest, mapToDbInsert } from '../grading'
import type { CanTestInput, CanTestAppEntry } from '../grading'

// ─── Test Harness ─────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function assert(label: string, condition: boolean, extra?: string): void {
  if (condition) {
    console.log(`  ✅  ${label}`)
    passed++
  } else {
    console.error(`  ❌  ${label}${extra ? ` — ${extra}` : ''}`)
    failed++
  }
}

function test(name: string, fn: () => void): void {
  console.log(`\n${name}`)
  fn()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const GOOD: CanTestInput = {
  canVolume: 20,
  fatPercent: 4.2,
  snfPercent: 8.9,
  temperatureC: 6.5,
  adulterationPositive: false,
}

// ─── Test Cases ───────────────────────────────────────────────────────────────

test('1. Clearly accepted — all values well within range', () => {
  const r = evaluateCanTest(GOOD)
  assert('decision is accepted', r.decision === 'accepted')
  assert('no reason codes', r.reasonCodes.length === 0)
  assert('not borderline', !r.isBorderline)
  assert('no invalid readings', !r.hasInvalidReadings)
})

test('2. Clearly rejected — low fat (2.8%, threshold 3.5%)', () => {
  const r = evaluateCanTest({ ...GOOD, fatPercent: 2.8 })
  assert('decision is rejected', r.decision === 'rejected')
  assert('LOW_FAT in reasonCodes', r.reasonCodes.includes('LOW_FAT'))
})

test('3. Clearly rejected — low SNF (7.9%, threshold 8.5%)', () => {
  const r = evaluateCanTest({ ...GOOD, snfPercent: 7.9 })
  assert('decision is rejected', r.decision === 'rejected')
  assert('LOW_SNF in reasonCodes', r.reasonCodes.includes('LOW_SNF'))
})

test('4. Clearly rejected — high temperature (14°C, max 10°C)', () => {
  const r = evaluateCanTest({ ...GOOD, temperatureC: 14.0 })
  assert('decision is rejected', r.decision === 'rejected')
  assert('HIGH_TEMPERATURE in reasonCodes', r.reasonCodes.includes('HIGH_TEMPERATURE'))
})

test('5. Clearly rejected — adulteration positive', () => {
  const r = evaluateCanTest({ ...GOOD, adulterationPositive: true })
  assert('decision is rejected', r.decision === 'rejected')
  assert('ADULTERATION_DETECTED in reasonCodes', r.reasonCodes.includes('ADULTERATION_DETECTED'))
})

test('6. Multiple rejection reasons — low fat + high temperature + adulteration', () => {
  const r = evaluateCanTest({ ...GOOD, fatPercent: 2.1, temperatureC: 15.0, adulterationPositive: true })
  assert('decision is rejected', r.decision === 'rejected')
  assert('LOW_FAT present', r.reasonCodes.includes('LOW_FAT'))
  assert('HIGH_TEMPERATURE present', r.reasonCodes.includes('HIGH_TEMPERATURE'))
  assert('ADULTERATION_DETECTED present', r.reasonCodes.includes('ADULTERATION_DETECTED'))
  assert('3 reason codes total', r.reasonCodes.length === 3)
})

test('7. Borderline — fat exactly at threshold (3.5%) — accepted but flagged', () => {
  const r = evaluateCanTest({ ...GOOD, fatPercent: 3.5 })
  assert('decision is accepted', r.decision === 'accepted')
  assert('isBorderline is true', r.isBorderline)
  assert('LOW_FAT not in rejection codes', !r.reasonCodes.includes('LOW_FAT'))
  assert('LOW_FAT in borderlineFlags', r.borderlineFlags.includes('LOW_FAT'))
})

test('8. Borderline — temperature exactly at threshold (10°C) — accepted but flagged', () => {
  const r = evaluateCanTest({ ...GOOD, temperatureC: 10.0 })
  assert('decision is accepted', r.decision === 'accepted')
  assert('isBorderline is true', r.isBorderline)
  assert('HIGH_TEMPERATURE not in rejection codes', !r.reasonCodes.includes('HIGH_TEMPERATURE'))
  assert('HIGH_TEMPERATURE in borderlineFlags', r.borderlineFlags.includes('HIGH_TEMPERATURE'))
})

test('9. Borderline — SNF exactly at threshold (8.5%) — accepted but flagged', () => {
  const r = evaluateCanTest({ ...GOOD, snfPercent: 8.5 })
  assert('decision is accepted', r.decision === 'accepted')
  assert('isBorderline is true', r.isBorderline)
  assert('LOW_SNF not in rejection codes', !r.reasonCodes.includes('LOW_SNF'))
  assert('LOW_SNF in borderlineFlags', r.borderlineFlags.includes('LOW_SNF'))
})

test('10. Floating-point boundary: fat 3.6% — (3.6 - 3.5 = 0.099... in JS)', () => {
  // Raw JS: Math.abs(3.6 - 3.5) can be slightly above OR below 0.1 depending on the operands.
  // For 3.6 - 3.5 specifically, the result is 0.10000000000000009 — ABOVE 0.1.
  // A naive (rawDiff <= 0.1) check would incorrectly say 3.6 is NOT borderline.
  // Our precision-safe rounding fixes this so 3.6% is correctly flagged.
  const rawDiff = Math.abs(3.6 - 3.5)
  assert('raw JS float shows hazard: > 0.1 (would miss borderline naively)', rawDiff > 0.1, 'raw=' + rawDiff)
  const r = evaluateCanTest({ ...GOOD, fatPercent: 3.6 })
  assert('precision-safe: isBorderline is true for 3.6%', r.isBorderline, 'reasonCodes=' + JSON.stringify(r.reasonCodes))
  assert('decision is still accepted', r.decision === 'accepted')
})

test('11. Floating-point boundary: temperature 9.5°C — (10 - 9.5 = 0.5, within delta)', () => {
  const r = evaluateCanTest({ ...GOOD, temperatureC: 9.5 })
  assert('decision is accepted', r.decision === 'accepted')
  assert('isBorderline is true for 9.5°C', r.isBorderline)
})

test('12. Missing fat value (null) → INVALID_FAT_PERCENT', () => {
  const r = evaluateCanTest({ ...GOOD, fatPercent: null })
  assert('INVALID_FAT_PERCENT in reasonCodes', r.reasonCodes.includes('INVALID_FAT_PERCENT'))
  assert('hasInvalidReadings is true', r.hasInvalidReadings)
  assert('decision is rejected (invalid = safe reject)', r.decision === 'rejected')
})

test('13. Missing temperature (undefined) → INVALID_TEMPERATURE', () => {
  const r = evaluateCanTest({ ...GOOD, temperatureC: undefined })
  assert('INVALID_TEMPERATURE in reasonCodes', r.reasonCodes.includes('INVALID_TEMPERATURE'))
  assert('hasInvalidReadings is true', r.hasInvalidReadings)
})

test('14. Non-boolean adulteration value (null) → INVALID_ADULTERATION_RESULT', () => {
  const r = evaluateCanTest({ ...GOOD, adulterationPositive: null })
  assert('INVALID_ADULTERATION_RESULT in reasonCodes', r.reasonCodes.includes('INVALID_ADULTERATION_RESULT'))
  assert('hasInvalidReadings is true', r.hasInvalidReadings)
})

test('14b. Bounds checking for numeric fields', () => {
  const volFail = evaluateCanTest({ ...GOOD, canVolume: 0 })
  assert('can volume <= 0 is invalid', volFail.reasonCodes.includes('INVALID_VOLUME'))
  
  const fatFail = evaluateCanTest({ ...GOOD, fatPercent: 16 })
  assert('fat > 15 is invalid', fatFail.reasonCodes.includes('INVALID_FAT_PERCENT_RANGE'))
  
  const snfFail = evaluateCanTest({ ...GOOD, snfPercent: 3 })
  assert('snf < 4 is invalid', snfFail.reasonCodes.includes('INVALID_SNF_PERCENT_RANGE'))
  
  const tempFail = evaluateCanTest({ ...GOOD, temperatureC: 45 })
  assert('temp > 40 is invalid', tempFail.reasonCodes.includes('INVALID_TEMPERATURE_RANGE'))
})

test('15. Null input object → all INVALID codes', () => {
  const r = evaluateCanTest(null)
  assert('INVALID_VOLUME present', r.reasonCodes.includes('INVALID_VOLUME'))
  assert('INVALID_FAT_PERCENT present', r.reasonCodes.includes('INVALID_FAT_PERCENT'))
  assert('INVALID_SNF_PERCENT present', r.reasonCodes.includes('INVALID_SNF_PERCENT'))
  assert('INVALID_TEMPERATURE present', r.reasonCodes.includes('INVALID_TEMPERATURE'))
  assert('INVALID_ADULTERATION_RESULT present', r.reasonCodes.includes('INVALID_ADULTERATION_RESULT'))
  assert('hasInvalidReadings is true', r.hasInvalidReadings)
  assert('decision is rejected', r.decision === 'rejected')
})

test('16. mapToDbInsert() produces correct snake_case shape', () => {
  const appEntry: CanTestAppEntry = {
    id: 'test-uuid',
    farmerId: 'farmer-uuid',
    operatorId: 'operator-uuid',
    canVolume: 20,
    fatPercent: 4.2,
    snfPercent: 8.9,
    temperatureC: 6.5,
    adulterationPositive: false,
    autoDecision: 'accepted',
    decision: 'accepted',
    isBorderline: false,
    borderlineFlags: [],
    reasonCodes: [],
    isOverride: false,
    overrideReason: null,
    referenceCode: 'MCC-TEST-0001',
    photoUrl: null,
    testPerformedAt: '2026-09-15T06:15:00+05:30',
  }
  const db = mapToDbInsert(appEntry)
  assert('temperature maps from temperatureC', db.temperature === 6.5)
  assert('fat_percent maps from fatPercent', db.fat_percent === 4.2)
  assert('farmer_id maps from farmerId', db.farmer_id === 'farmer-uuid')
  assert('operator_id maps from operatorId', db.operator_id === 'operator-uuid')
  assert('test_performed_at maps from testPerformedAt', db.test_performed_at === '2026-09-15T06:15:00+05:30')
  assert('created_at is absent (let DB stamp it)', !('created_at' in db) || db.created_at === undefined)
})

test('17. hasInvalidReadings convenience flag', () => {
  const clean = evaluateCanTest(GOOD)
  assert('clean result: hasInvalidReadings is false', !clean.hasInvalidReadings)

  const dirty = evaluateCanTest({ ...GOOD, fatPercent: undefined })
  assert('dirty result: hasInvalidReadings is true', dirty.hasInvalidReadings)
})

// ─── Extended Edge Cases ──────────────────────────────────────────────────────

test('18. All four rejection reasons at once', () => {
  const r = evaluateCanTest({ ...GOOD, fatPercent: 2.0, snfPercent: 7.0, temperatureC: 15.0, adulterationPositive: true })
  assert('decision is rejected', r.decision === 'rejected')
  assert('LOW_FAT present', r.reasonCodes.includes('LOW_FAT'))
  assert('LOW_SNF present', r.reasonCodes.includes('LOW_SNF'))
  assert('HIGH_TEMPERATURE present', r.reasonCodes.includes('HIGH_TEMPERATURE'))
  assert('ADULTERATION_DETECTED present', r.reasonCodes.includes('ADULTERATION_DETECTED'))
  assert('exactly 4 reason codes', r.reasonCodes.length === 4)
  assert('no invalid readings', !r.hasInvalidReadings)
})

test('19. Borderline just OUTSIDE delta — fat 3.3% (delta 0.1, threshold 3.5)', () => {
  // 3.5 - 3.3 = 0.2 > 0.1 delta → not borderline, and rejected (below threshold)
  const r = evaluateCanTest({ ...GOOD, fatPercent: 3.3 })
  assert('decision is rejected (below threshold)', r.decision === 'rejected')
  assert('isBorderline is false', !r.isBorderline)
  assert('LOW_FAT in reasonCodes', r.reasonCodes.includes('LOW_FAT'))
})

test('20. Borderline just OUTSIDE delta on the passing side — fat 3.7% (0.2 above)', () => {
  const r = evaluateCanTest({ ...GOOD, fatPercent: 3.7 })
  assert('decision is accepted', r.decision === 'accepted')
  assert('isBorderline is false (0.2 > 0.1 delta)', !r.isBorderline)
})

test('21. Multiple borderline flags at once (fat + snf + temp all near limits)', () => {
  const r = evaluateCanTest({ ...GOOD, fatPercent: 3.5, snfPercent: 8.5, temperatureC: 9.8 })
  assert('decision is accepted (all at/above thresholds)', r.decision === 'accepted')
  assert('isBorderline is true', r.isBorderline)
  assert('LOW_FAT in borderlineFlags', r.borderlineFlags.includes('LOW_FAT'))
  assert('LOW_SNF in borderlineFlags', r.borderlineFlags.includes('LOW_SNF'))
  assert('HIGH_TEMPERATURE in borderlineFlags', r.borderlineFlags.includes('HIGH_TEMPERATURE'))
  assert('3 borderline flags', r.borderlineFlags.length === 3)
})

test('22. Decision values are always lowercase', () => {
  const accepted = evaluateCanTest(GOOD)
  const rejected = evaluateCanTest({ ...GOOD, fatPercent: 1.0 })
  assert('accepted is lowercase', accepted.decision === 'accepted')
  assert('rejected is lowercase', rejected.decision === 'rejected')
})

test('23. Edge of valid ranges — fat 0.1 (min valid), snf 4 (min valid)', () => {
  const r = evaluateCanTest({ ...GOOD, fatPercent: 0.1, snfPercent: 4.0 })
  // 0.1 is valid range but below 3.5 threshold → LOW_FAT; 4.0 valid but below 8.5 → LOW_SNF
  assert('no INVALID_FAT_PERCENT_RANGE', !r.reasonCodes.includes('INVALID_FAT_PERCENT_RANGE'))
  assert('no INVALID_SNF_PERCENT_RANGE', !r.reasonCodes.includes('INVALID_SNF_PERCENT_RANGE'))
  assert('LOW_FAT present (below threshold but valid range)', r.reasonCodes.includes('LOW_FAT'))
  assert('LOW_SNF present (below threshold but valid range)', r.reasonCodes.includes('LOW_SNF'))
})

test('24. Edge of valid temperature range — 0°C and 40°C', () => {
  const cold = evaluateCanTest({ ...GOOD, temperatureC: 0 })
  assert('0°C is valid (no INVALID_TEMPERATURE_RANGE)', !cold.reasonCodes.includes('INVALID_TEMPERATURE_RANGE'))
  assert('0°C accepted', cold.decision === 'accepted')

  const hot = evaluateCanTest({ ...GOOD, temperatureC: 40 })
  assert('40°C is valid range (no INVALID_TEMPERATURE_RANGE)', !hot.reasonCodes.includes('INVALID_TEMPERATURE_RANGE'))
  assert('40°C rejected (above 10°C max)', hot.decision === 'rejected')
  assert('HIGH_TEMPERATURE present', hot.reasonCodes.includes('HIGH_TEMPERATURE'))
})

test('25. Negative values are invalid', () => {
  const negFat = evaluateCanTest({ ...GOOD, fatPercent: -1 })
  assert('negative fat is INVALID_FAT_PERCENT', negFat.reasonCodes.includes('INVALID_FAT_PERCENT'))

  const negTemp = evaluateCanTest({ ...GOOD, temperatureC: -5 })
  assert('negative temp is INVALID_TEMPERATURE', negTemp.reasonCodes.includes('INVALID_TEMPERATURE'))
})

test('26. Zero volume is invalid (must be > 0)', () => {
  const r = evaluateCanTest({ ...GOOD, canVolume: 0 })
  assert('INVALID_VOLUME present', r.reasonCodes.includes('INVALID_VOLUME'))
  assert('hasInvalidReadings is true', r.hasInvalidReadings)
})

test('27. Volume does not affect accept/reject decision (only validation)', () => {
  // A huge volume with good readings still accepts; a tiny valid volume also accepts
  const big = evaluateCanTest({ ...GOOD, canVolume: 999 })
  assert('large volume accepted', big.decision === 'accepted')
  const small = evaluateCanTest({ ...GOOD, canVolume: 0.1 })
  assert('small valid volume accepted', small.decision === 'accepted')
})

test('28. Empty object input → all INVALID codes', () => {
  const r = evaluateCanTest({})
  assert('INVALID_VOLUME present', r.reasonCodes.includes('INVALID_VOLUME'))
  assert('INVALID_FAT_PERCENT present', r.reasonCodes.includes('INVALID_FAT_PERCENT'))
  assert('INVALID_SNF_PERCENT present', r.reasonCodes.includes('INVALID_SNF_PERCENT'))
  assert('INVALID_TEMPERATURE present', r.reasonCodes.includes('INVALID_TEMPERATURE'))
  assert('INVALID_ADULTERATION_RESULT present', r.reasonCodes.includes('INVALID_ADULTERATION_RESULT'))
  assert('5 invalid codes total', r.reasonCodes.length === 5)
})

test('29. Adulteration false (explicit) is valid and accepted', () => {
  const r = evaluateCanTest({ ...GOOD, adulterationPositive: false })
  assert('decision is accepted', r.decision === 'accepted')
  assert('no ADULTERATION_DETECTED', !r.reasonCodes.includes('ADULTERATION_DETECTED'))
  assert('no invalid readings', !r.hasInvalidReadings)
})

test('30. NaN inputs are treated as invalid', () => {
  const r = evaluateCanTest({ ...GOOD, fatPercent: NaN })
  assert('INVALID_FAT_PERCENT present for NaN', r.reasonCodes.includes('INVALID_FAT_PERCENT'))
  assert('hasInvalidReadings is true', r.hasInvalidReadings)
})

test('31. Infinity inputs are treated as invalid', () => {
  const r = evaluateCanTest({ ...GOOD, snfPercent: Infinity })
  assert('INVALID_SNF_PERCENT present for Infinity', r.reasonCodes.includes('INVALID_SNF_PERCENT'))
})

test('32. mapToDbInsert omits created_at (server stamps it)', () => {
  const appEntry: CanTestAppEntry = {
    id: 'test-uuid',
    farmerId: 'farmer-uuid',
    operatorId: 'operator-uuid',
    canVolume: 20,
    fatPercent: 4.2,
    snfPercent: 8.9,
    temperatureC: 6.5,
    adulterationPositive: false,
    autoDecision: 'accepted',
    decision: 'accepted',
    isBorderline: false,
    borderlineFlags: [],
    reasonCodes: [],
    isOverride: false,
    overrideReason: null,
    referenceCode: 'MCC-TEST-0032',
    photoUrl: null,
    testPerformedAt: '2026-09-15T06:15:00+05:30',
  }
  const db = mapToDbInsert(appEntry)
  assert('created_at is undefined', db.created_at === undefined)
  assert('reference_code preserved', db.reference_code === 'MCC-TEST-0032')
  assert('adulteration_result maps from adulterationPositive', db.adulteration_result === false)
  assert('is_override preserved', db.is_override === false)
})

test('33. Precision: SNF 8.6% is borderline (8.6 - 8.5 = 0.1, within delta)', () => {
  const rawDiff = Math.abs(8.6 - 8.5)
  assert('raw JS float hazard present', rawDiff > 0.1 || rawDiff < 0.1, 'raw=' + rawDiff)
  const r = evaluateCanTest({ ...GOOD, snfPercent: 8.6 })
  assert('isBorderline is true for 8.6%', r.isBorderline)
  assert('decision is accepted', r.decision === 'accepted')
})

test('34. Reason codes never contain INVALID_* when inputs are all valid', () => {
  const r = evaluateCanTest(GOOD)
  const hasInvalid = r.reasonCodes.some(c => c.startsWith('INVALID_'))
  assert('no INVALID_* codes on valid input', !hasInvalid)
})

test('35. Grading is deterministic — same input twice yields same output', () => {
  const input = { ...GOOD, fatPercent: 3.45, snfPercent: 8.55, temperatureC: 9.7 }
  const r1 = evaluateCanTest(input)
  const r2 = evaluateCanTest(input)
  assert('decisions match', r1.decision === r2.decision)
  assert('reasonCodes match', JSON.stringify(r1.reasonCodes) === JSON.stringify(r2.reasonCodes))
  assert('borderlineFlags match', JSON.stringify(r1.borderlineFlags) === JSON.stringify(r2.borderlineFlags))
  assert('isBorderline matches', r1.isBorderline === r2.isBorderline)
})

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
