'use client'

import React, { useEffect, useState, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import { QRCodeCanvas } from 'qrcode.react'
import * as htmlToImage from 'html-to-image'
import { Loader2, ArrowLeft, Download, Share2, CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { getPendingEntries } from '@/lib/offlineQueue'
import { REASON_LABELS } from '@/lib/grading'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { DbReasonCode, CanTestWithDetails } from '@/types/database'
import { cn } from '@/lib/utils'

type SlipData = {
  referenceCode: string
  testPerformedAt: string
  farmerName: string
  operatorName: string
  canVolume?: number
  fatPercent: number
  snfPercent: number
  temperatureC: number
  adulterationPositive: boolean
  decision: 'accepted' | 'rejected'
  autoDecision?: 'accepted' | 'rejected'
  reasonCodes: DbReasonCode[]
  isOverride: boolean
  overrideReason?: string
  isBorderline: boolean
  isOffline: boolean
}

export default function RejectionSlipPage({ params }: { params: Promise<{ referenceCode: string }> | { referenceCode: string } }) {
  const router = useRouter()
  const unwrappedParams = params instanceof Promise ? use(params) : params
  const referenceCode = unwrappedParams.referenceCode

  const slipRef = useRef<HTMLDivElement>(null)
  
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [record, setRecord] = useState<SlipData | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isExportSuccess, setIsExportSuccess] = useState(false)
  const [lookupUrl, setLookupUrl] = useState('')

  useEffect(() => {
    if (!referenceCode) return

    async function fetchRecord() {
      setIsLoading(true)
      try {
        // 1. Try Supabase first with a JOIN
        const { data: dbData, error: dbError } = await supabase
          .from('can_tests')
          .select(`
            *,
            farmer:farmers (name)
          `)
          .eq('reference_code', referenceCode)
          .maybeSingle()
          .returns<CanTestWithDetails>()

        if (dbData) {
          if (dbData.operator_id) {
            const { data: opData } = await supabase.from('operator_profiles').select('name').eq('id', dbData.operator_id).single()
            ;(dbData as unknown as { operator?: { name: string } }).operator = opData || { name: 'Unknown' }
          }
          // It's a CanTestRow with joined relations
          const joinedData = dbData
          
          setRecord({
            referenceCode: joinedData.reference_code,
            testPerformedAt: joinedData.test_performed_at,
            farmerName: joinedData.farmer?.name || 'Unknown',
            operatorName: (joinedData as unknown as { operator?: { name: string } }).operator?.name || 'Unknown',
            canVolume: joinedData.can_volume,
            fatPercent: joinedData.fat_percent,
            snfPercent: joinedData.snf_percent,
            temperatureC: joinedData.temperature,
            adulterationPositive: joinedData.adulteration_result,
            decision: joinedData.decision,
            autoDecision: joinedData.auto_decision || undefined,
            reasonCodes: joinedData.reason_codes,
            isOverride: joinedData.is_override,
            overrideReason: joinedData.override_reason || undefined,
            isBorderline: joinedData.is_borderline === true,
            isOffline: false
          })
          return
        }

        // 2. Fallback to offline queue
        const pending = await getPendingEntries()
        const offlineMatch = pending.find(e => e.referenceCode === referenceCode)
        
        if (offlineMatch) {
          setRecord({
            referenceCode: offlineMatch.referenceCode,
            testPerformedAt: offlineMatch.testPerformedAt,
            farmerName: offlineMatch.farmerName,
            operatorName: offlineMatch.operatorName,
            canVolume: offlineMatch.canVolume,
            fatPercent: offlineMatch.fatPercent,
            snfPercent: offlineMatch.snfPercent,
            temperatureC: offlineMatch.temperatureC,
            adulterationPositive: offlineMatch.adulterationPositive,
            decision: offlineMatch.finalDecision,
            autoDecision: offlineMatch.autoDecision,
            reasonCodes: offlineMatch.reasonCodes,
            isOverride: offlineMatch.isOverride,
            overrideReason: offlineMatch.overrideReason,
            isBorderline: offlineMatch.isBorderline,
            isOffline: true
          })
          return
        }

        if (dbError) throw dbError

        setError('Record not found. It may have been deleted or never saved.')
      } catch (err) {
        console.error('Error fetching result:', err)
        setError('Failed to load record.')
      } finally {
        setIsLoading(false)
      }
    }

    fetchRecord()
  }, [referenceCode])

  useEffect(() => {
    if (record) {
      setLookupUrl(`${window.location.origin}/lookup/${encodeURIComponent(record.referenceCode)}`)
    }
  }, [record])

  const handleExport = async (action: 'download' | 'share') => {
    if (!slipRef.current || !record) return
    
    setIsExporting(true)
    setIsExportSuccess(false)
    setError(null)
    try {
      const dataUrl = await htmlToImage.toPng(slipRef.current, {
        quality: 1,
        backgroundColor: '#ffffff',
        pixelRatio: 2
      })

      const filename = `RejectionSlip-${record.referenceCode}.png`

      if (action === 'share' && navigator.share) {
        try {
          const blob = await (await fetch(dataUrl)).blob()
          const file = new File([blob], filename, { type: 'image/png' })
          
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: 'Milk Can Rejection Slip',
              text: `Rejection Slip ${record.referenceCode}`,
              files: [file]
            })
            setIsExportSuccess(true)
            return
          }
        } catch (shareErr) {
          // If share is aborted by user or fails, fallback to download
          if ((shareErr as Error).name !== 'AbortError') {
             console.warn('Share failed, falling back to download', shareErr)
          } else {
             return // Aborted by user
          }
        }
      }

      // Fallback Download
      const link = document.createElement('a')
      link.download = filename
      link.href = dataUrl
      link.click()
      setIsExportSuccess(true)
    } catch (err) {
      console.error('Export failed:', err)
      setError('Failed to export slip. Please try again.')
    } finally {
      setIsExporting(false)
      setTimeout(() => setIsExportSuccess(false), 3000)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center pt-8 pb-12">
        <Skeleton className="w-[375px] max-w-full h-[600px] bg-white rounded-none shadow-sm" />
      </div>
    )
  }

  if (!record) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <Card className="max-w-md w-full border-red-200 shadow-sm">
          <CardHeader className="bg-red-50 text-red-900 rounded-t-xl">
            <AlertCircle className="w-8 h-8 mb-2" />
            <CardTitle>Record Not Found</CardTitle>
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

  const dateObj = new Date(record.testPerformedAt)
  const timeString = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const dateString = dateObj.toLocaleDateString()

  // 6. ACCEPTED RESULT
  if (record.decision === 'accepted') {
    return (
      <div className="min-h-screen bg-slate-50 p-4 md:p-6 flex items-center justify-center">
        <div className="w-full max-w-md space-y-6">
          <Card className="shadow-sm border-emerald-200 overflow-hidden">
            <div className="bg-emerald-600 p-8 text-center text-white">
              <CheckCircle2 className="w-20 h-20 mx-auto mb-4 opacity-90" />
              <h1 className="text-2xl font-black tracking-tight mb-1 uppercase">
                {record.isOverride ? 'ACCEPTED (OVERRIDE)' : 'CAN ACCEPTED'}
              </h1>
              <p className="text-emerald-100 font-medium font-mono text-lg">{record.referenceCode}</p>
            </div>
            <CardContent className="p-6 bg-white space-y-4">
              {record.isBorderline && (
                <div className="bg-amber-50 border border-amber-200 px-3 py-2 font-bold text-amber-900 text-sm">
                  BORDERLINE — REVIEW
                </div>
              )}
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500 font-medium">Farmer</span>
                <span className="font-bold text-slate-900 text-right">{record.farmerName}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500 font-medium">Tested At</span>
                <span className="font-medium text-slate-900 text-right">{dateString} {timeString}</span>
              </div>
              {record.canVolume !== undefined && (
                 <div className="flex justify-between border-b pb-2">
                    <span className="text-slate-500 font-medium">Volume</span>
                    <span className="font-medium text-slate-900 text-right">{record.canVolume} L</span>
                 </div>
              )}
              {record.isOverride && (
                 <div className="pt-2">
                    <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">System Suggestion</span>
                    <span className="font-bold text-slate-600 line-through uppercase mb-3 block">
                      {record.autoDecision || 'Unavailable for this legacy record'}
                    </span>
                    
                    <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-0.5">Override Reason</span>
                    {record.overrideReason ? (
                      <span className="font-medium text-slate-900 italic">&quot;{record.overrideReason}&quot;</span>
                    ) : (
                      <span className="font-medium text-slate-500">No override reason provided</span>
                    )}
                 </div>
              )}
            </CardContent>
          </Card>
          <Button onClick={() => router.push('/')} className="w-full h-14 text-lg font-bold">
            <ArrowLeft className="w-5 h-5 mr-2" /> Back to Intake
          </Button>
        </div>
      </div>
    )
  }

  // REJECTION SLIP
  return (
    <div className="min-h-screen bg-slate-100 p-4 pb-24 md:py-8 flex flex-col items-center">
      {record.isOffline && (
        <div className="mb-4 w-full max-w-[375px] p-3 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          Pending sync — showing offline record
        </div>
      )}

      {/* Slip Wrapper for Export */}
      <div 
        ref={slipRef}
        className="w-[375px] max-w-full bg-white shadow-xl rounded-none border border-slate-200 overflow-hidden"
        style={{
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)'
        }}
      >
        {/* Header */}
        <div className="pt-8 pb-6 px-6 text-center border-b-[3px] border-black">
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500 mb-2">MCC Central</h2>
          <h1 className="text-2xl font-black uppercase tracking-tight text-black leading-tight">
            MILK CAN<br/>REJECTION SLIP
          </h1>
        </div>

        {/* Core Evidence */}
        <div className="px-6 py-5 border-b-2 border-slate-100 space-y-4">
          <div className="flex flex-col">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Original Test Record</span>
            <span className="font-mono text-xl font-bold tracking-tight text-black">{record.referenceCode}</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-0.5">Tested At</span>
              <span className="font-semibold text-slate-800">{dateString} {timeString}</span>
            </div>
            <div>
               <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-0.5">Recorded By</span>
               <span className="font-semibold text-slate-800">{record.operatorName}</span>
            </div>
          </div>
          
          <div>
            <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-0.5">Farmer</span>
            <span className="text-lg font-bold text-black">{record.farmerName}</span>
          </div>
        </div>

        {/* Test Values */}
        <div className="px-6 py-5 border-b-2 border-slate-100 bg-slate-50/50">
          <h3 className="text-sm font-bold uppercase tracking-widest text-slate-900 mb-4 border-l-4 border-black pl-2">
            Physical Readings
          </h3>
          
          <div className="grid grid-cols-2 gap-y-4 gap-x-6">
            {record.canVolume !== undefined && (
              <div className="col-span-2 flex justify-between border-b border-slate-200 pb-2">
                <span className="font-medium text-slate-600">Volume</span>
                <span className="font-bold text-black">{record.canVolume.toFixed(1)} L</span>
              </div>
            )}
            
            <div className="flex flex-col">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Fat</span>
              <span className="text-lg font-bold text-black">{record.fatPercent.toFixed(2)}%</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">SNF</span>
              <span className="text-lg font-bold text-black">{record.snfPercent.toFixed(2)}%</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Temp</span>
              <span className="text-lg font-bold text-black">{record.temperatureC.toFixed(1)}°C</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Adulteration</span>
              <span className={cn("text-lg font-bold", record.adulterationPositive ? "text-red-600" : "text-black")}>
                {record.adulterationPositive ? 'FAIL' : 'PASS'}
              </span>
            </div>
          </div>
        </div>

        {/* Reason / Outcome */}
        <div className="px-6 py-6 border-b-2 border-slate-100">
          
          {/* Borderline explicitly visible */}
          {record.isBorderline && (
             <div className="mb-4 inline-block bg-slate-100 border-l-4 border-slate-800 px-3 py-1.5 font-bold text-slate-800 text-sm">
                BORDERLINE — REVIEW
             </div>
          )}

          {record.isOverride ? (
            <div className="space-y-4">
              <div className="opacity-75">
                <span className="block text-xs font-bold uppercase tracking-wider mb-1">System Suggestion</span>
                <span className="font-black text-lg line-through uppercase">
                  {record.autoDecision || 'Unavailable for this legacy record'}
                </span>
              </div>
              <div className="bg-red-50 border border-red-100 p-3 rounded">
                 <span className="block text-xs font-bold text-red-800 uppercase tracking-wider mb-1">Final Decision</span>
                 <span className="font-black text-xl text-red-900">REJECTED</span>
                 <span className="block font-bold text-sm text-red-700 mt-1 uppercase tracking-tight">— OPERATOR OVERRIDE —</span>
              </div>
              <div>
                <span className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-0.5">Override Reason</span>
                {record.overrideReason ? (
                  <span className="font-medium text-slate-900 italic">&quot;{record.overrideReason}&quot;</span>
                ) : (
                  <span className="font-medium text-slate-500">No override reason provided</span>
                )}
              </div>
            </div>
          ) : (
            <div>
               <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Final Decision</span>
               <span className="font-black text-2xl text-black">REJECTED</span>
            </div>
          )}

          {record.reasonCodes.length > 0 && (
            <div className="mt-5">
              <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Rejection Remarks</span>
              <ul className="space-y-2">
                {record.reasonCodes.map(code => (
                  <li key={code} className="flex items-start text-black font-semibold">
                    <span className="mr-2 mt-1.5 block w-1.5 h-1.5 bg-black rounded-full shrink-0"></span>
                    {REASON_LABELS[code] || code}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* QR Code */}
        {lookupUrl && (
          <div className="px-6 py-8 flex flex-col items-center justify-center bg-slate-50 text-center">
            <QRCodeCanvas 
               value={lookupUrl}
               size={120}
               level="M"
               includeMargin={false}
            />
            <p className="mt-4 text-xs font-bold text-slate-500 uppercase tracking-widest">
              Scan to view this test record
            </p>
          </div>
        )}
      </div>

      {/* Actions (Excluded from Export) */}
      <div className="w-[375px] max-w-full mt-6 space-y-3 pb-8">
        {error && (
          <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm font-medium">
            {error}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Button 
            variant="outline" 
            className="h-14 font-bold bg-white text-slate-700 hover:text-slate-900"
            onClick={() => handleExport('download')}
            disabled={isExporting}
          >
            {isExporting ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Download className="w-5 h-5 mr-2" />}
            Save Image
          </Button>
          <Button 
            className="h-14 font-bold bg-blue-600 hover:bg-blue-700 text-white"
            onClick={() => handleExport('share')}
            disabled={isExporting}
          >
            {isExporting ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Share2 className="w-5 h-5 mr-2" />}
            {isExportSuccess ? 'Done!' : 'Share Slip'}
          </Button>
        </div>
        
        <Button 
          variant="ghost"
          className="w-full h-14 font-bold text-slate-500 hover:text-slate-800 mt-2"
          onClick={() => router.push('/')}
        >
          <ArrowLeft className="w-5 h-5 mr-2" />
          Back to Intake
        </Button>
      </div>
    </div>
  )
}
