'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, XCircle, ArrowLeft, Loader2, AlertCircle, QrCode } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { getPendingEntries } from '@/lib/offlineQueue'
import { safeFetchErrorMessage } from '@/lib/errorMessages'
import type { CanTestRow } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
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
    autoDecision?: 'accepted' | 'rejected'
    isBorderline: boolean
    isOverride: boolean
    overrideReason?: string | null
    reasonCodes: string[]
    testPerformedAt: string
    isOffline: boolean
    canVolume?: number
    fatPercent: number
    snfPercent: number
    temperatureC: number
    adulterationPositive: boolean
    farmerId: string
    farmerName: string
    operatorId: string
    operatorName?: string
  } | null>(null)

  useEffect(() => {
    if (!reference) return

    async function fetchRecord() {
      setIsLoading(true)
      try {
        // 1. Try Supabase first
        const { data: dbData, error: dbError } = await supabase
          .from('can_tests')
          .select(`
            *,
            farmers(name)
          `)
          .eq('reference_code', reference)
          .maybeSingle()

        if (dbError) {
          // Real database/network error — not a "not found" situation
          console.error('Error fetching from Supabase:', dbError)
          setError(safeFetchErrorMessage(dbError))
          return
        }

        if (dbData) {
          if (dbData.operator_id) {
            const { data: opData } = await supabase.from('operator_profiles').select('name').eq('id', dbData.operator_id).single()
            ;(dbData as unknown as { operators?: { name: string } }).operators = opData || undefined
          }
          const row = dbData as CanTestRow & { farmers?: { name: string }, operators?: { name: string } }
          setRecord({
            referenceCode: row.reference_code,
            finalDecision: row.decision,
            autoDecision: row.auto_decision || undefined,
            isBorderline: row.is_borderline === true,
            isOverride: row.is_override,
            overrideReason: row.override_reason,
            reasonCodes: row.reason_codes,
            testPerformedAt: row.test_performed_at,
            isOffline: false,
            canVolume: row.can_volume !== null ? row.can_volume : undefined,
            fatPercent: row.fat_percent,
            snfPercent: row.snf_percent,
            temperatureC: row.temperature,
            adulterationPositive: row.adulteration_result,
            farmerId: row.farmer_id,
            farmerName: row.farmers?.name || 'Unknown',
            operatorId: row.operator_id,
            operatorName: row.operators?.name || undefined
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
            autoDecision: offlineMatch.autoDecision,
            isBorderline: offlineMatch.isBorderline,
            isOverride: offlineMatch.isOverride,
            overrideReason: offlineMatch.overrideReason,
            reasonCodes: offlineMatch.reasonCodes,
            testPerformedAt: offlineMatch.testPerformedAt,
            isOffline: true,
            canVolume: offlineMatch.canVolume,
            fatPercent: offlineMatch.fatPercent,
            snfPercent: offlineMatch.snfPercent,
            temperatureC: offlineMatch.temperatureC,
            adulterationPositive: offlineMatch.adulterationPositive,
            farmerId: offlineMatch.farmerId,
            farmerName: offlineMatch.farmerName,
            operatorId: offlineMatch.operatorId,
            operatorName: offlineMatch.operatorName
          })
          return
        }

        // 3. Genuinely not found in either source
        setError('Record not found. It may still be processing or may not have been saved.')
      } catch (err) {
        console.error('Unexpected error fetching result:', err)
        setError(safeFetchErrorMessage(err))
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
            <Button onClick={() => router.push('/')} className="w-full h-14 text-lg rounded-xl" variant="outline">
              <ArrowLeft className="w-5 h-5 mr-2" /> Back to Intake
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { 
    finalDecision, isOffline
  } = record
  
  // Format the timestamp nicely for the slip
  const dateObj = new Date(record.testPerformedAt)
  const timeString = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  // Use a neat date format like "14 May 2024"

  return (
    <div className="w-full bg-background min-h-screen p-4 sm:p-6 pb-24 flex flex-col justify-center">
      <div className="mx-auto max-w-lg w-full space-y-8">
        
        {/* Giant Result Icon */}
        <div className="flex flex-col items-center text-center space-y-4 py-8">
          {finalDecision === 'accepted' ? (
            <div className="w-24 h-24 rounded-full bg-emerald-100 flex items-center justify-center mb-2 shadow-inner">
              <CheckCircle2 className="w-14 h-14 text-emerald-600" />
            </div>
          ) : (
            <div className="w-24 h-24 rounded-full bg-rose-100 flex items-center justify-center mb-2 shadow-inner">
              <XCircle className="w-14 h-14 text-rose-600" />
            </div>
          )}
          
          <h2 className={cn("text-[44px] font-extrabold tracking-tight leading-none", finalDecision === 'accepted' ? "text-emerald-700" : "text-rose-700")}>
            {finalDecision === 'accepted' ? "ACCEPTED" : "REJECTED"}
          </h2>
          
          <p className="text-[17px] text-muted-foreground font-medium max-w-[280px] mt-2">
             {finalDecision === 'accepted' ? "Can recorded successfully" : "Can failed quality grading"}
          </p>

          <div className="bg-card border-2 border-input px-6 py-4 rounded-2xl mt-6 inline-flex flex-col items-center shadow-sm w-full max-w-[320px]">
            <span className="text-[12px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Reference</span>
            <span className="text-[18px] font-mono font-extrabold text-foreground">{record.referenceCode}</span>
            {finalDecision === 'accepted' && (
              <div className="mt-3 pt-3 border-t border-border w-full text-center flex flex-col items-center">
                <span className="text-[12px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Tested At</span>
                <span className="text-[16px] font-bold text-foreground">{timeString}</span>
              </div>
            )}
          </div>
        </div>

        {isOffline && (
          <div className="bg-amber-50 border-2 border-amber-200 p-4 rounded-2xl flex items-start gap-3 shadow-sm px-5">
            <CheckCircle2 className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-[16px] font-extrabold text-amber-900">SAVED OFFLINE</h4>
              <p className="text-[14px] text-amber-700 font-medium leading-snug mt-1">
                This record is safely stored on this device and will sync when connection returns.
              </p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="pt-2 space-y-4 px-2">
          {finalDecision === 'rejected' ? (
            <>
              <Button
                onClick={() => router.push(`/slip/${record.referenceCode}`)}
                className="w-full h-16 text-[18px] font-extrabold rounded-2xl bg-rose-600 hover:bg-rose-700 text-white shadow-md active:scale-[0.98] transition-all"
              >
                <QrCode className="w-6 h-6 mr-2" /> Share Rejection Slip
              </Button>
              <Button 
                onClick={() => router.push('/')} 
                variant="outline"
                className="w-full h-16 text-[18px] font-bold rounded-2xl border-2 border-input bg-card text-foreground hover:bg-muted active:scale-[0.98] transition-all"
              >
                 Next Can
              </Button>
            </>
          ) : (
            <>
              <Button 
                onClick={() => router.push('/')} 
                className="w-full h-16 text-[18px] font-extrabold rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-md active:scale-[0.98] transition-all"
              >
                 New Can
              </Button>
              <Button
                onClick={() => router.push(`/lookup/${record.referenceCode}`)}
                variant="outline"
                className="w-full h-16 text-[18px] font-bold rounded-2xl border-2 border-input bg-card text-foreground hover:bg-muted active:scale-[0.98] transition-all"
              >
                View Record
              </Button>
            </>
          )}
        </div>

      </div>
    </div>
  )
}
