'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, AlertTriangle, XCircle, ArrowLeft, Loader2, AlertCircle } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { getPendingEntries } from '@/lib/offlineQueue'
import { REASON_LABELS } from '@/lib/grading'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import type { CanTestRow, DbReasonCode } from '@/types/database'
import { cn } from '@/lib/utils'

export default function ResultPage({ params }: { params: Promise<{ reference: string }> | { reference: string } }) {
  const router = useRouter()
  // React.use() safely unpacks the promise in Next.js 15, or passes through a plain object in Next.js 14
  const unwrappedParams = params instanceof Promise ? use(params) : params
  const reference = unwrappedParams.reference

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // We unify online and offline record shapes into a local display state
  const [record, setRecord] = useState<{
    referenceCode: string
    finalDecision: 'accepted' | 'rejected'
    isBorderline: boolean
    isOverride: boolean
    reasonCodes: string[]
    testPerformedAt: string
    isOffline: boolean
  } | null>(null)

  useEffect(() => {
    if (!reference) return

    async function fetchRecord() {
      setIsLoading(true)
      try {
        // 1. Try Supabase first
        const { data: dbData } = await supabase
          .from('can_tests')
          .select('*')
          .eq('reference_code', reference)
          .maybeSingle()

        if (dbData) {
          const row = dbData as CanTestRow
          setRecord({
            referenceCode: row.reference_code,
            finalDecision: row.decision,
            isBorderline: false,
            isOverride: row.is_override,
            reasonCodes: row.reason_codes,
            testPerformedAt: row.test_performed_at,
            isOffline: false
          })
          return
        }

        // 2. If not found online, check offline queue
        const pending = await getPendingEntries()
        const offlineMatch = pending.find(e => e.referenceCode === reference)
        
        if (offlineMatch) {
          setRecord({
            referenceCode: offlineMatch.referenceCode,
            finalDecision: offlineMatch.finalDecision,
            isBorderline: offlineMatch.isBorderline,
            isOverride: offlineMatch.isOverride,
            reasonCodes: offlineMatch.reasonCodes,
            testPerformedAt: offlineMatch.testPerformedAt,
            isOffline: true
          })
          return
        }

        // 3. Not found anywhere
        setError('Record not found. It may have been deleted or never saved.')
      } catch (err) {
        console.error('Error fetching result:', err)
        setError('Failed to load result. Please check your connection.')
      } finally {
        setIsLoading(false)
      }
    }

    fetchRecord()
  }, [reference])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-slate-400" />
          <p className="text-slate-500 font-medium">Loading result...</p>
        </div>
      </div>
    )
  }

  if (error || !record) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <Card className="max-w-md w-full border-red-200 shadow-sm">
          <CardHeader className="bg-red-50 text-red-900 rounded-t-xl">
            <AlertCircle className="w-8 h-8 mb-2" />
            <CardTitle>Result Not Found</CardTitle>
            <CardDescription className="text-red-700">{error}</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <Button onClick={() => router.push('/')} className="w-full h-12 text-lg" variant="outline">
              <ArrowLeft className="w-5 h-5 mr-2" /> Back to Intake
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { finalDecision, isBorderline, isOverride, reasonCodes, isOffline } = record
  
  // Format the timestamp nicely for the slip
  const dateObj = new Date(record.testPerformedAt)
  const timeString = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const dateString = dateObj.toLocaleDateString()

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6 flex items-center justify-center">
      <div className="w-full max-w-md space-y-6">
        
        {isOffline && (
          <div className="p-3 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            Saved offline — pending sync
          </div>
        )}

        <Card className={cn(
          "shadow-lg border-2 overflow-hidden",
          finalDecision === 'accepted' ? "border-emerald-200" : "border-red-200"
        )}>
          <div className={cn(
            "p-8 text-center text-white",
            finalDecision === 'accepted' ? "bg-emerald-600" : "bg-red-600"
          )}>
            {finalDecision === 'accepted' ? (
              <CheckCircle2 className="w-20 h-20 mx-auto mb-4 opacity-90" />
            ) : (
              <XCircle className="w-20 h-20 mx-auto mb-4 opacity-90" />
            )}
            
            <h1 className="text-3xl font-black tracking-tight mb-2 uppercase">
              {isOverride 
                ? `${finalDecision} (OVERRIDE)`
                : isBorderline && finalDecision === 'accepted' 
                  ? 'BORDERLINE - REVIEW'
                  : finalDecision
              }
            </h1>
            <p className="text-white/80 font-medium font-mono text-lg">{record.referenceCode}</p>
          </div>

          <CardContent className="p-6 space-y-6 bg-white">
            
            {reasonCodes.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-bold text-slate-900 uppercase text-sm tracking-wider">Remarks</h3>
                <ul className="space-y-2">
                  {reasonCodes.map(code => (
                    <li key={code} className="flex items-start gap-2 text-slate-700 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 mt-2 shrink-0"></span>
                      {REASON_LABELS[code as DbReasonCode] || code}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="pt-6 border-t border-slate-100 flex justify-between items-end text-sm text-slate-500 font-medium">
              <div>
                <p>Date: {dateString}</p>
                <p>Time: {timeString}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Button 
          onClick={() => router.push('/')} 
          className="w-full h-16 text-xl font-bold shadow-sm"
          size="lg"
        >
          Next Can <ArrowLeft className="w-6 h-6 ml-2 rotate-180" />
        </Button>
      </div>
    </div>
  )
}
