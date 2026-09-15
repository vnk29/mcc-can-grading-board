/**
 * Offline queue helpers using idb-keyval (IndexedDB wrapper).
 *
 * Entries are queued locally when the device is offline and
 * automatically synced to Supabase when connectivity is restored.
 */

import { get, set, del, keys } from 'idb-keyval'
import type { CanTestEntry } from '@/types/index'

const QUEUE_PREFIX = 'offline-queue:'

/** Add an entry to the local offline queue. */
export async function enqueueEntry(entry: CanTestEntry): Promise<void> {
  const key = `${QUEUE_PREFIX}${entry.id}`
  await set(key, entry)
}

/** Retrieve all pending offline entries. */
export async function getPendingEntries(): Promise<CanTestEntry[]> {
  const allKeys = await keys<string>()
  const queueKeys = allKeys.filter((k) => k.startsWith(QUEUE_PREFIX))
  const entries = await Promise.all(queueKeys.map((k) => get<CanTestEntry>(k)))
  return entries.filter((e): e is CanTestEntry => e !== undefined)
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
