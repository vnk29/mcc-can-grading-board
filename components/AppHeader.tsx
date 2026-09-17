'use client'

import { Milk, LogOut, Loader2, WifiOff, AlertCircle } from 'lucide-react'
import { useNetworkStatus } from '@/lib/useNetworkStatus'
import { cn } from '@/lib/utils'

interface AppHeaderProps {
  onLogout?: () => void
}

export function AppHeader({ onLogout }: AppHeaderProps) {
  const { isOnline, isSyncing, pendingCount, failedCount } = useNetworkStatus()

  return (
    <header className="bg-white border-b sticky top-0 z-50">
      <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between">
        
        {/* Logo & Title */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-[#0F4C3A] text-white flex items-center justify-center shrink-0">
            <Milk className="w-6 h-6" strokeWidth={1.5} />
          </div>
          <div className="min-w-0">
            <h1 className="text-[17px] font-bold text-slate-900 leading-tight truncate">MCC Can Board</h1>
            <p className="text-[13px] text-slate-500 truncate">Milk Chilling Center &middot; Kheda</p>
          </div>
        </div>

        {/* Status & Actions */}
        <div className="flex items-center gap-3 shrink-0 ml-2">
          {/* Status Badge */}
          <div className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors",
            !isOnline
              ? "bg-orange-50 border-orange-200 text-orange-700"
              : failedCount > 0
                ? "bg-red-50 border-red-200 text-red-700"
                : isSyncing || pendingCount > 0
                  ? "bg-amber-50 border-amber-200 text-amber-700"
                  : "bg-[#eefcf4] border-[#b0ebd1] text-[#0f6041]"
          )}>
            {isSyncing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : !isOnline ? (
              <WifiOff className="w-3 h-3" />
            ) : failedCount > 0 || pendingCount > 0 ? (
              <AlertCircle className="w-3 h-3" />
            ) : (
              <div className="w-2.5 h-2.5 flex items-center justify-center">
                {/* Visual styling to mimic a generic signal bars icon if you want, or just a dot */}
                <div className="w-[2px] h-1.5 bg-[#1ea86c] mx-[1px] mt-1 rounded-sm" />
                <div className="w-[2px] h-2 bg-[#1ea86c] mx-[1px] mt-0.5 rounded-sm" />
                <div className="w-[2px] h-2.5 bg-[#1ea86c] mx-[1px] rounded-sm" />
              </div>
            )}
            <span className="hidden sm:inline">
              {!isOnline 
                ? "Offline" 
                : failedCount > 0 
                  ? `${failedCount} Failed` 
                  : pendingCount > 0 || isSyncing
                    ? "Syncing"
                    : "Online"}
            </span>
            <span className="inline sm:hidden">
              {!isOnline 
                ? "Offline" 
                : failedCount > 0 
                  ? `${failedCount} Failed` 
                  : pendingCount > 0 || isSyncing
                    ? "Syncing"
                    : "Online"}
            </span>
          </div>

          {/* Logout (if provided) */}
          {onLogout && (
            <button 
              onClick={onLogout}
              className="p-2 text-slate-500 hover:text-slate-900 transition-colors"
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
