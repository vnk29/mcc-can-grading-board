/**
 * ============================================================
 * OFFLINE QUEUE & SYNC ENGINE — lib/offlineQueue.ts
 * ============================================================
 *
 * Persistent IndexedDB queue using idb-keyval.
 *
 * DATA FLOW
 *   operator submits can test
 *       ↓
 *   if offline or network error → enqueueEntry()
 *       ↓
 *   entry persists in IndexedDB (survives refresh / close)
 *       ↓
 *   on reconnect → syncPendingEntries()
 *       ↓
 *   sequential insert into Supabase
 *       ↓
 *   success / 23505 duplicate → dequeueEntry()
 *       ↓
 *   network error → stop (retry later)
 *       ↓
 *   DB/RLS error → mark failed, continue
 *
 * IDENTITY PRESERVATION
 *   id and reference_code are generated ONCE at submission time
 *   and never change through offline storage → retry → sync.
 *
 * IDEMPOTENT RETRIES
 *   Postgres error 23505 (unique violation) = record already exists
 *   = treat as successful sync, dequeue, do NOT duplicate.
 */

import { get, set, del, keys } from 'idb-keyval'
import type { CanTestEntry } from '@/types/index'
import { mapToDbInsert, type CanTestAppEntry } from '@/lib/grading'
import { supabase } from '@/lib/supabase'

const QUEUE_PREFIX = 'offline-queue:'

// ─── Core Queue Operations ───────────────────────────────────────────────────

/** Add an entry to the local offline queue. */
export async function enqueueEntry(entry: CanTestEntry): Promise<void> {
  const key = `${QUEUE_PREFIX}${entry.id}`
  await set(key, entry)
}

/** Retrieve all pending offline entries, sorted by queuedAt (creation order). */
export async function getPendingEntries(): Promise<CanTestEntry[]> {
  const allKeys = await keys<string>()
  const queueKeys = allKeys.filter((k) => k.startsWith(QUEUE_PREFIX))
  const entries = await Promise.all(queueKeys.map((k) => get<CanTestEntry>(k)))
  return entries
    .filter((e): e is CanTestEntry => e !== undefined)
    .sort((a, b) => {
      const timeA = a.queuedAt || a.testPerformedAt || ''
      const timeB = b.queuedAt || b.testPerformedAt || ''
      return timeA < timeB ? -1 : (timeA > timeB ? 1 : 0)
    })
}

/** Remove a successfully synced entry from the queue. */
export async function dequeueEntry(id: string): Promise<void> {
  await del(`${QUEUE_PREFIX}${id}`)
}

/** Returns how many entries are pending sync. */
export async function getPendingCount(): Promise<number> {
  const allKeys = await keys<string>()
  return allKeys.filter((k) => k.startsWith(QUEUE_PREFIX)).length
}

// ─── Status Helpers ──────────────────────────────────────────────────────────

/** Mark an entry as failed (DB/RLS error — not a network issue). */
export async function markEntryFailed(id: string): Promise<void> {
  const key = `${QUEUE_PREFIX}${id}`
  const entry = await get<CanTestEntry>(key)
  if (entry) {
    entry.syncStatus = 'failed'
    await set(key, entry)
  }
}

/** Reset a failed entry back to pending for retry. */
export async function markEntryPending(id: string): Promise<void> {
  const key = `${QUEUE_PREFIX}${id}`
  const entry = await get<CanTestEntry>(key)
  if (entry) {
    entry.syncStatus = 'pending'
    await set(key, entry)
  }
}

/** Get a summary of the queue state. */
export async function getQueueSummary(): Promise<{ pending: number; failed: number }> {
  const entries = await getPendingEntries()
  let pending = 0
  let failed = 0
  for (const e of entries) {
    if (e.syncStatus === 'failed') failed++
    else pending++
  }
  return { pending, failed }
}

// ─── Sync Engine ─────────────────────────────────────────────────────────────

/**
 * Result of a sync attempt.
 */
export interface SyncResult {
  /** Number of entries successfully synced (including idempotent 23505). */
  synced: number
  /** Number of entries that failed with DB/RLS errors. */
  failed: number
  /** Number of entries still pending (network error stopped processing). */
  remaining: number
  /** True if sync was stopped by a network error. */
  stoppedByNetwork: boolean
}

/**
 * Convert a CanTestEntry (offline queue shape) to a CanTestAppEntry
 * (grading engine shape) for use with mapToDbInsert().
 */
export function toAppEntry(entry: CanTestEntry): CanTestAppEntry {
  return {
    id: entry.id,
    farmerId: entry.farmerId,
    operatorId: entry.operatorId,
    // canVolume is optional on the queue entry but required on CanTestAppEntry.
    // The form always sets it before enqueueing, so undefined here indicates
    // data corruption. Falling back to 0 is a deliberate sentinel: 0 fails the
    // grading engine's INVALID_VOLUME check, so a corrupted entry is marked
    // failed during sync rather than silently persisted with bad data.
    canVolume: entry.canVolume ?? 0,
    fatPercent: entry.fatPercent,
    snfPercent: entry.snfPercent,
    temperatureC: entry.temperatureC,
    adulterationPositive: entry.adulterationPositive,
    acidityPercent: entry.acidityPercent,
    sedimentDetected: entry.sedimentDetected,
    autoDecision: entry.autoDecision,
    decision: entry.finalDecision,
    isBorderline: entry.isBorderline,
    borderlineFlags: entry.borderlineFlags,
    reasonCodes: (entry.reasonCodes as string[]).filter(c => !c.startsWith('INVALID_')) as import('@/types/database').DbReasonCode[],
    isOverride: entry.isOverride,
    overrideReason: entry.overrideReason ?? null,
    referenceCode: entry.referenceCode,
    photoUrl: entry.photoUrl ?? null,
    evidenceType: entry.evidenceType ?? (
      entry.photoUrl ? 'photo' : null
    ),
    sensoryNote: entry.sensoryNote ?? null,
    testPerformedAt: entry.testPerformedAt,
  }
}

/**
 * Classify whether an error is a network/transport failure.
 *
 * Network errors:
 *   - TypeError (fetch failed)
 *   - Error with "fetch" in message
 *   - Object without a Postgres `code` property
 *
 * NOT network errors (must NOT be queued):
 *   - RLS failures (have a Postgres code)
 *   - Validation errors (have a Postgres code)
 *   - Any error with a `code` property
 */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true
  if (err instanceof Error && err.message.includes('fetch')) return true
  if (typeof err === 'object' && err !== null && !(err instanceof Error) && !('code' in err)) return true
  return false
}

/**
 * Attempt to sync all pending entries to Supabase, sequentially, in creation order.
 *
 * POLICY:
 *   - Success or 23505 → dequeue, continue
 *   - Network error → stop (retry on next online event)
 *   - DB/RLS/validation error → mark failed, continue to next entry
 *
 * onProgress(processed) is called after each record is handled so the UI
 * can show "Syncing X of Y" without blocking.
 */
export async function syncPendingEntries(
  onProgress?: (processed: number) => void
): Promise<SyncResult> {
  const entries = await getPendingEntries()
  let synced = 0
  let failed = 0
  let stoppedByNetwork = false
  let processed = 0

  for (const entry of entries) {
    // Skip entries already marked as failed (unless user resets them)
    if (entry.syncStatus === 'failed') {
      failed++
      continue
    }

    try {
      const appEntry = toAppEntry(entry)
      const dbInsert = mapToDbInsert(appEntry)

      const { error } = await supabase.from('can_tests').insert(dbInsert)

      if (error) {
        if (error.code === '23505') {
          // Idempotent success — record already exists on server
          await dequeueEntry(entry.id)
          synced++
        } else if (isNetworkError(error)) {
          // Network problem surfaced as a Supabase error object
          stoppedByNetwork = true
          break
        } else {
          // DB/RLS/validation error — mark failed, continue
          await markEntryFailed(entry.id)
          failed++
        }
      } else {
        // Clean success
        await dequeueEntry(entry.id)
        synced++
      }
    } catch (err: unknown) {
      if (isNetworkError(err)) {
        stoppedByNetwork = true
        break
      }
      // Unexpected error — mark failed, continue
      console.error('Sync error for entry', entry.id, err)
      await markEntryFailed(entry.id)
      failed++
    }

    processed++
    onProgress?.(processed)

    // Yield to the event loop between records to keep UI responsive
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }

  // Count remaining
  const afterEntries = await getPendingEntries()
  const remaining = afterEntries.length

  return { synced, failed, remaining, stoppedByNetwork }
}

/**
 * Reset all failed entries back to pending and retry sync.
 */
export async function retryFailedEntries(
  onProgress?: (processed: number) => void
): Promise<SyncResult> {
  const entries = await getPendingEntries()
  for (const entry of entries) {
    if (entry.syncStatus === 'failed') {
      await markEntryPending(entry.id)
    }
  }
  return syncPendingEntries(onProgress)
}

