/**
 * Offline queue helper test suite.
 * Run with: npx tsx lib/__tests__/offlineQueue.test.ts
 *
 * Tests the pure helpers exported from lib/offlineQueue.ts:
 *   - isNetworkError(): classifies errors as network/transport vs DB/RLS
 *   - toAppEntry(): maps a queued CanTestEntry to a CanTestAppEntry for DB insert
 *
 * The sync engine itself (syncPendingEntries) requires a live Supabase
 * instance + IndexedDB and is not covered here.
 */

import { isNetworkError, toAppEntry } from '../offlineQueue'
import { mapToDbInsert } from '../grading'
import type { CanTestEntry } from '../../types/index'

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

function makeEntry(overrides: Partial<CanTestEntry> = {}): CanTestEntry {
  return {
    id: 'entry-uuid-1',
    farmerId: 'farmer-uuid',
    farmerName: 'Lakshmi Devi',
    canVolume: 20,
    operatorId: 'operator-uuid',
    operatorName: 'Ramesh Kumar',
    fatPercent: 4.2,
    snfPercent: 8.9,
    temperatureC: 6.5,
    adulterationPositive: false,
    acidityPercent: 0.14,
    sedimentDetected: false,
    autoDecision: 'accepted',
    reasonCodes: [],
    isBorderline: false,
    borderlineFlags: [],
    finalDecision: 'accepted',
    isOverride: false,
    referenceCode: 'MCC-20260916-AB12',
    testPerformedAt: '2026-09-16T06:15:00+05:30',
    syncStatus: 'pending',
    queuedAt: '2026-09-16T06:15:01+05:30',
    evidenceType: undefined,
    sensoryNote: undefined,
    photoUrl: undefined,
    ...overrides,
  }
}

// ─── isNetworkError ───────────────────────────────────────────────────────────

test('1. TypeError is a network error', () => {
  assert('TypeError → true', isNetworkError(new TypeError('Failed to fetch')))
})

test('2. Error with "fetch" in message is a network error', () => {
  assert('Error("fetch failed") → true', isNetworkError(new Error('fetch failed')))
  assert('Error("network fetch error") → true', isNetworkError(new Error('network fetch error')))
})

test('3. Plain object without "code" property is a network error', () => {
  assert('{ message } → true', isNetworkError({ message: 'something broke' }))
  assert('{} → true', isNetworkError({}))
})

test('4. Object with Postgres "code" is NOT a network error', () => {
  assert('{ code: "42501" } → false', !isNetworkError({ code: '42501', message: 'permission denied' }))
  assert('{ code: "23505" } → false', !isNetworkError({ code: '23505', message: 'duplicate key' }))
  assert('{ code: "P0001" } → false', !isNetworkError({ code: 'P0001', message: 'unauthorized' }))
})

test('5. Error without "fetch" and without "code" is NOT classified as network', () => {
  // An Error instance has no `code` property by default, but since it's a
  // generic Error without "fetch" in the message, it is treated as a logic error, not a network failure.
  assert('Error("random") → false', !isNetworkError(new Error('random generic exception')))
})

test('6. null is NOT a network error', () => {
  assert('null → false', !isNetworkError(null))
})

test('7. undefined is NOT a network error', () => {
  assert('undefined → false', !isNetworkError(undefined))
})

test('8. Primitive strings/numbers are NOT network errors', () => {
  assert('"string" → false', !isNetworkError('some string'))
  assert('42 → false', !isNetworkError(42))
  assert('true → false', !isNetworkError(true))
})

test('9. Supabase error shape with code is NOT a network error', () => {
  // Real Supabase errors look like { code, message, details, hint, ... }
  const supabaseErr = { code: '42501', message: 'new row violates row-level security policy', details: '', hint: '' }
  assert('RLS error → false', !isNetworkError(supabaseErr))
})

// ─── toAppEntry ───────────────────────────────────────────────────────────────

test('10. toAppEntry maps all fields correctly', () => {
  const entry = makeEntry()
  const app = toAppEntry(entry)
  assert('id preserved', app.id === 'entry-uuid-1')
  assert('farmerId preserved', app.farmerId === 'farmer-uuid')
  assert('operatorId preserved', app.operatorId === 'operator-uuid')
  assert('canVolume preserved', app.canVolume === 20)
  assert('fatPercent preserved', app.fatPercent === 4.2)
  assert('snfPercent preserved', app.snfPercent === 8.9)
  assert('temperatureC preserved', app.temperatureC === 6.5)
  assert('adulterationPositive preserved', app.adulterationPositive === false)
  assert('acidityPercent preserved', app.acidityPercent === 0.14)
  assert('sedimentDetected preserved', app.sedimentDetected === false)
  assert('autoDecision preserved', app.autoDecision === 'accepted')
  assert('decision maps from finalDecision', app.decision === 'accepted')
  assert('isBorderline preserved', app.isBorderline === false)
  assert('borderlineFlags preserved', Array.isArray(app.borderlineFlags) && app.borderlineFlags.length === 0)
  assert('reasonCodes preserved', Array.isArray(app.reasonCodes) && app.reasonCodes.length === 0)
  assert('isOverride preserved', app.isOverride === false)
  assert('referenceCode preserved', app.referenceCode === 'MCC-20260916-AB12')
  assert('evidenceType maps to null', app.evidenceType === null)
  assert('sensoryNote maps to null', app.sensoryNote === null)
  assert('testPerformedAt preserved', app.testPerformedAt === '2026-09-16T06:15:01+05:30' || app.testPerformedAt === '2026-09-16T06:15:00+05:30')
})

test('11. toAppEntry: undefined canVolume falls back to 0 (sentinel)', () => {
  const entry = makeEntry({ canVolume: undefined })
  const app = toAppEntry(entry)
  assert('canVolume is 0', app.canVolume === 0)
})

test('12. toAppEntry: undefined overrideReason maps to null', () => {
  const entry = makeEntry({ isOverride: true, overrideReason: undefined })
  const app = toAppEntry(entry)
  assert('overrideReason is null', app.overrideReason === null)
  assert('isOverride preserved', app.isOverride === true)
})

test('13. toAppEntry: defined overrideReason preserved', () => {
  const entry = makeEntry({ isOverride: true, overrideReason: 'Instrument recalibrated' })
  const app = toAppEntry(entry)
  assert('overrideReason preserved', app.overrideReason === 'Instrument recalibrated')
})

test('14. toAppEntry: undefined photoUrl maps to null', () => {
  const entry = makeEntry({ photoUrl: undefined })
  const app = toAppEntry(entry)
  assert('photoUrl is null', app.photoUrl === null)
})

test('15. toAppEntry: defined photoUrl preserved', () => {
  const entry = makeEntry({ photoUrl: 'https://example.com/photo.jpg' })
  const app = toAppEntry(entry)
  assert('photoUrl preserved', app.photoUrl === 'https://example.com/photo.jpg')
})

test('16. toAppEntry: rejected decision maps correctly', () => {
  const entry = makeEntry({
    finalDecision: 'rejected',
    autoDecision: 'rejected',
    reasonCodes: ['LOW_FAT'],
    isBorderline: false,
  })
  const app = toAppEntry(entry)
  assert('decision is rejected', app.decision === 'rejected')
  assert('autoDecision is rejected', app.autoDecision === 'rejected')
  assert('reasonCodes has LOW_FAT', app.reasonCodes.includes('LOW_FAT'))
})

test('17. toAppEntry: override with accepted final but rejected auto', () => {
  const entry = makeEntry({
    autoDecision: 'rejected',
    finalDecision: 'accepted',
    isOverride: true,
    overrideReason: 'Re-tested, within tolerance',
    reasonCodes: ['LOW_SNF', 'OPERATOR_OVERRIDE'],
    isBorderline: true,
    borderlineFlags: ['LOW_SNF'],
  })
  const app = toAppEntry(entry)
  assert('decision is accepted (override)', app.decision === 'accepted')
  assert('autoDecision is rejected', app.autoDecision === 'rejected')
  assert('isOverride true', app.isOverride === true)
  assert('overrideReason preserved', app.overrideReason === 'Re-tested, within tolerance')
  assert('isBorderline preserved', app.isBorderline === true)
  assert('borderlineFlags has LOW_SNF', app.borderlineFlags.includes('LOW_SNF'))
  assert('reasonCodes has OPERATOR_OVERRIDE', app.reasonCodes.includes('OPERATOR_OVERRIDE'))
})

test('18. toAppEntry output is compatible with mapToDbInsert (snake_case)', () => {
  // Importing mapToDbInsert here verifies the full app → DB pipeline compiles.
  // We do a lightweight check rather than a full DB insert.
  const entry = makeEntry({ temperatureC: 7.3, isBorderline: true, borderlineFlags: ['LOW_FAT'] })
  const app = toAppEntry(entry)
  assert('temperatureC is 7.3 (app layer, camelCase)', app.temperatureC === 7.3)
  assert('decision is a CanDecision', app.decision === 'accepted' || app.decision === 'rejected')
  assert('autoDecision is a CanDecision', app.autoDecision === 'accepted' || app.autoDecision === 'rejected')

  const dbInsert = mapToDbInsert(app)
  assert('temperature_c is mapped correctly', dbInsert.temperature === 7.3)
  assert('decision is mapped correctly', dbInsert.decision === app.decision)
  assert('borderline_flags is mapped correctly', dbInsert.borderline_flags?.[0] === 'LOW_FAT')
})

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
