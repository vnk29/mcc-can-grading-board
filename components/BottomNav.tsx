'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Plus, History, RefreshCw, Loader2, Scale, LayoutDashboard } from 'lucide-react'
import { useNetworkStatus } from '@/lib/useNetworkStatus'
import { cn } from '@/lib/utils'

export function BottomNav() {
  const pathname = usePathname()
  const { pendingCount, failedCount, isSyncing, triggerSync, triggerRetry, isOnline } = useNetworkStatus()

  const isIntake = pathname === '/'
  const isDashboard = pathname.startsWith('/dashboard')
  const isRecords = pathname.startsWith('/lookup')
  const isDisputes = pathname.startsWith('/disputes')

  const totalQueued = pendingCount + failedCount

  return (
    <div className="w-full bg-card border-t-2 border-border shadow-sm pb-safe">
      <div className="max-w-lg mx-auto flex justify-between items-center px-2 py-2">
        {/* Intake Tab */}
        <Link 
          href="/"
          className={cn(
            "flex-1 min-w-0 flex flex-col items-center justify-center p-2 transition-colors active:scale-95",
            isIntake ? "text-mcc-green" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Plus className="w-6 h-6 mb-1" strokeWidth={isIntake ? 2.5 : 2} />
          <span className="text-[11px] font-bold">Intake</span>
        </Link>

        {/* Dashboard Tab */}
        <Link 
          href="/dashboard"
          className={cn(
            "flex-1 min-w-0 flex flex-col items-center justify-center p-2 transition-colors active:scale-95",
            isDashboard ? "text-mcc-green" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <LayoutDashboard className="w-6 h-6 mb-1" strokeWidth={isDashboard ? 2.5 : 2} />
          <span className="text-[11px] font-bold">Dashboard</span>
        </Link>

        {/* Records Tab */}
        <Link 
          href="/lookup"
          className={cn(
            "flex-1 min-w-0 flex flex-col items-center justify-center p-2 transition-colors active:scale-95",
            isRecords ? "text-mcc-green" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <History className="w-6 h-6 mb-1" strokeWidth={isRecords ? 2.5 : 2} />
          <span className="text-[11px] font-bold">Records</span>
        </Link>

        {/* Disputes Tab */}
        <Link 
          href="/disputes"
          className={cn(
            "flex-1 min-w-0 flex flex-col items-center justify-center p-2 transition-colors active:scale-95",
            isDisputes ? "text-mcc-green" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Scale className="w-6 h-6 mb-1" strokeWidth={isDisputes ? 2.5 : 2} />
          <span className="text-[11px] font-bold">Disputes</span>
        </Link>

        {/* Sync Action */}
        <button
          onClick={() => {
            if (!isOnline || isSyncing) return
            if (failedCount > 0) triggerRetry()
            else if (pendingCount > 0) triggerSync()
            // If nothing to sync, button does nothing (visually disabled)
          }}
          disabled={isSyncing || !isOnline || (pendingCount === 0 && failedCount === 0)}
          className={cn(
            "flex flex-col items-center justify-center p-2 min-w-[72px] transition-colors relative active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed",
            isSyncing 
              ? "text-amber-600" 
              : totalQueued > 0 
                ? "text-mcc-green"
                : "text-muted-foreground/60"
          )}
        >
          {totalQueued > 0 && !isSyncing && (
            <span className="absolute top-1.5 right-3 w-3 h-3 rounded-full bg-rose-500 border-2 border-card shadow-sm" />
          )}
          {isSyncing ? (
            <Loader2 className="w-6 h-6 mb-1 animate-spin" />
          ) : (
            <RefreshCw className="w-6 h-6 mb-1" strokeWidth={2} />
          )}
          <span className="text-[11px] font-bold">Sync</span>
        </button>
      </div>
    </div>
  )
}
