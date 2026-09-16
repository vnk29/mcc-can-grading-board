/**
 * ClientLayout — client component boundary for the root layout.
 *
 * Renders the SyncStatusBar (which uses React hooks) alongside
 * the page content. This allows the root layout.tsx to remain
 * a server component.
 */

'use client'

import { SyncStatusBar } from '@/components/SyncStatusBar'

export function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <SyncStatusBar />
    </>
  )
}
