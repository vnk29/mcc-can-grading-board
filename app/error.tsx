'use client'

import { useEffect } from 'react'
import { AlertCircle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-white border border-red-200 rounded-xl p-6 text-center shadow-sm space-y-4">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-2">
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900">Something went wrong!</h2>
        <p className="text-slate-500 pb-4">
          The application encountered an unexpected error. Don&apos;t worry, your offline records are safe.
        </p>
        <Button 
          onClick={() => reset()}
          className="w-full h-12 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg flex items-center justify-center gap-2"
        >
          <RotateCcw className="w-4 h-4" />
          Try again
        </Button>
      </div>
    </div>
  )
}
