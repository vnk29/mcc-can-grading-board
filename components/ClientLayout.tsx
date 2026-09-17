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
import { NetworkStatusProvider } from '@/lib/useNetworkStatus'

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const [hasActiveOperator, setHasActiveOperator] = useState(false)

  const router = useRouter()

  useEffect(() => {
    const syncOperatorState = () => {
      setHasActiveOperator(Boolean(sessionStorage.getItem('active_operator_id')))
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
    setHasActiveOperator(false)
    window.dispatchEvent(new CustomEvent('operator-session-changed'))
    router.push('/')
  }

  return (
    <NetworkStatusProvider>
      <div className="flex flex-col min-h-screen bg-slate-50">
        <AppHeader onLogout={hasActiveOperator ? handleLogout : undefined} />
        {/* pb-20 provides padding for the fixed BottomNav */}
        <main className="flex-1 pb-20">
          {children}
        </main>
        <BottomNav />
      </div>
    </NetworkStatusProvider>
  )
}
