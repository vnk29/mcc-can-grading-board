/**
 * ClientLayout — client component boundary for the root layout.
 *
 * Renders the new AppHeader and BottomNav alongside the page content.
 */

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppHeader } from '@/components/AppHeader'
import { BottomNav } from '@/components/BottomNav'
import { SidebarNav } from '@/components/SidebarNav'
import { NetworkStatusProvider } from '@/lib/useNetworkStatus'

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const [activeOperator, setActiveOperator] = useState<{ id: string, name: string } | null>(null)
  const [shiftStartTime, setShiftStartTime] = useState<string | null>(null)

  const router = useRouter()

  useEffect(() => {
    const syncOperatorState = () => {
      const id = sessionStorage.getItem('active_operator_id')
      const name = sessionStorage.getItem('active_operator_name')
      if (id && name) {
        setActiveOperator({ id, name })
        // Set shift start time only once per session
        if (!sessionStorage.getItem('shift_start_time')) {
          const now = new Date()
          const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          sessionStorage.setItem('shift_start_time', timeString)
          setShiftStartTime(timeString)
        } else {
          setShiftStartTime(sessionStorage.getItem('shift_start_time'))
        }
      } else {
        setActiveOperator(null)
      }
    }

    syncOperatorState()

    const handleOperatorSessionChange = () => {
      syncOperatorState()
    }

    window.addEventListener('operator-session-changed', handleOperatorSessionChange)
    window.addEventListener('storage', handleOperatorSessionChange)

    return () => {
      window.removeEventListener('operator-session-changed', handleOperatorSessionChange)
      window.removeEventListener('storage', handleOperatorSessionChange)
    }
  }, [])

  const handleLogout = () => {
    sessionStorage.removeItem('active_operator_id')
    sessionStorage.removeItem('active_operator_name')
    sessionStorage.removeItem('shift_start_time')
    setActiveOperator(null)
    window.dispatchEvent(new CustomEvent('operator-session-changed'))
    router.push('/')
  }

  return (
    <NetworkStatusProvider>
      <div className="flex flex-col min-h-screen bg-slate-50">
        <AppHeader 
          operatorName={activeOperator?.name}
          onLogout={activeOperator ? handleLogout : undefined} 
        />
        
        <div className="flex flex-1 w-full">
          {/* Sidebar - hidden on mobile, visible on md+ */}
          {activeOperator && (
            <aside className="hidden md:flex md:flex-col w-60 lg:w-64 shrink-0 border-r border-border bg-white">
              <SidebarNav operatorName={activeOperator.name} shiftStartTime={shiftStartTime || ''} />
            </aside>
          )}

          {/* Main content area */}
          <main className={`flex-1 min-w-0 overflow-x-hidden ${activeOperator ? 'pb-24 md:pb-8' : ''}`}>
            {children}
          </main>
        </div>

        {/* Bottom Nav - visible on mobile only */}
        {activeOperator && (
          <div className="md:hidden fixed bottom-0 left-0 right-0 z-40">
            <BottomNav />
          </div>
        )}
      </div>
    </NetworkStatusProvider>
  )
}
