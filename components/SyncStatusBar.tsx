/**
 * SyncStatusBar — persistent offline/sync status indicator.
 *
 * Renders a compact bar at the bottom of the viewport showing:
 *   - Online (green dot)
 *   - Offline (orange dot)
 *   - Pending sync count
 *   - Failed count + retry button
 *   - Syncing spinner
 *
 * Noticeable but not distracting. Fixed position, small footprint.
 */

'use client'

import { Loader2, Wifi, WifiOff, RefreshCw, AlertCircle } from 'lucide-react'
import { useNetworkStatus } from '@/lib/useNetworkStatus'
import { cn } from '@/lib/utils'

export function SyncStatusBar() {
  const {
    isOnline,
    pendingCount,
    failedCount,
    isSyncing,
    triggerSync,
    triggerRetry,
  } = useNetworkStatus()

  const totalQueued = pendingCount + failedCount
  const hasIssues = !isOnline || totalQueued > 0 || isSyncing

  // When everything is fine, show a minimal indicator
  if (!hasIssues) {
    return (
      <div className="fixed bottom-[88px] left-0 right-0 z-50 pointer-events-none sm:bottom-0">
        <div className="max-w-2xl mx-auto px-4 pb-2">
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium opacity-60">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Online
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed bottom-[88px] left-0 right-0 z-50 sm:bottom-0">
      <div className="max-w-2xl mx-auto px-4 pb-3">
        <div
          className={cn(
            'flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl shadow-lg border text-sm font-semibold backdrop-blur-sm',
            !isOnline
              ? 'bg-orange-50/95 border-orange-200 text-orange-800'
              : failedCount > 0
                ? 'bg-red-50/95 border-red-200 text-red-800'
                : 'bg-amber-50/95 border-amber-200 text-amber-800'
          )}
        >
          {/* Left: status icon + text */}
          <div className="flex items-center gap-2 min-w-0">
            {isSyncing ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            ) : !isOnline ? (
              <WifiOff className="w-4 h-4 shrink-0" />
            ) : failedCount > 0 ? (
              <AlertCircle className="w-4 h-4 shrink-0" />
            ) : (
              <Wifi className="w-4 h-4 shrink-0" />
            )}

            <span className="truncate">
              {isSyncing
                ? 'Syncing...'
                : !isOnline && totalQueued > 0
                  ? failedCount > 0
                    ? `Saved Offline — ${pendingCount} ${pendingCount === 1 ? 'entry' : 'entries'} pending sync; ${failedCount} ${failedCount === 1 ? 'entry' : 'entries'} failed`
                    : `Saved Offline — ${pendingCount} ${pendingCount === 1 ? 'entry' : 'entries'} pending sync`
                  : !isOnline
                    ? 'Offline'
                    : failedCount > 0 && pendingCount > 0
                      ? `${failedCount} ${failedCount === 1 ? 'entry' : 'entries'} failed; ${pendingCount} ${pendingCount === 1 ? 'entry' : 'entries'} pending sync`
                      : failedCount > 0
                        ? `${failedCount} ${failedCount === 1 ? 'entry' : 'entries'} failed`
                        : `${pendingCount} ${pendingCount === 1 ? 'entry' : 'entries'} pending sync`}
            </span>
          </div>

          {/* Right: retry / sync button */}
          {!isSyncing && isOnline && totalQueued > 0 && (
            <button
              onClick={failedCount > 0 ? triggerRetry : triggerSync}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-colors shrink-0',
                failedCount > 0
                  ? 'bg-red-100 hover:bg-red-200 text-red-900'
                  : 'bg-amber-100 hover:bg-amber-200 text-amber-900'
              )}
            >
              <RefreshCw className="w-3 h-3" />
              Retry sync
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
