'use client'

import React, { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ArrowLeft, ArrowRight, CheckCircle2, XCircle, AlertTriangle, AlertCircle, FileEdit, User } from 'lucide-react'
import { format } from 'date-fns'

import { supabase } from '@/lib/supabase'
import { REASON_LABELS } from '@/lib/grading'
import { MIN_FAT_PERCENT, MIN_SNF_PERCENT, MAX_TEMPERATURE_C } from '@/lib/config'
import type { CanTestWithDetails, CorrectionWithOperator } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
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
          farmer:farmers!inner (name, phone, village),
          operator:operators (name)
        `)
        .eq('reference_code', referenceCode)
        .maybeSingle()
        .returns<CanTestWithDetails>()

      if (dbError) throw dbError
      if (!dbData) {
        setError('Record not found. It may be invalid or not yet synced.')
        return
      }

      const canTest = dbData
      setRecord(canTest)

      // 2. Fetch corrections
      const { data: corrData, error: corrError } = await supabase
        .from('corrections')
        .select(`
          *,
          operator:operators!inner (name)
        `)
        .eq('can_test_id', canTest.id)
        .order('created_at', { ascending: true })
        .returns<CorrectionWithOperator[]>()

      if (corrError) throw corrError
      setCorrections(corrData || [])

      // 3. Fetch operators for the correction auth
      const { data: opsData } = await supabase.from('operators').select('id, name').order('name')
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
        p_old_values: oldValues,
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
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
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
  const isAccepted = record.decision === 'accepted'

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Top Nav */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between">
          <Button variant="ghost" className="-ml-2 text-slate-600" onClick={() => router.push('/lookup')}>
            <ArrowLeft className="w-5 h-5 mr-2" /> Back
          </Button>
          <div className="font-mono font-bold text-slate-800">{record.reference_code}</div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
        
        {/* Trust Label */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-bold text-blue-900">Original test record</h3>
            <p className="text-sm text-blue-800 mt-1">
              This record shows the values recorded when the milk was tested. The original entry cannot be edited.
            </p>
          </div>
        </div>

        {/* Core Info */}
        <Card className="shadow-sm border-slate-200">
          <CardHeader className="bg-slate-50 border-b pb-4 rounded-t-xl">
            <div className="flex items-center justify-between mb-1">
               <CardDescription className="uppercase tracking-widest font-bold text-slate-500 text-xs">
                 Farmer Details
               </CardDescription>
               <span className="text-xs font-mono font-medium text-slate-500">#{record.farmer_id.substring(0,8)}</span>
            </div>
            <CardTitle className="text-2xl">{record.farmer?.name}</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 grid grid-cols-2 gap-y-6 gap-x-4">
            <div>
              <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Tested Date & Time</span>
              <span className="font-semibold text-slate-900">{format(dateObj, 'MMM d, yyyy h:mm a')}</span>
            </div>
            <div>
               <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Tested By (Operator)</span>
               <div className="flex items-center font-semibold text-slate-900">
                 <User className="w-4 h-4 mr-1.5 text-slate-400" />
                 {record.operator?.name}
               </div>
            </div>
          </CardContent>
        </Card>

        {/* Test Values */}
        <Card className="shadow-sm border-slate-200">
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-lg">Physical Readings</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              {record.can_volume !== null && record.can_volume !== undefined && (
                 <div className="flex flex-col">
                   <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Volume</span>
                   <span className="text-xl font-black text-slate-900">{record.can_volume.toFixed(1)} L</span>
                 </div>
              )}
              <div className="flex flex-col">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Fat</span>
                <span className="text-xl font-black text-slate-900">{record.fat_percent.toFixed(2)}%</span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">SNF</span>
                <span className="text-xl font-black text-slate-900">{record.snf_percent.toFixed(2)}%</span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Temp</span>
                <span className="text-xl font-black text-slate-900">{record.temperature.toFixed(1)}°C</span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Adulteration</span>
                <span className={cn("text-xl font-black", record.adulteration_result ? "text-red-600" : "text-emerald-600")}>
                  {record.adulteration_result ? 'FAIL' : 'PASS'}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Decision Area */}
        <Card className="shadow-sm border-slate-200 overflow-hidden">
          <div className={cn(
             "p-6 text-white flex items-start gap-4",
             isAccepted ? "bg-emerald-600" : "bg-red-600"
          )}>
            {isAccepted ? <CheckCircle2 className="w-8 h-8 shrink-0 opacity-90" /> : <XCircle className="w-8 h-8 shrink-0 opacity-90" />}
            <div>
               <span className="block text-xs font-bold text-white/70 uppercase tracking-wider mb-1">Final Decision</span>
               <h2 className="text-2xl font-black uppercase tracking-tight">
                 {isAccepted ? 'ACCEPTED' : 'REJECTED'}
                 {record.is_override && ' — OVERRIDE'}
               </h2>
            </div>
          </div>
          
          <CardContent className="p-0">
            {/* System Suggestion & Overrides */}
            {record.is_override && (
               <div className="p-6 border-b bg-slate-50/50 space-y-4">
                 <div>
                   <span className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">System Suggestion</span>
                   <span className="text-lg font-bold text-slate-400 line-through uppercase">
                     {record.auto_decision ? record.auto_decision : 'Unavailable'}
                   </span>
                 </div>
                 <div>
                   <span className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Override Reason</span>
                   <span className="text-base font-medium text-slate-900 italic">&quot;{record.override_reason}&quot;</span>
                 </div>
               </div>
            )}

            {/* Borderline Review State */}
            {record.is_borderline && (
               <div className="p-6 border-b bg-amber-50">
                 <div className="flex items-center gap-2 mb-2">
                   <AlertTriangle className="w-5 h-5 text-amber-600" />
                   <h3 className="font-bold text-amber-900 tracking-tight">BORDERLINE — REVIEW</h3>
                 </div>
                 <p className="text-sm text-amber-800 font-medium mb-2">
                   This test contained measurements that were very close to the rejection thresholds.
                 </p>
                 {record.borderline_flags && record.borderline_flags.length > 0 && (
                    <ul className="list-disc pl-5 text-sm text-amber-900 space-y-1">
                      {record.borderline_flags.includes('LOW_FAT') && (
                        <li>Fat {record.fat_percent.toFixed(2)}% is near the {MIN_FAT_PERCENT.toFixed(2)}% limit</li>
                      )}
                      {record.borderline_flags.includes('LOW_SNF') && (
                        <li>SNF {record.snf_percent.toFixed(2)}% is near the {MIN_SNF_PERCENT.toFixed(2)}% limit</li>
                      )}
                      {record.borderline_flags.includes('HIGH_TEMPERATURE') && (
                        <li>Temperature {record.temperature.toFixed(1)}°C is near the {MAX_TEMPERATURE_C.toFixed(1)}°C limit</li>
                      )}
                    </ul>
                 )}
               </div>
            )}

            {/* Reasons */}
            {record.reason_codes && record.reason_codes.length > 0 && (
              <div className="p-6">
                 <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Rejection Remarks</span>
                 <ul className="space-y-2">
                   {record.reason_codes.map(code => (
                     <li key={code} className="flex items-center text-slate-700 font-medium">
                       <span className="mr-3 w-1.5 h-1.5 bg-slate-300 rounded-full shrink-0"></span>
                       {REASON_LABELS[code] || code}
                     </li>
                   ))}
                 </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Corrections Timeline */}
        <div className="mt-8">
           <div className="flex items-center justify-between mb-4">
             <h3 className="font-bold text-lg text-slate-900">Amendment History</h3>
             <Button variant="outline" size="sm" onClick={handleOpenCorrection} className="font-bold">
               <FileEdit className="w-4 h-4 mr-2" /> Request Correction
             </Button>
           </div>
           
           {corrections.length === 0 ? (
             <div className="p-6 text-center border border-dashed border-slate-300 rounded-xl bg-slate-50 text-slate-500 font-medium text-sm">
               Original record — no amendments
             </div>
           ) : (
             <div className="space-y-4">
               {corrections.map((corr, idx) => (
                 <div key={corr.id} className="relative">
                    {/* Visual timeline line */}
                    {idx === 0 && <div className="absolute -top-3 left-6 w-0.5 h-3 bg-slate-200"></div>}
                    <div className="absolute -bottom-4 left-6 w-0.5 h-4 bg-slate-200 last:hidden"></div>
                    
                    <Card className="border-blue-100 shadow-sm relative z-10">
                      <CardHeader className="bg-blue-50/50 pb-3 py-3 border-b border-blue-100">
                        <div className="flex items-center justify-between">
                           <div className="flex items-center gap-2">
                             <FileEdit className="w-4 h-4 text-blue-600" />
                             <CardTitle className="text-sm font-bold text-blue-900 uppercase tracking-widest">
                               AMENDMENT
                             </CardTitle>
                           </div>
                           <span className="text-xs font-semibold text-slate-500">
                             {format(new Date(corr.created_at), 'MMM d, h:mm a')}
                           </span>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-4 space-y-3">
                         <div>
                           <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Corrected By</span>
                           <span className="font-medium text-slate-900">{corr.operator?.name}</span>
                         </div>
                         <div>
                           <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Reason for Amendment</span>
                           <span className="font-medium text-slate-900 italic">&quot;{corr.reason}&quot;</span>
                         </div>
                         <div className="pt-2 border-t mt-3">
                           <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">Changed Values</span>
                           <div className="grid grid-cols-2 gap-2 text-sm">
                              {Object.entries(corr.new_values).map(([key, value]) => {
                                 const oldVal = corr.old_values[key]
                                 if (oldVal === value) return null
                                 return (
                                   <div key={key} className="col-span-2 sm:col-span-1 bg-slate-50 p-2 rounded border font-mono">
                                      <div className="text-xs text-slate-500 font-sans font-bold uppercase mb-1">{key.replace('_', ' ')}</div>
                                      <div className="flex items-center gap-2">
                                        <span className="line-through text-slate-400">{String(oldVal)}</span>
                                        <ArrowRight className="w-3 h-3 text-blue-500" />
                                        <span className="font-bold text-blue-700">{String(value)}</span>
                                      </div>
                                   </div>
                                 )
                              })}
                           </div>
                         </div>
                      </CardContent>
                    </Card>
                 </div>
               ))}
             </div>
           )}
        </div>
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
    </div>
  )
}