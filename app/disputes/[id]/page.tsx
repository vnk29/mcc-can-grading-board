'use client'

import { useState, useEffect, use } from 'react'
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

export default function DisputeDetailPage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  const router = useRouter()
  const unwrappedParams = params instanceof Promise ? use(params) : params
  const disputeId = unwrappedParams.id

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
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      // Validate adjustment inputs
      const vVol = adjustVolume.trim()
      const vFat = adjustFat.trim()
      const vSnf = adjustSnf.trim()
      const vTemp = adjustTemp.trim()

      if (!vVol || !vFat || !vSnf || !vTemp) {
        setAuthError('All core numeric values must be provided')
        setIsSubmitting(false)
        return
      }

      const nVol = Number(vVol)
      const nFat = Number(vFat)
      const nSnf = Number(vSnf)
      const nTemp = Number(vTemp)
      const nAcidity = adjustAcidity.trim() ? Number(adjustAcidity) : null

      if (
        !Number.isFinite(nVol) ||
        !Number.isFinite(nFat) ||
        !Number.isFinite(nSnf) ||
        !Number.isFinite(nTemp) ||
        (nAcidity !== null && !Number.isFinite(nAcidity))
      ) {
        setAuthError('One or more values is not a valid number')
        setIsSubmitting(false)
        return
      }

      // Submit Correction & Resolve Dispute atomically
      const newValues = {
        can_volume: nVol,
        fat_percent: nFat,
        snf_percent: nSnf,
        temperature: nTemp,
        acidity_percent: nAcidity,
        sediment_detected: adjustSediment,
        decision: 'accepted' // Adjustments mathematically imply accepting a previously rejected can
      }

      const { error: resolveError } = await supabase.rpc('resolve_dispute_with_correction', {
        p_operator_id: selectedOperatorId,
        p_pin: pin,
        p_can_test_id: dispute.can_test.id,
        p_dispute_id: disputeId,
        p_new_values: newValues,
        p_reason: adjustReason
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
      <div className="min-h-screen bg-background p-4">
        <Button variant="ghost" onClick={() => router.back()} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <div className="bg-rose-50 border-2 border-rose-200 text-rose-700 p-4 rounded-xl font-bold">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="bg-card border-b-2 border-border sticky top-0 z-10 shadow-sm">
        <div className="max-w-xl mx-auto px-4 py-4 flex items-center">
          <button onClick={() => router.back()} className="mr-3 p-2 hover:bg-muted rounded-full transition-colors active:scale-95">
            <ArrowLeft className="w-6 h-6 text-muted-foreground" />
          </button>
          <div>
            <h1 className="text-[24px] font-black text-foreground tracking-tight flex items-center">
              Dispute Details
            </h1>
            {dispute && (
              <p className="text-[14px] text-muted-foreground font-mono font-bold mt-0.5">{dispute.can_test.reference_code}</p>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto p-4 space-y-6 mt-4">
        {isLoading || !dispute ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full rounded-2xl" />
            <Skeleton className="h-48 w-full rounded-2xl" />
          </div>
        ) : (
          <>
            {/* Status Banner */}
            {dispute.status === 'resolved' ? (
              <div className={cn(
                "p-5 rounded-2xl border-2 flex gap-4 shadow-sm",
                dispute.resolution_type === 'adjustment' 
                  ? "bg-emerald-50 border-emerald-200 text-emerald-900" 
                  : "bg-rose-50 border-rose-200 text-rose-900"
              )}>
                {dispute.resolution_type === 'adjustment' ? (
                  <CheckCircle2 className="w-8 h-8 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-8 h-8 shrink-0 mt-0.5" />
                )}
                <div>
                  <h3 className="font-black tracking-tight text-[18px]">
                    Resolved: {dispute.resolution_type === 'adjustment' ? 'Accepted & Corrected' : 'Final Rejection'}
                  </h3>
                  <p className="text-[15px] mt-1 opacity-90 font-medium">{dispute.resolution_reason}</p>
                  <p className="text-[13px] mt-3 opacity-75 font-bold">
                    {format(new Date(dispute.resolved_at!), 'MMM d, yyyy h:mm a')}
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-5 rounded-2xl border-2 border-amber-200 bg-amber-50 text-amber-900 flex gap-4 shadow-sm">
                <AlertCircle className="w-8 h-8 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-black tracking-tight text-[18px]">Awaiting Review</h3>
                  <p className="text-[15px] mt-1 opacity-90 font-medium">This record was disputed by the farmer and requires an operator decision.</p>
                </div>
              </div>
            )}

            {/* Farmer Dispute Section */}
            <Card className="border-2 border-input shadow-sm overflow-hidden rounded-2xl bg-card">
              <div className="bg-muted px-5 py-4 border-b-2 border-border flex items-center justify-between">
                <h3 className="font-black text-[16px] text-foreground flex items-center tracking-tight">
                  <Scale className="w-5 h-5 mr-2 text-muted-foreground" />
                  Farmer Dispute
                </h3>
                <span className="text-[13px] text-muted-foreground font-bold">
                  {format(new Date(dispute.submitted_at), 'MMM d, h:mm a')}
                </span>
              </div>
              <CardContent className="p-5">
                <p className="text-[16px] text-foreground whitespace-pre-wrap font-medium">
                  &quot;{dispute.farmer_message}&quot;
                </p>
              </CardContent>
            </Card>

            {/* Original Record Section */}
            <Card className="border-2 border-input shadow-sm overflow-hidden rounded-2xl bg-card">
              <div className="bg-muted px-5 py-4 border-b-2 border-border">
                <h3 className="font-black text-[16px] text-foreground flex items-center tracking-tight">
                  <ShieldAlert className="w-5 h-5 mr-2 text-muted-foreground" />
                  Original Test Record
                </h3>
              </div>
              <CardContent className="p-0">
                <div className="p-5 border-b-2 border-border grid grid-cols-2 gap-y-5">
                  <div>
                    <p className="text-[12px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Farmer</p>
                    <p className="font-black text-[16px] text-foreground">{dispute.can_test.farmer.name}</p>
                  </div>
                  <div>
                    <p className="text-[12px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Operator</p>
                    <p className="font-black text-[16px] text-foreground">{dispute.can_test.operator.name}</p>
                  </div>
                  <div>
                    <p className="text-[12px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Test Time</p>
                    <p className="font-black text-[16px] text-foreground">{format(new Date(dispute.can_test.test_performed_at), 'MMM d, h:mm a')}</p>
                  </div>
                  <div>
                    <p className="text-[12px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Reference</p>
                    <p className="font-mono text-[14px] font-black text-foreground">{dispute.can_test.reference_code}</p>
                  </div>
                </div>

                <div className="p-5 border-b-2 border-border bg-muted/50">
                  <div className="grid grid-cols-4 gap-3 text-center">
                    <div className="bg-card p-3 rounded-xl border-2 border-input shadow-sm">
                      <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">VOL</p>
                      <p className="font-black text-[18px] text-foreground mt-1">{dispute.can_test.can_volume}L</p>
                    </div>
                    <div className="bg-card p-3 rounded-xl border-2 border-input shadow-sm">
                      <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">FAT</p>
                      <p className="font-black text-[18px] text-foreground mt-1">{dispute.can_test.fat_percent}%</p>
                    </div>
                    <div className="bg-card p-3 rounded-xl border-2 border-input shadow-sm">
                      <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">SNF</p>
                      <p className="font-black text-[18px] text-foreground mt-1">{dispute.can_test.snf_percent}%</p>
                    </div>
                    <div className="bg-card p-3 rounded-xl border-2 border-input shadow-sm">
                      <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">TEMP</p>
                      <p className="font-black text-[18px] text-foreground mt-1">{dispute.can_test.temperature}°C</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center mt-3">
                    <div className="bg-card p-3 rounded-xl border-2 border-input shadow-sm">
                      <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">ACIDITY</p>
                      <p className="font-black text-[18px] text-foreground mt-1">
                        {dispute.can_test.acidity_percent ? `${dispute.can_test.acidity_percent}%` : '--'}
                      </p>
                    </div>
                    <div className="bg-card p-3 rounded-xl border-2 border-input shadow-sm col-span-2">
                      <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">SEDIMENT</p>
                      <p className="font-black text-[18px] text-foreground mt-1">
                        {dispute.can_test.sediment_detected ? 'Detected' : 'None'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-5">
                  <p className="text-[12px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Decision</p>
                  <div className="flex gap-2 flex-wrap">
                    <span className="px-4 py-1.5 rounded-lg text-[13px] font-black uppercase tracking-widest bg-rose-100 text-rose-800">
                      Rejected
                    </span>
                    {dispute.can_test.reason_codes?.map(code => (
                      <span key={code} className="px-3 py-1.5 rounded-lg text-[13px] font-bold bg-muted text-muted-foreground">
                        {code}
                      </span>
                    ))}
                  </div>

                  {dispute.can_test.evidence_type && (
                    <div className="mt-5 p-5 rounded-2xl bg-muted/50 border-2 border-input">
                      <p className="text-[12px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Evidence</p>
                      {dispute.can_test.evidence_type === 'photo' && dispute.can_test.photo_url ? (
                        <div className="rounded-xl overflow-hidden border-2 border-input">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={dispute.can_test.photo_url} alt="Evidence" className="w-full h-auto" />
                        </div>
                      ) : (
                        <p className="text-[15px] text-foreground italic font-medium">
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
              <div className="space-y-4 pt-6">
                <Button 
                  onClick={() => { setAuthAction('adjust'); setShowAuthModal(true); setAuthError(''); setPin(''); }}
                  className="w-full h-16 text-[18px] font-extrabold rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-md transition-all active:scale-[0.98]"
                >
                  <FileEdit className="w-6 h-6 mr-2" /> Adjust / Correct
                </Button>
                
                <Button 
                  onClick={() => { setAuthAction('reject'); setShowAuthModal(true); setAuthError(''); setPin(''); }}
                  variant="outline"
                  className="w-full h-16 text-[18px] font-extrabold rounded-2xl border-2 border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 shadow-sm transition-all active:scale-[0.98]"
                >
                  <XCircle className="w-6 h-6 mr-2" /> Confirm Final Rejection
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* --- AUTH MODAL --- */}
      <Dialog open={showAuthModal} onOpenChange={setShowAuthModal}>
        <DialogContent className="max-w-sm rounded-2xl bg-card border-2 border-border">
          <DialogHeader>
            <DialogTitle className="font-black text-[20px] text-foreground tracking-tight">Operator Authorization</DialogTitle>
            <DialogDescription className="text-muted-foreground font-bold">Please authenticate to resolve this dispute.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {authError && (
              <div className="p-3 bg-rose-50 text-rose-700 text-[14px] font-bold rounded-xl border-2 border-rose-200">
                {authError}
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-[13px] font-bold text-muted-foreground uppercase tracking-widest">Select Operator</Label>
              <Select value={selectedOperatorId} onValueChange={(val) => { setSelectedOperatorId(val || ''); setPin(''); setAuthError(''); }}>
                <SelectTrigger className="h-14 bg-muted border-2 border-input rounded-xl text-[16px] font-black text-foreground">
                  <SelectValue placeholder="Select Name" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-2 border-input">
                  {operators.map(op => (
                    <SelectItem key={op.id} value={op.id} className="font-bold">{op.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedOperatorId && (
              <div className="space-y-2">
                <Label className="text-[13px] font-bold text-muted-foreground uppercase tracking-widest">Enter PIN</Label>
                <Input 
                  type="password"
                  pattern="[0-9]*"
                  inputMode="numeric"
                  value={pin}
                  onChange={e => setPin(e.target.value)}
                  className="h-16 text-3xl tracking-[0.5em] text-center bg-muted border-2 border-input rounded-xl font-mono text-foreground font-black"
                />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowAuthModal(false)} className="h-14 rounded-xl font-bold text-[16px] border-2 border-input text-foreground hover:bg-muted active:scale-[0.98] transition-all">Cancel</Button>
            <Button onClick={handleAuthSubmit} disabled={!selectedOperatorId || !pin} className="h-14 rounded-xl font-extrabold text-[16px] bg-foreground text-background hover:bg-foreground/90 active:scale-[0.98] transition-all">Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- FINAL REJECTION MODAL --- */}
      <Dialog open={showRejectModal} onOpenChange={setShowRejectModal}>
        <DialogContent className="max-w-sm rounded-2xl bg-card border-2 border-border">
          <DialogHeader>
            <DialogTitle className="text-rose-700 flex items-center font-black text-[20px] tracking-tight">
              <XCircle className="w-6 h-6 mr-2" /> Final Rejection
            </DialogTitle>
            <DialogDescription className="text-muted-foreground font-bold">Close this dispute and uphold the original rejection decision.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {authError && (
              <div className="p-3 bg-rose-50 text-rose-700 text-[14px] font-bold rounded-xl border-2 border-rose-200">
                {authError}
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-[13px] font-bold text-muted-foreground uppercase tracking-widest">Resolution Reason</Label>
              <Textarea 
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="E.g., Evidence confirms adulteration. Cannot accept."
                className="min-h-[120px] bg-muted border-2 border-input rounded-xl text-[16px] font-medium p-4 text-foreground"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowRejectModal(false)} className="h-14 rounded-xl font-bold text-[16px] border-2 border-input text-foreground hover:bg-muted active:scale-[0.98] transition-all" disabled={isSubmitting}>Cancel</Button>
            <Button onClick={handleFinalRejection} disabled={!rejectReason || isSubmitting} className="h-14 rounded-xl font-extrabold text-[16px] bg-rose-600 hover:bg-rose-700 text-white shadow-sm active:scale-[0.98] transition-all">
              {isSubmitting ? 'Submitting...' : 'Confirm Rejection'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- ADJUSTMENT MODAL --- */}
      <Dialog open={showAdjustModal} onOpenChange={setShowAdjustModal}>
        <DialogContent className="max-w-md rounded-3xl max-h-[90vh] overflow-y-auto bg-card border-2 border-border">
          <DialogHeader>
            <DialogTitle className="text-primary flex items-center font-black text-[22px] tracking-tight">
              <FileEdit className="w-6 h-6 mr-2" /> Adjust / Correct
            </DialogTitle>
            <DialogDescription className="text-muted-foreground font-bold text-[15px]">Append an amendment and resolve the dispute.</DialogDescription>
          </DialogHeader>
          
          <div className="space-y-5 py-2">
            {authError && (
              <div className="p-3 bg-rose-50 text-rose-700 text-[14px] font-bold rounded-xl border-2 border-rose-200">
                {authError}
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[13px] font-bold text-muted-foreground uppercase tracking-widest">Volume (L)</Label>
                <Input type="number" step="0.1" value={adjustVolume} onChange={e => setAdjustVolume(e.target.value)} className="bg-muted border-2 border-input rounded-xl h-14 text-[18px] font-black text-foreground px-4" />
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-bold text-muted-foreground uppercase tracking-widest">Fat (%)</Label>
                <Input type="number" step="0.1" value={adjustFat} onChange={e => setAdjustFat(e.target.value)} className="bg-muted border-2 border-input rounded-xl h-14 text-[18px] font-black text-foreground px-4" />
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-bold text-muted-foreground uppercase tracking-widest">SNF (%)</Label>
                <Input type="number" step="0.1" value={adjustSnf} onChange={e => setAdjustSnf(e.target.value)} className="bg-muted border-2 border-input rounded-xl h-14 text-[18px] font-black text-foreground px-4" />
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-bold text-muted-foreground uppercase tracking-widest">Temp (°C)</Label>
                <Input type="number" step="0.1" value={adjustTemp} onChange={e => setAdjustTemp(e.target.value)} className="bg-muted border-2 border-input rounded-xl h-14 text-[18px] font-black text-foreground px-4" />
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] font-bold text-muted-foreground uppercase tracking-widest">Acidity (%)</Label>
                <Input type="number" step="0.01" value={adjustAcidity} onChange={e => setAdjustAcidity(e.target.value)} className="bg-muted border-2 border-input rounded-xl h-14 text-[18px] font-black text-foreground px-4" />
              </div>
              <div className="space-y-2 flex items-end pb-2">
                <label className="flex items-center space-x-3 text-[14px] font-bold text-foreground cursor-pointer bg-muted border-2 border-input p-3 h-14 rounded-xl w-full">
                  <input type="checkbox" checked={adjustSediment} onChange={e => setAdjustSediment(e.target.checked)} className="rounded-md w-5 h-5 text-primary focus:ring-primary border-input" />
                  <span>Sediment</span>
                </label>
              </div>
            </div>

            {/* Decision toggle removed since adjustments represent acceptance */}

            <div className="space-y-2">
              <Label className="text-[13px] font-bold text-muted-foreground uppercase tracking-widest">Reason for Amendment</Label>
              <Textarea 
                value={adjustReason}
                onChange={e => setAdjustReason(e.target.value)}
                placeholder="E.g., Recalibrated machine and retested sample."
                className="min-h-[100px] bg-muted border-2 border-input rounded-xl text-[16px] font-medium p-4 text-foreground"
              />
            </div>
          </div>
          
          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button variant="outline" onClick={() => setShowAdjustModal(false)} className="h-14 rounded-xl font-bold text-[16px] border-2 border-input text-foreground hover:bg-muted active:scale-[0.98] transition-all" disabled={isSubmitting}>Cancel</Button>
            <Button onClick={handleAdjustment} disabled={!adjustReason || isSubmitting} className="h-14 rounded-xl font-extrabold text-[16px] bg-primary hover:bg-primary/90 text-primary-foreground shadow-md active:scale-[0.98] transition-all">
              {isSubmitting ? 'Submitting...' : 'Submit Adjustment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
