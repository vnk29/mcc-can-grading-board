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

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import {
  getQueueSummary,
  syncPendingEntries,
  retryFailedEntries,
  type SyncResult,
} from '@/lib/offlineQueue'

export interface NetworkStatus {
  isOnline: boolean
  pendingCount: number
  failedCount: number
  isSyncing: boolean
  lastSyncResult: SyncResult | null
  triggerSync: () => Promise<void>
  triggerRetry: () => Promise<void>
  refreshCounts: () => Promise<void>
}

const NetworkStatusContext = createContext<NetworkStatus | null>(null)

export function NetworkStatusProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null)

  const syncQueue = useRef<Promise<void>>(Promise.resolve())

  const refreshCounts = useCallback(async () => {
    try {
      const summary = await getQueueSummary()
      setPendingCount(summary.pending)
      setFailedCount(summary.failed)
    } catch {
      // Ignore
    }
  }, [])

  const doSync = useCallback(() => {
    syncQueue.current = syncQueue.current.then(async () => {
      setIsSyncing(true)
      try {
        const result = await syncPendingEntries()
        setLastSyncResult(result)
      } catch (err) {
        console.error('Sync failed:', err)
      } finally {
        setIsSyncing(false)
        await refreshCounts()
      }
    })
    return syncQueue.current
  }, [refreshCounts])

  const triggerSync = useCallback(async () => {
    await doSync()
  }, [doSync])

  const triggerRetry = useCallback(() => {
    syncQueue.current = syncQueue.current.then(async () => {
      setIsSyncing(true)
      try {
        const result = await retryFailedEntries()
        setLastSyncResult(result)
      } catch (err) {
        console.error('Retry failed:', err)
      } finally {
        setIsSyncing(false)
        await refreshCounts()
      }
    })
    return syncQueue.current
  }, [refreshCounts])

  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsOnline(navigator.onLine)
    }

    refreshCounts().then(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        doSync()
      }
    })

    const handleOnline = () => {
      setIsOnline(true)
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

  return (
    <NetworkStatusContext.Provider
      value={{
        isOnline,
        pendingCount,
        failedCount,
        isSyncing,
        lastSyncResult,
        triggerSync,
        triggerRetry,
        refreshCounts,
      }}
    >
      {children}
    </NetworkStatusContext.Provider>
  )
}

export function useNetworkStatus(): NetworkStatus {
  const context = useContext(NetworkStatusContext)
  if (!context) {
    throw new Error('useNetworkStatus must be used within a NetworkStatusProvider')
  }
  return context
}
