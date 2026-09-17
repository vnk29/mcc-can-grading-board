'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Plus, History, Scale, LayoutGrid, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useNetworkStatus } from '@/lib/useNetworkStatus'

interface SidebarNavProps {
  operatorName: string
  shiftStartTime: string
}

export function SidebarNav({ operatorName, shiftStartTime }: SidebarNavProps) {
  const pathname = usePathname()
  const { isSyncing, pendingCount, failedCount, isOnline, triggerSync, triggerRetry, syncProgress } = useNetworkStatus()

  const navItems = [
    { label: 'New Intake', href: '/', icon: Plus },
    { label: 'Records', href: '/lookup', icon: History },
    { label: 'Disputes', href: '/disputes', icon: Scale },
    { label: 'Dashboard', href: '/dashboard', icon: LayoutGrid },
  ]

  const totalQueued = pendingCount + failedCount

  return (
    <div className="flex flex-col h-full sticky top-16 pt-5 px-3">
      
      {/* Active Shift Block */}
      <div className="bg-mcc-light/50 rounded-xl p-3 mb-5">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Active Shift</p>
        <p className="text-[14px] font-bold text-foreground">{operatorName}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">Started {shiftStartTime}</p>
      </div>

      {/* Navigation Links */}
      <nav className="flex flex-col gap-1 flex-1">
        {navItems.map((item) => {
          const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          const Icon = item.icon
          
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-bold transition-all",
                isActive 
                  ? "bg-mcc-green text-white shadow-sm" 
                  : "text-foreground hover:bg-mcc-light/50"
              )}
            >
              <Icon className="w-5 h-5 shrink-0" strokeWidth={isActive ? 2.5 : 2} />
              {item.label}
            </Link>
          )
        })}

        {/* Sync action button */}
        <button
          onClick={() => {
            if (!isOnline || isSyncing) return
            if (failedCount > 0) triggerRetry()
            else if (pendingCount > 0) triggerSync()
          }}
          disabled={isSyncing || !isOnline || totalQueued === 0}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-bold transition-all text-left w-full mt-1",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            isSyncing
              ? "text-amber-700 bg-amber-50"
              : totalQueued > 0
                ? "text-mcc-green hover:bg-mcc-light/50"
                : "text-muted-foreground hover:bg-mcc-light/30"
          )}
        >
          {isSyncing
            ? <Loader2 className="w-5 h-5 shrink-0 animate-spin" />
            : <RefreshCw className="w-5 h-5 shrink-0" strokeWidth={2} />
          }
          <span>
            {isSyncing && syncProgress
              ? `Syncing ${syncProgress.current}/${syncProgress.total}…`
              : isSyncing
                ? 'Syncing…'
                : totalQueued > 0
                  ? `Sync (${totalQueued})`
                  : 'Sync'}
          </span>
        </button>
      </nav>

      {/* Footer */}
      <div className="mt-auto py-5 border-t border-border">
        <p className="text-[11px] text-muted-foreground">Device MCC-TAB-02</p>
      </div>
    </div>
  )
}
