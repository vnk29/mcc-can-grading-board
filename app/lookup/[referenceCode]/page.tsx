'use client'

import React, { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ArrowLeft, ArrowRight, CheckCircle2, XCircle, AlertTriangle, AlertCircle, FileEdit, QrCode } from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import { format } from 'date-fns'

import { supabase } from '@/lib/supabase'
import { REASON_LABELS } from '@/lib/grading'
import type { CanTestWithDetails, CorrectionWithOperator, DbReasonCode, DisputeStatus, DisputeResolutionType } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export default function RecordDetailPage({
  params,
}: {
  params: Promise<{ referenceCode: string }> | { referenceCode: string }
}) {
  const router = useRouter()
  const unwrappedParams = params instanceof Promise ? use(params) : params
  const referenceCode = unwrappedParams.referenceCode

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const [record, setRecord] = useState<CanTestWithDetails | null>(null)
  const [isOfflineRecord, setIsOfflineRecord] = useState(false)
  const [corrections, setCorrections] = useState<CorrectionWithOperator[]>([])
  const [operators, setOperators] = useState<{ id: string; name: string }[]>([])

  // Correction Modal State
  const [showCorrectionModal, setShowCorrectionModal] = useState(false)
  const [isSubmittingCorrection, setIsSubmittingCorrection] = useState(false)
  const [correctionError, setCorrectionError] = useState<string | null>(null)
  
  // Correction Form Values
  const [activeOperatorId, setActiveOperatorId] = useState<string>('')
  const [activePin, setActivePin] = useState<string>('')
  const [showPinDialog, setShowPinDialog] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState('')
  
  const [correctionReason, setCorrectionReason] = useState('')
  const [newVolume, setNewVolume] = useState('')
  const [newFat, setNewFat] = useState('')
  const [newSnf, setNewSnf] = useState('')
  const [newTemp, setNewTemp] = useState('')
  const [newDecision, setNewDecision] = useState<string>('')

  // Dispute State
  const [disputeStatus, setDisputeStatus] = useState<{ status: DisputeStatus, submitted_at: string, resolved_at: string | null, resolution_type: DisputeResolutionType | null } | null>(null)
  const [batchHistory, setBatchHistory] = useState<Pick<CanTestWithDetails, 'reference_code' | 'test_performed_at' | 'decision' | 'reason_codes' | 'is_override'>[]>([])
  
  // Dispute Modal State
  const [showDisputeModal, setShowDisputeModal] = useState(false)
  const [isSubmittingDispute, setIsSubmittingDispute] = useState(false)
  const [disputeReason, setDisputeReason] = useState('')
  const [disputeError, setDisputeError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceCode])

  const fetchData = async () => {
    setIsLoading(true)
    setError(null)
    try {
      // 1. Fetch main record
      const { data: dbData, error: dbError } = await supabase
        .from('can_tests')
        .select(`
          *,
          farmer:farmers!inner (name, phone, village)
        `)
        .eq('reference_code', referenceCode)
        .maybeSingle()

      if (dbError) throw dbError
      
      let canTest = dbData as unknown as CanTestWithDetails
      if (canTest && canTest.operator_id) {
        const { data: opData } = await supabase.from('operator_profiles').select('name').eq('id', canTest.operator_id).single()
        canTest.operator = opData || { name: 'Unknown' }
      }
      let isOffline = false

      if (!canTest) {
        // Fallback to offline queue
        const { getPendingEntries } = await import('@/lib/offlineQueue')
        const pending = await getPendingEntries()
        const offlineEntry = pending.find(e => e.referenceCode === referenceCode)
        if (offlineEntry) {
          isOffline = true
          // Map offline entry to CanTestWithDetails shape
          canTest = {
            id: offlineEntry.id,
            farmer_id: offlineEntry.farmerId,
            operator_id: offlineEntry.operatorId,
            can_volume: offlineEntry.canVolume || 0,
            fat_percent: offlineEntry.fatPercent,
            snf_percent: offlineEntry.snfPercent,
            temperature: offlineEntry.temperatureC,
            adulteration_result: offlineEntry.adulterationPositive,
            auto_decision: offlineEntry.autoDecision,
            decision: offlineEntry.finalDecision,
            is_borderline: offlineEntry.isBorderline,
            borderline_flags: offlineEntry.borderlineFlags,
            reason_codes: offlineEntry.reasonCodes,
            is_override: offlineEntry.isOverride,
            override_reason: offlineEntry.overrideReason || null,
            reference_code: offlineEntry.referenceCode,
            photo_url: offlineEntry.photoUrl || null,
            test_performed_at: offlineEntry.testPerformedAt,
            created_at: offlineEntry.testPerformedAt,
            farmer: {
              name: offlineEntry.farmerName,
              phone: null,
              village: null,
            },
            operator: {
              name: offlineEntry.operatorName,
            }
          } as unknown as CanTestWithDetails
        } else {
          setError('Record not found. It may be invalid or not yet synced.')
          return
        }
      }

      setRecord(canTest)
      setIsOfflineRecord(isOffline)

      // 2. Fetch corrections
      const { data: corrData, error: corrError } = await supabase
        .from('corrections')
        .select('*')
        .eq('can_test_id', canTest.id)
        .order('created_at', { ascending: true })

      if (corrError) throw corrError
      
      let correctionsWithOps: CorrectionWithOperator[] = []
      if (corrData && corrData.length > 0) {
        const { data: opsData } = await supabase.from('operator_profiles').select('id, name')
        correctionsWithOps = corrData.map(c => {
          const op = opsData?.find(o => o.id === c.corrected_by)
          return { ...c, operator: op ? { name: op.name } : { name: 'Unknown' } }
        })
      }
      setCorrections(correctionsWithOps as CorrectionWithOperator[])

      // 3. Fetch dispute status and batch history for online records
      if (!isOffline && canTest) {
        const { data: disputeData, error: disputeError } = await supabase.rpc('get_dispute_status', {
          p_can_test_id: canTest.id,
          p_reference_code: canTest.reference_code
        })
        if (disputeError) throw disputeError
        setDisputeStatus(disputeData ?? null)

        const { data: batchData } = await supabase
          .from('can_tests')
          .select('reference_code, test_performed_at, decision, reason_codes, is_override')
          .eq('farmer_id', canTest.farmer_id)
          .order('test_performed_at', { ascending: false })
          .limit(5)
        
        if (batchData) {
          setBatchHistory(batchData as unknown as Pick<CanTestWithDetails, 'reference_code' | 'test_performed_at' | 'decision' | 'reason_codes' | 'is_override'>[])
        }
      }

      // 4. Fetch operators for the correction auth
      const { data: opsData } = await supabase.from('operator_profiles').select('id, name').order('name')
      if (opsData) {
        setOperators(opsData)
        
        // Check session storage
        const savedOpId = sessionStorage.getItem('active_operator_id')
        if (savedOpId && opsData.find(o => o.id === savedOpId)) {
          setActiveOperatorId(savedOpId)
        }
      }

    } catch (err) {
      console.error(err)
      setError('Failed to load record details. Please check connection.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleOpenCorrection = () => {
    if (!activeOperatorId || !activePin) {
      setShowPinDialog(true)
      return
    }
    
    // Pre-fill with existing values
    if (record) {
      setNewVolume(record.can_volume?.toString() || '')
      setNewFat(record.fat_percent?.toString() || '')
      setNewSnf(record.snf_percent?.toString() || '')
      setNewTemp(record.temperature?.toString() || '')
      setNewDecision(record.decision)
    }
    setCorrectionReason('')
    setCorrectionError(null)
    setShowCorrectionModal(true)
  }

  const verifyPin = () => {
    // We now just check if they typed *something* and save it.
    // The actual PIN verification happens inside the secure RPC on submit.
    if (pinInput.trim().length > 0) {
      sessionStorage.setItem('active_operator_id', activeOperatorId)
      setActivePin(pinInput) // Store securely in component memory
      setShowPinDialog(false)
      setPinInput('')
      setPinError('')
      
      // Open the correction form directly since state updates are asynchronous
      if (record) {
        setNewVolume(record.can_volume?.toString() || '')
        setNewFat(record.fat_percent?.toString() || '')
        setNewSnf(record.snf_percent?.toString() || '')
        setNewTemp(record.temperature?.toString() || '')
        setNewDecision(record.decision)
      }
      setCorrectionReason('')
      setCorrectionError(null)
      setShowCorrectionModal(true)
    } else {
      setPinError('PIN is required')
    }
  }

  const submitDispute = async () => {
    if (!record || !disputeReason.trim()) {
      setDisputeError('Please provide a reason for the dispute.')
      return
    }

    setIsSubmittingDispute(true)
    setDisputeError(null)

    try {
      const { error } = await supabase.rpc('submit_dispute', {
        p_can_test_id: record.id,
        p_reference_code: record.reference_code,
        p_farmer_message: disputeReason.trim()
      })

      if (error) throw error

      setShowDisputeModal(false)
      await fetchData()
    } catch (err: unknown) {
      console.error(err)
      setDisputeError('Failed to submit dispute. Please try again.')
    } finally {
      setIsSubmittingDispute(false)
    }
  }

  const submitCorrection = async () => {
    if (!record || !activeOperatorId) return
    
    if (!correctionReason.trim()) {
      setCorrectionError('A reason for the correction is required.')
      return
    }

    setIsSubmittingCorrection(true)
    setCorrectionError(null)

    try {
      const oldValues = {
        can_volume: record.can_volume,
        fat_percent: record.fat_percent,
        snf_percent: record.snf_percent,
        temperature: record.temperature,
        decision: record.decision
      }

      const newValues = {
        can_volume: newVolume ? parseFloat(newVolume) : null,
        fat_percent: newFat ? parseFloat(newFat) : null,
        snf_percent: newSnf ? parseFloat(newSnf) : null,
        temperature: newTemp ? parseFloat(newTemp) : null,
        decision: newDecision
      }

      // Check if any value actually changed
      const hasChanges = Object.keys(oldValues).some(
        key => oldValues[key as keyof typeof oldValues] !== newValues[key as keyof typeof newValues]
      )

      if (!hasChanges) {
        setCorrectionError('You must change at least one value to submit an amendment.')
        setIsSubmittingCorrection(false)
        return
      }

      if (!activePin) {
        setCorrectionError('Operator PIN is missing. Please re-authenticate.')
        setIsSubmittingCorrection(false)
        return
      }

      const { error } = await supabase.rpc('submit_correction', {
        p_operator_id: activeOperatorId,
        p_pin: activePin,
        p_can_test_id: record.id,

        p_new_values: newValues,
        p_reason: correctionReason.trim()
      })

      if (error) throw error

      setShowCorrectionModal(false)
      // Refresh to see amendment
      await fetchData()

    } catch (err: unknown) {
      console.error(err)
      const errObj = typeof err === 'object' && err !== null ? err : {}
      const errorCode = 'code' in errObj ? String((errObj as { code: unknown }).code) : ''
      const errorStatus = 'status' in errObj ? Number((errObj as { status: unknown }).status) : 0

      const errObjMessage = 'message' in errObj ? String((errObj as { message: unknown }).message) : ''
      const errorMsg = errObjMessage || (err instanceof Error ? err.message : String(err))

      const isUnauthorized =
        errorStatus === 401 ||
        errorStatus === 403 ||
        errorCode === '42501' || // Insufficient privilege
        (errorCode === 'P0001' && errorMsg.toLowerCase().includes('unauthorized')) ||
        errorMsg.toLowerCase().includes('unauthorized')

      if (isUnauthorized) {
        setCorrectionError('Invalid Operator PIN. Please try again.')
        setActivePin('') // Clear invalid PIN to prompt re-entry next time
      } else {
        setCorrectionError('Failed to save correction. Please try again.')
      }
    } finally {
      setIsSubmittingCorrection(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 pb-24">
        <div className="bg-white border-b h-16"></div>
        <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
          <Skeleton className="w-full h-24 rounded-lg" />
          <Skeleton className="w-full h-80 rounded-xl" />
          <Skeleton className="w-full h-40 rounded-xl" />
        </div>
      </div>
    )
  }

  if (error || !record) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">
        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
        <h2 className="text-xl font-bold mb-2">Record Not Found</h2>
        <p className="text-slate-500 mb-6">{error}</p>
        <Button onClick={() => router.push('/lookup')}>Back to Search</Button>
      </div>
    )
  }

  const dateObj = new Date(record.test_performed_at)
  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <div className="w-full bg-white border-b border-slate-200">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center">
          <button onClick={() => router.push('/lookup')} className="flex items-center text-[#0f6041] font-bold text-[15px] hover:underline">
            <ArrowLeft className="w-5 h-5 mr-1" /> Back to Ledger
          </button>
        </div>
      </div>

      <div className="max-w-lg mx-auto p-4 sm:p-6 space-y-5 mt-2">
        {/* Header Info */}
        <div className="flex justify-between items-end mb-2 pt-2">
          <div>
            <p className="text-[11px] font-extrabold text-[#0f6041] tracking-wider uppercase mb-1">Record Detail</p>
            <h2 className="text-[28px] font-extrabold text-[#052b1f] leading-none flex items-center gap-2">
              Status: <span className={cn("text-[16px] mt-1.5", isOfflineRecord ? "text-amber-600" : "text-[#7e9e94]")}>{isOfflineRecord ? 'Pending Sync' : 'Synced'}</span>
            </h2>
          </div>
          <div className="text-right">
            <p className="text-[14px] font-bold text-slate-900">Record ID</p>
            <p className="text-[13px] text-slate-500 font-mono">{record.reference_code}</p>
          </div>
        </div>

        {isOfflineRecord && (
          <div className="p-3 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-[14px] font-medium flex items-start gap-2 shadow-sm">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span>Saved Offline. Amendments are disabled until it syncs.</span>
          </div>
        )}

        {/* Live Grading Box styled banner */}
        <div className={cn(
          "rounded-xl p-4 flex items-start gap-3 mt-4 border shadow-sm",
          record.is_override
            ? "bg-amber-50 border-amber-200 text-amber-800"
            : record.decision === 'accepted'
              ? "bg-[#eaf4ef] border-[#b0ebd1] text-[#0f6041]"
              : "bg-red-50 border-red-200 text-red-700"
        )}>
          {record.is_override ? (
            <AlertTriangle className="w-6 h-6 shrink-0 mt-0.5" />
          ) : record.decision === 'accepted' ? (
            <CheckCircle2 className="w-6 h-6 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-6 h-6 shrink-0 mt-0.5" />
          )}
          
          <div className="flex-1">
            <p className="text-[16px] font-bold">
              {record.is_override 
                ? `OVERRIDDEN: ${record.decision.toUpperCase()}`
                : record.decision === 'accepted' ? "Milk Accepted" : "Milk Rejected"}
            </p>
            <p className="text-[14px] opacity-80 leading-snug mt-1 font-medium">
              {(() => {
                const validCodes = record.reason_codes ? record.reason_codes.filter(c => !c.startsWith('INVALID_')) : [];
                return validCodes.length > 0
                  ? validCodes.map(code => REASON_LABELS[code as DbReasonCode] || code).join(', ')
                  : "All tests passed successfully.";
              })()}
            </p>
            {record.is_override && (
               <p className="mt-2 text-[14px] italic opacity-80 border-t border-amber-200/50 pt-2">“{record.override_reason}”</p>
            )}
          </div>
        </div>

        {/* Inputs Recorded */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 pb-2 mb-3">
            <h3 className="text-[16px] font-bold text-slate-900">Inputs Recorded</h3>
            <span className="text-slate-400 font-mono text-[13px] font-medium">{record.reference_code}</span>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Volume</p>
              <p className="text-[16px] font-semibold text-slate-900">{record.can_volume !== null && record.can_volume !== undefined ? `${record.can_volume.toFixed(1)} L` : '--'}</p>
            </div>
            <div>
              <p className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Fat</p>
              <p className="text-[16px] font-semibold text-slate-900">{record.fat_percent?.toFixed(2)}%</p>
            </div>
            <div>
              <p className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">SNF</p>
              <p className="text-[16px] font-semibold text-slate-900">{record.snf_percent?.toFixed(2)}%</p>
            </div>
            <div>
              <p className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Temp</p>
              <p className="text-[16px] font-semibold text-slate-900">{record.temperature?.toFixed(1)} &deg;C</p>
            </div>
            <div className="col-span-2">
              <p className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Strip</p>
              <p className={cn("text-[16px] font-semibold", record.adulteration_result ? "text-red-600" : "text-emerald-600")}>
                {record.adulteration_result ? 'FAIL (Adulterated)' : 'PASS (Clear)'}
              </p>
            </div>
          </div>
        </div>

        {/* Evidence */}
        {record.evidence_type && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
            <h3 className="text-[16px] font-bold text-slate-900 border-b border-slate-100 pb-2 mb-3">Evidence</h3>
            {record.evidence_type === 'photo' && record.photo_url && (
              <div className="space-y-2">
                <p className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Attached Photo</p>
                <div className="rounded-lg overflow-hidden border border-slate-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={record.photo_url} alt="Evidence" className="w-full h-auto object-cover max-h-64" />
                </div>
              </div>
            )}
            {record.evidence_type === 'sensory' && record.sensory_note && (
              <div className="space-y-2">
                <p className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Inspector Note</p>
                <p className="text-[16px] text-slate-900 bg-slate-50 p-3 rounded-lg border border-slate-200 italic">
                  “{record.sensory_note}”
                </p>
              </div>
            )}
          </div>
        )}

        {/* Farmer & Operator */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
          <h3 className="text-[16px] font-bold text-slate-900 border-b border-slate-100 pb-2 mb-3">Farmer &amp; Operator</h3>
          <div>
            <p className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Farmer</p>
            <p className="text-[16px] font-semibold text-slate-900">#{record.farmer_id.substring(0,6)}, {record.farmer?.name}</p>
          </div>
          <div>
            <p className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Timestamp</p>
            <p className="text-[15px] font-medium text-slate-900">{format(dateObj, 'dd MMM yyyy, hh:mm a')}</p>
          </div>
          <div>
            <p className="text-[12px] text-slate-500 font-bold uppercase tracking-wider mb-1">Operator ID</p>
            <p className="text-[15px] font-medium text-slate-900">{record.operator_id.substring(0,8).toUpperCase()} {record.operator?.name ? `(${record.operator.name})` : ''}</p>
          </div>
        </div>

        {record.decision === 'rejected' && (
          <div className="pt-2 pb-2 space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex flex-col items-center justify-center">
              <QRCodeCanvas 
                 value={typeof window !== 'undefined' ? `${window.location.origin}/lookup/${encodeURIComponent(record.reference_code)}` : ''}
                 size={140}
                 level="M"
                 includeMargin={false}
              />
              <p className="mt-4 text-[12px] font-bold text-slate-500 uppercase tracking-widest text-center">
                Scan to view this test record
              </p>
            </div>
            
            {!disputeStatus && !isOfflineRecord && (
              <Button
                onClick={() => setShowDisputeModal(true)}
                className="w-full h-14 text-[17px] font-bold rounded-xl bg-slate-900 hover:bg-slate-800 text-white shadow-sm"
              >
                Dispute this Result
              </Button>
            )}

            {disputeStatus && (
              <div className={cn(
                "border rounded-xl p-4 flex gap-3",
                disputeStatus.status === 'resolved' 
                  ? (disputeStatus.resolution_type === 'adjustment' ? "bg-green-50 border-green-200 text-green-900" : "bg-red-50 border-red-200 text-red-900")
                  : "bg-blue-50 border-blue-200 text-blue-900"
              )}>
                {disputeStatus.status === 'resolved' ? (
                  disputeStatus.resolution_type === 'adjustment' ? <CheckCircle2 className="w-6 h-6 shrink-0 mt-0.5" /> : <XCircle className="w-6 h-6 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-6 h-6 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-bold text-[15px]">
                    {disputeStatus.status === 'resolved' 
                      ? `Dispute Resolved: ${disputeStatus.resolution_type === 'adjustment' ? 'Accepted' : 'Rejected'}`
                      : 'Dispute already submitted'}
                  </p>
                  <p className="text-[13px] mt-1 opacity-90">
                    {disputeStatus.status === 'resolved'
                      ? 'An operator has reviewed this dispute and made a final decision.'
                      : 'An operator at the collection center can now review this dispute.'}
                  </p>
                </div>
              </div>
            )}
            
            <Button
              onClick={() => router.push(`/slip/${record.reference_code}`)}
              variant="outline"
              className="w-full h-14 text-[17px] font-bold rounded-xl border-slate-200 bg-white hover:bg-slate-50 text-slate-800 shadow-sm"
            >
              <QrCode className="w-5 h-5 mr-2" /> View Rejection Slip
            </Button>
          </div>
        )}

        {/* Amendments */}
        <div className="mt-8 border-t border-slate-200 pt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-[18px] text-slate-900">Amendments</h3>
            {!isOfflineRecord && (
              <button 
                onClick={handleOpenCorrection} 
                className="flex items-center text-[#0f6041] font-bold text-[14px] hover:underline"
              >
                <FileEdit className="w-4 h-4 mr-1.5" /> Request Correction
              </button>
            )}
          </div>
          
          {corrections.length === 0 ? (
            <div className="p-6 text-center border-2 border-dashed border-slate-200 rounded-xl bg-white text-slate-500">
              <p className="font-medium text-[15px] text-slate-600">No amendments</p>
              <p className="text-[13px] mt-1">This original record has not been corrected.</p>
            </div>
          ) : (
             <div className="space-y-4">
               {corrections.map((corr, idx) => (
                 <div key={corr.id} className="relative">
                    {idx === 0 && <div className="absolute -top-3 left-6 w-0.5 h-3 bg-slate-200"></div>}
                    <div className="absolute -bottom-4 left-6 w-0.5 h-4 bg-slate-200 last:hidden"></div>
                    
                    <div className="border border-blue-200 rounded-xl bg-white shadow-sm relative z-10 overflow-hidden">
                      <div className="bg-blue-50/50 px-4 py-3 border-b border-blue-100 flex items-center justify-between">
                         <div className="flex items-center gap-2">
                           <FileEdit className="w-4 h-4 text-blue-600" />
                           <span className="text-[13px] font-bold text-blue-900 uppercase tracking-widest">
                             AMENDMENT
                           </span>
                         </div>
                         <span className="text-[12px] font-semibold text-slate-500">
                           {format(new Date(corr.created_at), 'MMM d, h:mm a')}
                         </span>
                      </div>
                      <div className="p-4 space-y-3">
                         <div>
                           <span className="text-[12px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">Corrected By</span>
                           <span className="font-medium text-[15px] text-slate-900">{corr.operator?.name}</span>
                         </div>
                         <div>
                           <span className="text-[12px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">Reason for Amendment</span>
                           <span className="font-medium text-[15px] text-slate-900 italic">“{corr.reason}”</span>
                         </div>
                         <div className="pt-3 border-t mt-3">
                           <span className="text-[12px] font-bold text-slate-500 uppercase tracking-wider block mb-2">Changed Values</span>
                           <div className="grid grid-cols-2 gap-2">
                              {Object.entries(corr.new_values).map(([key, value]) => {
                                 const oldVal = corr.old_values[key]
                                 if (oldVal === value) return null
                                 return (
                                   <div key={key} className="col-span-2 sm:col-span-1 bg-slate-50 p-3 rounded-lg border font-mono">
                                      <div className="text-[11px] text-slate-500 font-sans font-bold uppercase mb-1">{key.replace('_', ' ')}</div>
                                      <div className="flex items-center gap-2">
                                        <span className="line-through text-slate-400 text-[14px]">{String(oldVal)}</span>
                                        <ArrowRight className="w-3 h-3 text-blue-500" />
                                        <span className="font-bold text-blue-700 text-[14px]">{String(value)}</span>
                                      </div>
                                   </div>
                                 )
                              })}
                           </div>
                         </div>
                      </div>
                    </div>
                 </div>
               ))}
             </div>
          )}
        </div>

        {/* Batch History */}
        {batchHistory.length > 0 && (
          <div className="mt-8 border-t border-slate-200 pt-6">
             <h3 className="font-bold text-[18px] text-slate-900 mb-4">Recent Records</h3>
             <div className="space-y-3">
               {batchHistory.map(entry => (
                 <div key={entry.reference_code} className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm flex items-center justify-between">
                   <div>
                     <p className="font-bold text-[15px] text-slate-900">{entry.reference_code}</p>
                     <p className="text-[13px] text-slate-500">{format(new Date(entry.test_performed_at), 'MMM d, h:mm a')}</p>
                   </div>
                   <div className="text-right flex flex-col items-end">
                     <span className={cn(
                       "px-2.5 py-1 text-[12px] font-bold rounded-md uppercase tracking-wider",
                       entry.decision === 'accepted' ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                     )}>
                       {entry.decision}
                     </span>
                     {entry.decision === 'rejected' && entry.reason_codes && entry.reason_codes.length > 0 && (
                       <span className="text-[12px] text-slate-500 mt-1 max-w-[150px] truncate">
                         {REASON_LABELS[entry.reason_codes[0] as DbReasonCode] || entry.reason_codes[0]}
                       </span>
                     )}
                   </div>
                 </div>
               ))}
             </div>
          </div>
        )}
      </div>

      {/* --- PIN DIALOG --- */}
      <Dialog open={showPinDialog} onOpenChange={(open) => { setShowPinDialog(open); if(!open) setPinInput(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supervisor Authentication</DialogTitle>
            <DialogDescription>Please authenticate to request corrections</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Select Operator</Label>
              <Select value={activeOperatorId} onValueChange={(val) => { setActiveOperatorId(val || ''); setPinInput(''); setPinError(''); }}>
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Select Name" />
                </SelectTrigger>
                <SelectContent>
                  {operators.map(op => (
                    <SelectItem key={op.id} value={op.id}>{op.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {activeOperatorId && (
              <div className="space-y-2">
                <Label>Enter PIN</Label>
                <Input 
                  type="password"
                  pattern="[0-9]*"
                  inputMode="numeric"
                  value={pinInput}
                  onChange={e => setPinInput(e.target.value)}
                  className="h-14 text-2xl tracking-[0.5em] text-center"
                  onKeyDown={(e) => { if (e.key === 'Enter') verifyPin() }}
                />
                {pinError && <p className="text-red-500 font-medium text-sm text-center">{pinError}</p>}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPinDialog(false)}>Cancel</Button>
            <Button onClick={verifyPin} disabled={!activeOperatorId || !pinInput}>Authenticate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- CORRECTION DIALOG --- */}
      <Dialog open={showCorrectionModal} onOpenChange={(open) => { setShowCorrectionModal(open) }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Request Correction</DialogTitle>
            <DialogDescription>
              Submit an amendment to this record. The original record will remain unchanged and locked.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {correctionError && (
              <div className="p-3 bg-red-50 text-red-700 text-sm font-medium rounded border border-red-200">
                {correctionError}
              </div>
            )}
            
            <div className="space-y-2">
               <Label className="font-bold">Correction Reason (Required)</Label>
               <Textarea 
                 placeholder="Why is this record being amended?"
                 value={correctionReason}
                 onChange={e => setCorrectionReason(e.target.value)}
                 rows={3}
               />
            </div>
            
            <div className="grid grid-cols-2 gap-4 border-t pt-4">
               <div className="space-y-2">
                 <Label>Volume (L)</Label>
                 <Input type="number" step="0.1" value={newVolume} onChange={e => setNewVolume(e.target.value)} />
               </div>
               <div className="space-y-2">
                 <Label>Fat %</Label>
                 <Input type="number" step="0.01" value={newFat} onChange={e => setNewFat(e.target.value)} />
               </div>
               <div className="space-y-2">
                 <Label>SNF %</Label>
                 <Input type="number" step="0.01" value={newSnf} onChange={e => setNewSnf(e.target.value)} />
               </div>
               <div className="space-y-2">
                 <Label>Temp °C</Label>
                 <Input type="number" step="0.1" value={newTemp} onChange={e => setNewTemp(e.target.value)} />
               </div>
               <div className="space-y-2 col-span-2">
                 <Label>Final Decision</Label>
                 <Select value={newDecision} onValueChange={(val) => setNewDecision(val || '')}>
                   <SelectTrigger>
                     <SelectValue />
                   </SelectTrigger>
                   <SelectContent>
                     <SelectItem value="accepted">ACCEPTED</SelectItem>
                     <SelectItem value="rejected">REJECTED</SelectItem>
                   </SelectContent>
                 </Select>
               </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCorrectionModal(false)} disabled={isSubmittingCorrection}>
              Cancel
            </Button>
            <Button onClick={submitCorrection} disabled={isSubmittingCorrection || !correctionReason.trim()}>
              {isSubmittingCorrection ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Submit Amendment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- DISPUTE DIALOG --- */}
      <Dialog open={showDisputeModal} onOpenChange={setShowDisputeModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Dispute this Result</DialogTitle>
            <DialogDescription>
              Submit a dispute for review by the collection center operator.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {disputeError && (
              <div className="p-3 bg-red-50 text-red-700 text-[14px] font-medium rounded border border-red-200">
                {disputeError}
              </div>
            )}
            
            <div className="space-y-2">
               <Label className="font-bold text-[15px]">Why are you disputing this result? *</Label>
               <Textarea 
                 placeholder="Please provide details about why this rejection is incorrect..."
                 value={disputeReason}
                 onChange={e => setDisputeReason(e.target.value)}
                 rows={4}
                 className="text-[16px] p-3" // Larger text for mobile
               />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisputeModal(false)} disabled={isSubmittingDispute} className="h-12 text-[15px]">
              Cancel
            </Button>
            <Button onClick={submitDispute} disabled={isSubmittingDispute || !disputeReason.trim()} className="h-12 text-[15px]">
              {isSubmittingDispute ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Submit Dispute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}