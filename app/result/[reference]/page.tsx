'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { QRCodeCanvas } from 'qrcode.react'
import { CheckCircle2, AlertTriangle, XCircle, ArrowLeft, Loader2, AlertCircle, Printer, QrCode } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { getPendingEntries } from '@/lib/offlineQueue'
import { REASON_LABELS } from '@/lib/grading'
import { safeFetchErrorMessage } from '@/lib/errorMessages'
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
    finalDecision, isOverride, overrideReason, reasonCodes, isOffline,
    canVolume, fatPercent, snfPercent, temperatureC, adulterationPositive,
    farmerId, farmerName, operatorId, operatorName
  } = record
  
  // Format the timestamp nicely for the slip
  const dateObj = new Date(record.testPerformedAt)
  const timeString = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  // Use a neat date format like "14 May 2024"
  const dateString = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div className="w-full bg-slate-50 p-4 sm:p-6 pb-24">
      <div className="mx-auto max-w-lg space-y-5">
        
        {/* Page Title & Header info */}
        <div className="flex justify-between items-end mb-2 pt-2">
          <div>
            <p className="text-[11px] font-extrabold text-[#0f6041] tracking-wider uppercase mb-1">Quality Grading Result</p>
            <h2 className="text-[28px] font-extrabold text-[#052b1f] leading-none flex items-center gap-2">
              Completed &middot; <span className={cn("text-[16px] mt-1.5", isOffline ? "text-amber-600" : "text-[#7e9e94]")}>{isOffline ? 'Syncing' : 'Synced'}</span>
            </h2>
          </div>
          <div className="text-right">
            <p className="text-[14px] font-bold text-slate-900">Target</p>
            <p className="text-[13px] text-slate-500">under 10 sec</p>
          </div>
        </div>

        {/* Live Grading Box styled banner */}
        <div className={cn(
          "rounded-xl p-4 flex items-start gap-3 mt-4 border shadow-sm",
          isOverride
            ? "bg-amber-50 border-amber-200 text-amber-800"
            : finalDecision === 'accepted'
              ? "bg-[#eaf4ef] border-[#b0ebd1] text-[#0f6041]"
              : "bg-red-50 border-red-200 text-red-700"
        )}>
          {isOverride ? (
            <AlertTriangle className="w-6 h-6 shrink-0 mt-0.5" />
          ) : finalDecision === 'accepted' ? (
            <CheckCircle2 className="w-6 h-6 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-6 h-6 shrink-0 mt-0.5" />
          )}
          
          <div className="flex-1">
            <p className="text-[16px] font-bold">
              {isOverride 
                ? `OVERRIDDEN: ${finalDecision.toUpperCase()}`
                : finalDecision === 'accepted' ? "Milk Accepted" : "Milk Rejected"}
            </p>
            <p className="text-[14px] opacity-80 leading-snug mt-1 font-medium">
              {reasonCodes.length > 0 
                ? reasonCodes.filter(c => !c.startsWith('INVALID_')).map(code => REASON_LABELS[code as DbReasonCode] || code).join(', ')
                : "All tests passed successfully."}
            </p>
            {isOverride && (
               <p className="mt-2 text-sm italic opacity-80 border-t border-amber-200/50 pt-2">“{overrideReason}”</p>
            )}
          </div>
        </div>

        {/* Inputs Recorded */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 pb-2 mb-3">
            <h3 className="text-[16px] font-bold text-slate-900">Inputs Recorded</h3>
            <span className="text-slate-400 font-mono text-[13px] font-medium">{record.referenceCode}</span>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Volume</p>
              <p className="text-[16px] font-semibold text-slate-900">{canVolume !== undefined ? `${canVolume.toFixed(1)} L` : '--'}</p>
            </div>
            <div>
              <p className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Fat</p>
              <p className="text-[16px] font-semibold text-slate-900">{fatPercent?.toFixed(2)}%</p>
            </div>
            <div>
              <p className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">SNF</p>
              <p className="text-[16px] font-semibold text-slate-900">{snfPercent?.toFixed(2)}%</p>
            </div>
            <div>
              <p className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Temp</p>
              <p className="text-[16px] font-semibold text-slate-900">{temperatureC?.toFixed(1)} &deg;C</p>
            </div>
            <div className="col-span-2">
              <p className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Strip</p>
              <p className={cn("text-[16px] font-semibold", adulterationPositive ? "text-red-600" : "text-emerald-600")}>
                {adulterationPositive ? 'FAIL (Adulterated)' : 'PASS (Clear)'}
              </p>
            </div>
          </div>
        </div>

        {/* Farmer & Operator */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
          <h3 className="text-[16px] font-bold text-slate-900 border-b border-slate-100 pb-2 mb-3">Farmer &amp; Operator</h3>
          <div>
            <p className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Farmer</p>
            <p className="text-[16px] font-semibold text-slate-900">#{farmerId.substring(0,6)}, {farmerName}</p>
          </div>
          <div>
            <p className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Timestamp</p>
            <p className="text-[15px] font-medium text-slate-900">{dateString}, {timeString}</p>
          </div>
          <div>
            <p className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Operator ID</p>
            <p className="text-[15px] font-medium text-slate-900">{operatorId.substring(0,8).toUpperCase()} {operatorName ? `(${operatorName})` : ''}</p>
          </div>
        </div>



        {finalDecision === 'rejected' && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex flex-col items-center justify-center mt-4">
            <QRCodeCanvas 
               value={typeof window !== 'undefined' ? `${window.location.origin}/lookup/${encodeURIComponent(record.referenceCode)}` : ''}
               size={140}
               level="M"
               includeMargin={false}
            />
            <p className="mt-4 text-[12px] font-bold text-slate-500 uppercase tracking-widest text-center">
              Scan to view this test record
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="pt-2 space-y-3">
          {finalDecision === 'rejected' && (
            <Button
              onClick={() => router.push(`/slip/${record.referenceCode}`)}
              className="w-full h-14 text-[17px] font-bold rounded-xl bg-red-600 hover:bg-red-700 text-white shadow-sm"
            >
              <QrCode className="w-5 h-5 mr-2" /> Share Rejection Slip
            </Button>
          )}

          {finalDecision === 'accepted' && (
            <Button
              onClick={() => window.print()}
              variant="outline"
              className="w-full h-14 text-[17px] font-bold rounded-xl border-slate-200 bg-white hover:bg-slate-50 text-slate-800"
            >
              <Printer className="w-5 h-5 mr-2" /> Print Receipt
            </Button>
          )}

          <Button 
            onClick={() => router.push('/')} 
            className="w-full h-14 text-[17px] font-bold rounded-xl bg-[#0f6041] hover:bg-[#0c4a32] text-white shadow-sm"
          >
             Next Can
          </Button>
        </div>

      </div>
    </div>
  )
}
