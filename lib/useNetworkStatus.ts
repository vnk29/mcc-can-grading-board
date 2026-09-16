/**
 * useNetworkStatus — React hook for offline resilience UI.
 *
 * Tracks:
 *   - navigator.onLine status (with window event listeners)
 *   - pending / failed entry counts from IndexedDB
 *   - sync-in-progress flag
 *   - auto-sync on reconnect
 *
 * Safe across:
 *   - page refresh (reads IndexedDB on mount)
 *   - browser close/reopen
 *   - repeated online/offline transitions
 */

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getQueueSummary,
  syncPendingEntries,
  retryFailedEntries,
  type SyncResult,
} from '@/lib/offlineQueue'

export interface NetworkStatus {
  /** True when the browser reports online. */
  isOnline: boolean
  /** Number of entries waiting to sync. */
  pendingCount: number
  /** Number of entries that failed with DB errors. */
  failedCount: number
  /** True while syncPendingEntries() is running. */
  isSyncing: boolean
  /** Last sync result, if any. */
  lastSyncResult: SyncResult | null
  /** Manually trigger sync of pending entries. */
  triggerSync: () => Promise<void>
  /** Reset failed entries to pending and retry. */
  triggerRetry: () => Promise<void>
  /** Refresh the queue counts from IndexedDB. */
  refreshCounts: () => Promise<void>
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const [pendingCount, setPendingCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null)

  // Guard against concurrent syncs
  const syncLock = useRef(false)

  const refreshCounts = useCallback(async () => {
    try {
      const summary = await getQueueSummary()
      setPendingCount(summary.pending)
      setFailedCount(summary.failed)
    } catch {
      // IndexedDB may be unavailable in SSR or private browsing edge cases
    }
  }, [])

  const doSync = useCallback(async () => {
    if (syncLock.current) return
    syncLock.current = true
    setIsSyncing(true)

    try {
      const result = await syncPendingEntries()
      setLastSyncResult(result)
    } catch (err) {
      console.error('Sync failed:', err)
    } finally {
      setIsSyncing(false)
      syncLock.current = false
      await refreshCounts()
    }
  }, [refreshCounts])

  const triggerSync = useCallback(async () => {
    await doSync()
  }, [doSync])

  const triggerRetry = useCallback(async () => {
    if (syncLock.current) return
    syncLock.current = true
    setIsSyncing(true)

    try {
      const result = await retryFailedEntries()
      setLastSyncResult(result)
    } catch (err) {
      console.error('Retry failed:', err)
    } finally {
      setIsSyncing(false)
      syncLock.current = false
      await refreshCounts()
    }
  }, [refreshCounts])

  useEffect(() => {
    // Initial count refresh
    refreshCounts().then(() => {
      // Auto-sync on startup if online
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        doSync()
      }
    })

    const handleOnline = () => {
      setIsOnline(true)
      // Auto-sync when connectivity returns
      doSync()
    }

    const handleOffline = () => {
      setIsOnline(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [doSync, refreshCounts])

  return {
    isOnline,
    pendingCount,
    failedCount,
    isSyncing,
    lastSyncResult,
    triggerSync,
    triggerRetry,
    refreshCounts,
  }
}
