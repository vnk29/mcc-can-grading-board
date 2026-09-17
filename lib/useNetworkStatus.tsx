/**
 * useNetworkStatus — React hook for offline resilience UI.
 *
 * SYNC ARCHITECTURE:
 *   - syncLock ref prevents concurrent doSync() calls (single-flight)
 *   - syncQueue promise-chain ensures callers don't stack up
 *   - Progress updated per-record via onProgress callback to offlineQueue
 *   - No useEffect dependency on doSync — stable initial-sync via mount ref
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
  syncProgress: { current: number; total: number } | null
  lastSyncResult: SyncResult | null
  triggerSync: () => void
  triggerRetry: () => void
  refreshCounts: () => Promise<void>
}

const NetworkStatusContext = createContext<NetworkStatus | null>(null)

export function NetworkStatusProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number } | null>(null)
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null)

  // ── Single-flight lock: only ONE sync can run at a time ───────────────────
  const syncLock = useRef(false)
  // ── Prevent auto-sync from firing again if already triggered on mount ─────
  const mountSyncFired = useRef(false)

  const refreshCounts = useCallback(async () => {
    try {
      const summary = await getQueueSummary()
      setPendingCount(summary.pending)
      setFailedCount(summary.failed)
    } catch {
      // Ignore — IndexedDB may not be available in SSR
    }
  }, [])

  // ── Core sync runner — always serialized via lock ref ────────────────────
  const runSync = useCallback(async (mode: 'sync' | 'retry') => {
    // Single-flight lock: if already syncing, ignore
    if (syncLock.current) return
    syncLock.current = true
    setIsSyncing(true)
    setSyncProgress(null)

    try {
      // Get the total count before starting so we can show progress
      const summary = await getQueueSummary()
      const total = mode === 'retry'
        ? summary.pending + summary.failed
        : summary.pending

      if (total === 0) {
        setSyncProgress(null)
        return
      }

      setSyncProgress({ current: 0, total })

      let result: SyncResult
      if (mode === 'retry') {
        result = await retryFailedEntries((processed) => {
          setSyncProgress({ current: processed, total })
        })
      } else {
        result = await syncPendingEntries((processed) => {
          setSyncProgress({ current: processed, total })
        })
      }

      setLastSyncResult(result)
    } catch (err) {
      console.error('Sync failed:', err)
    } finally {
      syncLock.current = false
      setIsSyncing(false)
      setSyncProgress(null)
      await refreshCounts()
    }
  }, [refreshCounts])

  const triggerSync = useCallback(() => {
    runSync('sync')
  }, [runSync])

  const triggerRetry = useCallback(() => {
    runSync('retry')
  }, [runSync])

  // ── Mount effect — read counts, auto-sync once if online ─────────────────
  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsOnline(navigator.onLine)
    }

    // Initial count read + auto-sync once on mount
    refreshCounts().then(() => {
      if (!mountSyncFired.current && typeof navigator !== 'undefined' && navigator.onLine) {
        mountSyncFired.current = true
        runSync('sync')
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally empty — runSync/refreshCounts are stable but we only want this once

  // ── Online/offline event listeners ────────────────────────────────────────
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      runSync('sync') // lock prevents double-sync if already running
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
  }, [runSync])

  return (
    <NetworkStatusContext.Provider
      value={{
        isOnline,
        pendingCount,
        failedCount,
        isSyncing,
        syncProgress,
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
