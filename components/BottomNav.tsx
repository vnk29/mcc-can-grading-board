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
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-50 pb-safe">
      <div className="max-w-md mx-auto flex justify-between items-center px-2 py-2">
        {/* Intake Tab */}
        <Link 
          href="/"
          className={cn(
            "flex-1 min-w-0 flex flex-col items-center justify-center p-2 transition-colors",
            isIntake ? "text-[#0f6041]" : "text-slate-500 hover:text-slate-900"
          )}
        >
          <Plus className="w-6 h-6 mb-1" strokeWidth={isIntake ? 2.5 : 2} />
          <span className="text-[11px] font-bold">Intake</span>
        </Link>

        {/* Dashboard Tab */}
        <Link 
          href="/dashboard"
          className={cn(
            "flex-1 min-w-0 flex flex-col items-center justify-center p-2 transition-colors",
            isDashboard ? "text-[#0f6041]" : "text-slate-500 hover:text-slate-900"
          )}
        >
          <LayoutDashboard className="w-6 h-6 mb-1" strokeWidth={isDashboard ? 2.5 : 2} />
          <span className="text-[11px] font-bold">Dashboard</span>
        </Link>

        {/* Records Tab */}
        <Link 
          href="/lookup"
          className={cn(
            "flex-1 min-w-0 flex flex-col items-center justify-center p-2 transition-colors",
            isRecords ? "text-[#0f6041]" : "text-slate-500 hover:text-slate-900"
          )}
        >
          <History className="w-6 h-6 mb-1" strokeWidth={isRecords ? 2.5 : 2} />
          <span className="text-[11px] font-bold">Records</span>
        </Link>

        {/* Disputes Tab */}
        <Link 
          href="/disputes"
          className={cn(
            "flex-1 min-w-0 flex flex-col items-center justify-center p-2 transition-colors",
            isDisputes ? "text-[#0f6041]" : "text-slate-500 hover:text-slate-900"
          )}
        >
          <Scale className="w-6 h-6 mb-1" strokeWidth={isDisputes ? 2.5 : 2} />
          <span className="text-[11px] font-bold">Disputes</span>
        </Link>

        {/* Sync Action */}
        <button
          onClick={() => {
            if (!isOnline) {
              alert("You are offline. Connect to internet to sync.")
              return
            }
            if (failedCount > 0) triggerRetry()
            else if (pendingCount > 0) triggerSync()
            else alert("All records are fully synced!")
          }}
          disabled={isSyncing}
          className={cn(
            "flex flex-col items-center justify-center p-2 min-w-[72px] transition-colors relative",
            isSyncing 
              ? "text-amber-600" 
              : totalQueued > 0 
                ? "text-[#0f6041]"
                : "text-slate-400 hover:text-slate-900"
          )}
        >
          {totalQueued > 0 && !isSyncing && (
            <span className="absolute top-1.5 right-3 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-white" />
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
