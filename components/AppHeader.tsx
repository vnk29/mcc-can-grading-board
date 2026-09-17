'use client'

import { Milk, LogOut, Loader2, WifiOff, AlertCircle } from 'lucide-react'
import { useNetworkStatus } from '@/lib/useNetworkStatus'
import { cn } from '@/lib/utils'

interface AppHeaderProps {
  operatorName?: string
  onLogout?: () => void
}

export function AppHeader({ operatorName, onLogout }: AppHeaderProps) {
  const { isOnline, isSyncing, syncProgress, pendingCount, failedCount } = useNetworkStatus()

  return (
    <header className="bg-mcc-dark sticky top-0 z-50 shadow-md">
      <div className="w-full px-3 sm:px-4 h-14 sm:h-16 flex items-center justify-between">
        
        {/* Logo & Title */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-mcc-light/10 text-white flex items-center justify-center shrink-0 shadow-sm border border-mcc-light/20">
            <Milk className="w-6 h-6 md:w-7 md:h-7" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-[17px] md:text-[20px] font-black text-white leading-tight truncate tracking-tight">MCC Operations</h1>
            <p className="text-[11px] md:text-[13px] text-mcc-light truncate mt-0.5">Milk Chilling Center • Kheda</p>
          </div>
        </div>

        {/* Status & Actions */}
        <div className="flex items-center gap-3 shrink-0 ml-2">
          {/* Status Badge */}
          <div className={cn(
            "flex items-center gap-2 px-2.5 md:px-3 py-1 md:py-1.5 rounded-md text-[10px] md:text-[11px] font-bold uppercase tracking-widest border transition-colors",
            !isOnline
              ? "bg-orange-900/50 border-orange-500/30 text-orange-200"
              : failedCount > 0
                ? "bg-rose-900/50 border-rose-500/30 text-rose-200"
                : isSyncing || pendingCount > 0
                  ? "bg-amber-900/50 border-amber-500/30 text-amber-200"
                  : "bg-mcc-light/10 border-mcc-light/20 text-white"
          )}>
            {isSyncing ? (
              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
            ) : !isOnline ? (
              <WifiOff className="w-3 h-3 shrink-0" />
            ) : failedCount > 0 || pendingCount > 0 ? (
              <AlertCircle className="w-3 h-3 shrink-0" />
            ) : (
              <div className="w-2.5 h-2.5 bg-white rounded-full shrink-0" />
            )}
            <span>
              {!isOnline
                ? "Offline"
                : failedCount > 0
                  ? `${failedCount} Failed`
                  : isSyncing && syncProgress
                    ? `${syncProgress.current}/${syncProgress.total}`
                    : pendingCount > 0 || isSyncing
                      ? "Syncing"
                      : "Online"}
            </span>
          </div>

          {/* Operator Details & Logout */}
          {operatorName && (
            <div className="hidden md:flex items-center gap-3 ml-2 pl-4 border-l border-mcc-light/20">
              <div className="text-right leading-tight">
                <p className="text-[14px] font-bold text-white">{operatorName}</p>
                <p className="text-[11px] text-mcc-light">Shift active</p>
              </div>
              {onLogout && (
                <button 
                  onClick={onLogout}
                  className="p-1.5 text-mcc-light hover:text-white transition-colors hover:bg-mcc-light/10 rounded-lg active:scale-95"
                  aria-label="Logout"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              )}
            </div>
          )}
          
          {/* Mobile Logout (no name text) */}
          {operatorName && onLogout && (
            <button 
              onClick={onLogout}
              className="md:hidden p-1.5 text-mcc-light hover:text-white transition-colors hover:bg-mcc-light/10 rounded-lg active:scale-95 ml-1"
              aria-label="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          )}
        </div>

      </div>
    </header>
  )
}
