'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'
import { 
  ArrowLeft, CheckCircle2, AlertCircle, XCircle, FileEdit, Scale, ShieldAlert 
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { DisputeRow, OperatorRow, CanDecision } from '@/types/database'

type DisputeDetail = DisputeRow & {
  can_test: {
    id: string
    reference_code: string
    farmer: { name: string }
    operator: { name: string }
    test_performed_at: string
    decision: CanDecision
    reason_codes: string[] | null
    fat_percent: number
    snf_percent: number
    temperature: number
    can_volume: number
    acidity_percent: number | null
    sediment_detected: boolean
    evidence_type: 'photo' | 'sensory' | null
    photo_url: string | null
    sensory_note: string | null
    auto_decision: CanDecision
  }
}

export default function DisputeDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const disputeId = params.id

  const [dispute, setDispute] = useState<DisputeDetail | null>(null)
  const [operators, setOperators] = useState<Pick<OperatorRow, 'id' | 'name'>[]>([])
  
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Auth Modal State
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [authAction, setAuthAction] = useState<'reject' | 'adjust' | null>(null)
  const [selectedOperatorId, setSelectedOperatorId] = useState('')
  const [pin, setPin] = useState('')
  const [authError, setAuthError] = useState('')

  // Rejection Modal State
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  // Adjust Modal State
  const [showAdjustModal, setShowAdjustModal] = useState(false)
  const [adjustVolume, setAdjustVolume] = useState('')
  const [adjustFat, setAdjustFat] = useState('')
  const [adjustSnf, setAdjustSnf] = useState('')
  const [adjustTemp, setAdjustTemp] = useState('')
  const [adjustAcidity, setAdjustAcidity] = useState('')
  const [adjustSediment, setAdjustSediment] = useState<boolean>(false)
  const [adjustReason, setAdjustReason] = useState('')

  const [isSubmitting, setIsSubmitting] = useState(false)

  const fetchData = async () => {
    setIsLoading(true)
    try {
      const [dispRes, opRes] = await Promise.all([
        supabase
          .from('disputes')
          .select(`
            *,
            can_test:can_tests!inner (
              id, reference_code, test_performed_at, decision, reason_codes, operator_id,
              fat_percent, snf_percent, temperature, can_volume, acidity_percent, sediment_detected,
              evidence_type, photo_url, sensory_note, auto_decision,
              farmer:farmers!inner (name)
            )
          `)
          .eq('id', disputeId)
          .single(),
        supabase.from('operator_profiles').select('id, name').order('name')
      ])

      if (dispRes.error) throw dispRes.error
      if (opRes.error) throw opRes.error

      const disputeData = dispRes.data as unknown as DisputeDetail
      if (disputeData && disputeData.can_test) {
        const opId = (disputeData.can_test as unknown as { operator_id?: string }).operator_id
        const op = opRes.data?.find(o => o.id === opId)
        disputeData.can_test.operator = { name: op ? op.name : 'Unknown' }
      }
      setDispute(disputeData)
      setOperators(opRes.data as Pick<OperatorRow, 'id' | 'name'>[])
      // Pre-fill adjust values if we have the record
      const record = (dispRes.data as unknown as DisputeDetail).can_test
      setAdjustVolume(record.can_volume.toString())
      setAdjustFat(record.fat_percent.toString())
      setAdjustSnf(record.snf_percent.toString())
      setAdjustTemp(record.temperature.toString())
      setAdjustAcidity(record.acidity_percent?.toString() || '')
      setAdjustSediment(record.sediment_detected)

    } catch (err) {
      console.error(err)
      setError('Failed to load dispute details.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    fetchData()
  }, [disputeId])


  const handleAuthSubmit = () => {
    setAuthError('')
    if (!selectedOperatorId || !pin) {
      setAuthError('Operator and PIN are required')
      return
    }
    
    // We don't verify here; we pass PIN to the next modal's submit function
    setShowAuthModal(false)
    if (authAction === 'reject') {
      setShowRejectModal(true)
    } else if (authAction === 'adjust') {
      setShowAdjustModal(true)
    }
  }

  const handleFinalRejection = async () => {
    if (!rejectReason) {
      setAuthError('Reason is required')
      return
    }
    
    setIsSubmitting(true)
    try {
      const { error: resolveError } = await supabase.rpc('resolve_dispute', {
        p_operator_id: selectedOperatorId,
        p_pin: pin,
        p_dispute_id: disputeId,
        p_resolution_type: 'final_rejection',
        p_resolution_reason: rejectReason
      })

      if (resolveError) throw resolveError

      // Refresh
      setShowRejectModal(false)
      setRejectReason('')
      setPin('')
      await fetchData()
    } catch (err: unknown) {
      console.error(err)
      const msg = err instanceof Error ? err.message : 'Failed to reject dispute'
      setAuthError(msg)
      // If unauthorized, send back to auth modal
      if (msg.includes('Unauthorized')) {
        setShowRejectModal(false)
        setShowAuthModal(true)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleAdjustment = async () => {
    if (!adjustReason) {
      setAuthError('Reason is required')
      return
    }

    setIsSubmitting(true)
    try {
      if (!dispute) throw new Error('Missing dispute data')

      // Submit Correction & Resolve Dispute atomically
      const newValues = {
        can_volume: Number(adjustVolume),
        fat_percent: Number(adjustFat),
        snf_percent: Number(adjustSnf),
        temperature: Number(adjustTemp),
        acidity_percent: adjustAcidity ? Number(adjustAcidity) : null,
        sediment_detected: adjustSediment,
        decision: 'accepted' // Adjustments mathematically imply accepting a previously rejected can
      }

      const { error: resolveError } = await supabase.rpc('resolve_dispute_with_correction', {
        p_operator_id: selectedOperatorId,
        p_pin: pin,
        p_can_test_id: dispute.can_test.id,
        p_dispute_id: disputeId,
        p_new_values: newValues,
        p_reason: adjustReason,
        p_resolution_type: 'adjustment'
      })

      if (resolveError) throw resolveError

      setShowAdjustModal(false)
      setPin('')
      await fetchData()
    } catch (err: unknown) {
      console.error(err)
      const msg = err instanceof Error ? err.message : 'Failed to adjust record'
      setAuthError(msg)
      if (msg.includes('Unauthorized')) {
        setShowAdjustModal(false)
        setShowAuthModal(true)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 p-4">
        <Button variant="ghost" onClick={() => router.back()} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl font-medium">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-16 z-10 shadow-sm">
        <div className="max-w-xl mx-auto px-4 py-4 flex items-center">
          <button onClick={() => router.back()} className="mr-3 p-2 hover:bg-slate-100 rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div>
            <h1 className="text-[20px] font-extrabold text-[#052b1f] tracking-tight flex items-center">
              Dispute Details
            </h1>
            {dispute && (
              <p className="text-[13px] text-slate-500 font-mono mt-0.5">{dispute.can_test.reference_code}</p>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto p-4 space-y-6">
        {isLoading || !dispute ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        ) : (
          <>
            {/* Status Banner */}
            {dispute.status === 'resolved' ? (
              <div className={cn(
                "p-4 rounded-xl border flex gap-3 shadow-sm",
                dispute.resolution_type === 'adjustment' 
                  ? "bg-green-50 border-green-200 text-green-900" 
                  : "bg-red-50 border-red-200 text-red-900"
              )}>
                {dispute.resolution_type === 'adjustment' ? (
                  <CheckCircle2 className="w-6 h-6 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-6 h-6 shrink-0 mt-0.5" />
                )}
                <div>
                  <h3 className="font-bold text-[16px]">
                    Resolved: {dispute.resolution_type === 'adjustment' ? 'Accepted & Corrected' : 'Final Rejection'}
                  </h3>
                  <p className="text-[14px] mt-1 opacity-90">{dispute.resolution_reason}</p>
                  <p className="text-[12px] mt-2 opacity-75">
                    {format(new Date(dispute.resolved_at!), 'MMM d, yyyy h:mm a')}
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 flex gap-3 shadow-sm">
                <AlertCircle className="w-6 h-6 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-[16px]">Awaiting Review</h3>
                  <p className="text-[14px] mt-1 opacity-90">This record was disputed by the farmer and requires an operator decision.</p>
                </div>
              </div>
            )}

            {/* Farmer Dispute Section */}
            <Card className="border-slate-200 shadow-sm overflow-hidden">
              <div className="bg-slate-100 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <h3 className="font-bold text-[15px] text-slate-800 flex items-center">
                  <Scale className="w-4 h-4 mr-2 text-slate-500" />
                  Farmer Dispute
                </h3>
                <span className="text-[12px] text-slate-500">
                  {format(new Date(dispute.submitted_at), 'MMM d, h:mm a')}
                </span>
              </div>
              <CardContent className="p-4">
                <p className="text-[15px] text-slate-700 whitespace-pre-wrap font-medium">
                  &quot;{dispute.farmer_message}&quot;
                </p>
              </CardContent>
            </Card>

            {/* Original Record Section */}
            <Card className="border-slate-200 shadow-sm overflow-hidden">
              <div className="bg-slate-100 px-4 py-3 border-b border-slate-200">
                <h3 className="font-bold text-[15px] text-slate-800 flex items-center">
                  <ShieldAlert className="w-4 h-4 mr-2 text-slate-500" />
                  Original Test Record
                </h3>
              </div>
              <CardContent className="p-0">
                <div className="p-4 border-b border-slate-100 grid grid-cols-2 gap-y-4">
                  <div>
                    <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wider">Farmer</p>
                    <p className="font-bold text-slate-900">{dispute.can_test.farmer.name}</p>
                  </div>
                  <div>
                    <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wider">Operator</p>
                    <p className="font-medium text-slate-900">{dispute.can_test.operator.name}</p>
                  </div>
                  <div>
                    <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wider">Test Time</p>
                    <p className="font-medium text-slate-900">{format(new Date(dispute.can_test.test_performed_at), 'MMM d, h:mm a')}</p>
                  </div>
                  <div>
                    <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wider">Reference</p>
                    <p className="font-mono text-[13px] font-medium text-slate-700">{dispute.can_test.reference_code}</p>
                  </div>
                </div>

                <div className="p-4 border-b border-slate-100 bg-slate-50">
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
                      <p className="text-[11px] font-bold text-slate-500">VOL</p>
                      <p className="font-bold text-[16px] text-slate-900 mt-0.5">{dispute.can_test.can_volume}L</p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
                      <p className="text-[11px] font-bold text-slate-500">FAT</p>
                      <p className="font-bold text-[16px] text-slate-900 mt-0.5">{dispute.can_test.fat_percent}%</p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
                      <p className="text-[11px] font-bold text-slate-500">SNF</p>
                      <p className="font-bold text-[16px] text-slate-900 mt-0.5">{dispute.can_test.snf_percent}%</p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
                      <p className="text-[11px] font-bold text-slate-500">TEMP</p>
                      <p className="font-bold text-[16px] text-slate-900 mt-0.5">{dispute.can_test.temperature}°C</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center mt-2">
                    <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
                      <p className="text-[11px] font-bold text-slate-500">ACIDITY</p>
                      <p className="font-bold text-[16px] text-slate-900 mt-0.5">
                        {dispute.can_test.acidity_percent ? `${dispute.can_test.acidity_percent}%` : '--'}
                      </p>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-sm col-span-2">
                      <p className="text-[11px] font-bold text-slate-500">SEDIMENT</p>
                      <p className="font-bold text-[16px] text-slate-900 mt-0.5">
                        {dispute.can_test.sediment_detected ? 'Detected' : 'None'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-4">
                  <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-2">Decision</p>
                  <div className="flex gap-2 flex-wrap">
                    <span className="px-3 py-1 rounded-full text-[13px] font-bold bg-red-100 text-red-800">
                      Rejected
                    </span>
                    {dispute.can_test.reason_codes?.map(code => (
                      <span key={code} className="px-3 py-1 rounded-full text-[13px] font-medium bg-slate-100 text-slate-700">
                        {code}
                      </span>
                    ))}
                  </div>

                  {dispute.can_test.evidence_type && (
                    <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-2">Evidence</p>
                      {dispute.can_test.evidence_type === 'photo' && dispute.can_test.photo_url ? (
                        <div className="rounded-lg overflow-hidden border border-slate-200">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={dispute.can_test.photo_url} alt="Evidence" className="w-full h-auto" />
                        </div>
                      ) : (
                        <p className="text-[14px] text-slate-700 italic">
                          &quot;{dispute.can_test.sensory_note}&quot;
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Actions (Only if Open) */}
            {dispute.status === 'open' && (
              <div className="space-y-3 pt-4">
                <Button 
                  onClick={() => { setAuthAction('adjust'); setShowAuthModal(true); setAuthError(''); setPin(''); }}
                  className="w-full h-14 text-[17px] font-bold rounded-xl bg-[#0f6041] hover:bg-[#0a422c] text-white shadow-sm"
                >
                  <FileEdit className="w-5 h-5 mr-2" /> Adjust / Correct
                </Button>
                
                <Button 
                  onClick={() => { setAuthAction('reject'); setShowAuthModal(true); setAuthError(''); setPin(''); }}
                  variant="outline"
                  className="w-full h-14 text-[17px] font-bold rounded-xl border-red-200 bg-red-50 hover:bg-red-100 text-red-700 shadow-sm"
                >
                  <XCircle className="w-5 h-5 mr-2" /> Confirm Final Rejection
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* --- AUTH MODAL --- */}
      <Dialog open={showAuthModal} onOpenChange={setShowAuthModal}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>Operator Authorization</DialogTitle>
            <DialogDescription>Please authenticate to resolve this dispute.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {authError && (
              <div className="p-3 bg-red-50 text-red-700 text-sm font-medium rounded-lg border border-red-200">
                {authError}
              </div>
            )}
            <div className="space-y-2">
              <Label>Select Operator</Label>
              <Select value={selectedOperatorId} onValueChange={(val) => { setSelectedOperatorId(val || ''); setPin(''); setAuthError(''); }}>
                <SelectTrigger className="h-12 bg-slate-50">
                  <SelectValue placeholder="Select Name" />
                </SelectTrigger>
                <SelectContent>
                  {operators.map(op => (
                    <SelectItem key={op.id} value={op.id}>{op.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedOperatorId && (
              <div className="space-y-2">
                <Label>Enter PIN</Label>
                <Input 
                  type="password"
                  pattern="[0-9]*"
                  inputMode="numeric"
                  value={pin}
                  onChange={e => setPin(e.target.value)}
                  className="h-14 text-2xl tracking-[0.5em] text-center bg-slate-50 font-mono"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAuthModal(false)} className="h-12">Cancel</Button>
            <Button onClick={handleAuthSubmit} disabled={!selectedOperatorId || !pin} className="h-12 bg-slate-900 text-white">Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- FINAL REJECTION MODAL --- */}
      <Dialog open={showRejectModal} onOpenChange={setShowRejectModal}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-red-700 flex items-center">
              <XCircle className="w-5 h-5 mr-2" /> Final Rejection
            </DialogTitle>
            <DialogDescription>Close this dispute and uphold the original rejection decision.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {authError && (
              <div className="p-3 bg-red-50 text-red-700 text-sm font-medium rounded-lg border border-red-200">
                {authError}
              </div>
            )}
            <div className="space-y-2">
              <Label>Resolution Reason</Label>
              <Textarea 
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="E.g., Evidence confirms adulteration. Cannot accept."
                className="min-h-[100px] bg-slate-50"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectModal(false)} className="h-12" disabled={isSubmitting}>Cancel</Button>
            <Button onClick={handleFinalRejection} disabled={!rejectReason || isSubmitting} className="h-12 bg-red-600 hover:bg-red-700 text-white">
              {isSubmitting ? 'Submitting...' : 'Confirm Rejection'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- ADJUSTMENT MODAL --- */}
      <Dialog open={showAdjustModal} onOpenChange={setShowAdjustModal}>
        <DialogContent className="max-w-md rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[#0f6041] flex items-center">
              <FileEdit className="w-5 h-5 mr-2" /> Adjust / Correct
            </DialogTitle>
            <DialogDescription>Append an amendment and resolve the dispute.</DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-2">
            {authError && (
              <div className="p-3 bg-red-50 text-red-700 text-sm font-medium rounded-lg border border-red-200">
                {authError}
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Volume (L)</Label>
                <Input type="number" step="0.1" value={adjustVolume} onChange={e => setAdjustVolume(e.target.value)} className="bg-slate-50" />
              </div>
              <div className="space-y-2">
                <Label>Fat (%)</Label>
                <Input type="number" step="0.1" value={adjustFat} onChange={e => setAdjustFat(e.target.value)} className="bg-slate-50" />
              </div>
              <div className="space-y-2">
                <Label>SNF (%)</Label>
                <Input type="number" step="0.1" value={adjustSnf} onChange={e => setAdjustSnf(e.target.value)} className="bg-slate-50" />
              </div>
              <div className="space-y-2">
                <Label>Temp (°C)</Label>
                <Input type="number" step="0.1" value={adjustTemp} onChange={e => setAdjustTemp(e.target.value)} className="bg-slate-50" />
              </div>
              <div className="space-y-2">
                <Label>Acidity (%)</Label>
                <Input type="number" step="0.01" value={adjustAcidity} onChange={e => setAdjustAcidity(e.target.value)} className="bg-slate-50" />
              </div>
              <div className="space-y-2 flex items-end pb-2">
                <label className="flex items-center space-x-2 text-sm font-medium text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={adjustSediment} onChange={e => setAdjustSediment(e.target.checked)} className="rounded text-[#0f6041] focus:ring-[#0f6041]" />
                  <span>Sediment Detected</span>
                </label>
              </div>
            </div>

            {/* Decision toggle removed since adjustments represent acceptance */}

            <div className="space-y-2">
              <Label>Reason for Amendment</Label>
              <Textarea 
                value={adjustReason}
                onChange={e => setAdjustReason(e.target.value)}
                placeholder="E.g., Recalibrated machine and retested sample."
                className="min-h-[80px] bg-slate-50"
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdjustModal(false)} className="h-12" disabled={isSubmitting}>Cancel</Button>
            <Button onClick={handleAdjustment} disabled={!adjustReason || isSubmitting} className="h-12 bg-[#0f6041] hover:bg-[#0a422c] text-white">
              {isSubmitting ? 'Submitting...' : 'Submit Adjustment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
