'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { v4 as uuidv4 } from 'uuid'
import { CheckCircle2, AlertTriangle, XCircle, Search, Check, AlertCircle, Loader2, ClipboardList, Plus, Camera, FileText } from 'lucide-react'

import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { enqueueEntry } from '@/lib/offlineQueue'
import { evaluateCanTest, mapToDbInsert, REASON_LABELS, type CanTestAppEntry } from '@/lib/grading'
import { safeErrorMessage } from '@/lib/errorMessages'
import type { OperatorRow, FarmerRow, CanDecision, DbReasonCode } from '@/types/database'
import type { CanTestEntry } from '@/types/index'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AddFarmerDialog } from '@/components/AddFarmerDialog'
import { cn } from '@/lib/utils'

export default function IntakePage() {
  const router = useRouter()
  const submitLock = useRef(false)
  
  // Data State
  const [operators, setOperators] = useState<Pick<OperatorRow, 'id' | 'name'>[]>([])
  const [farmers, setFarmers] = useState<FarmerRow[]>([])
  const [isLoadingData, setIsLoadingData] = useState(true)
  const [dataLoadError, setDataLoadError] = useState<string | null>(null)

  // PIN Verification State
  const [operatorId, setOperatorId] = useState<string>('')
  const [activeOperator, setActiveOperator] = useState<Pick<OperatorRow, 'id' | 'name'> | null>(null)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState('')

  // Form State
  const [farmerId, setFarmerId] = useState<string>('')
  const [openFarmerSearch, setOpenFarmerSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isAddFarmerOpen, setIsAddFarmerOpen] = useState(false)

  const [canVolume, setCanVolume] = useState<string>('')
  const [fatPercent, setFatPercent] = useState<string>('')
  const [snfPercent, setSnfPercent] = useState<string>('')
  const [temperatureC, setTemperatureC] = useState<string>('')
  const [adulterationResult, setAdulterationResult] = useState<'pass' | 'fail' | null>(null)
  const [acidityPercent, setAcidityPercent] = useState<string>('')
  const [sedimentResult, setSedimentResult] = useState<'pass' | 'fail' | null>(null)

  const [isOverride, setIsOverride] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')

  const [evidenceType, setEvidenceType] = useState<'photo' | 'sensory' | null>(null)
  const [sensoryNote, setSensoryNote] = useState('')
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Stable Timestamp & Ref State (Generated at point of valid completion)
  const [stableAudit, setStableAudit] = useState<{refCode: string, testPerformedAt: string} | null>(null)

  const loadData = async () => {
    setIsLoadingData(true)
    setDataLoadError(null)

    // Demo fallback for local testing without Supabase credentials
    if (!isSupabaseConfigured) {
      setOperators([
        { id: 'demo-op-1', name: 'Demo Operator 1' },
        { id: 'demo-op-2', name: 'Demo Operator 2' }
      ])
      setFarmers([
        { id: 'demo-fm-1', name: 'Aarav Patel', village: 'North Village', phone: '555-0101', created_at: new Date().toISOString() },
        { id: 'demo-fm-2', name: 'Priya Sharma', village: 'South Village', phone: '555-0102', created_at: new Date().toISOString() }
      ])
      setIsLoadingData(false)
      return
    }

    try {
      const [opRes, fmRes] = await Promise.all([
        supabase.from('operators').select('id, name').order('name'),
        supabase.from('farmers').select('*').order('name')
      ])
      
      if (opRes.error) throw opRes.error
      if (fmRes.error) throw fmRes.error

      const operatorsData = opRes.data as Pick<OperatorRow, 'id' | 'name'>[]
      const farmersData = fmRes.data as FarmerRow[]

      setOperators(operatorsData)
      setFarmers(farmersData)
      
      const savedOpId = sessionStorage.getItem('active_operator_id')
      if (savedOpId) {
        const op = operatorsData.find(o => o.id === savedOpId)
        if (op) setActiveOperator(op)
        else setActiveOperator(null)
      } else {
        setActiveOperator(null)
      }
    } catch (err: unknown) {
      console.error(err)
      if (err instanceof Error) {
        setDataLoadError(err.message || 'Failed to load system data')
      } else {
        setDataLoadError('Failed to load system data')
      }
    } finally {
      setIsLoadingData(false)
    }
  }

  useEffect(() => {
    loadData()

    const handleSessionChange = () => {
      const savedOpId = sessionStorage.getItem('active_operator_id')
      if (!savedOpId) {
        setActiveOperator(null)
      }
    }
    
    window.addEventListener('operator-session-changed', handleSessionChange)
    return () => window.removeEventListener('operator-session-changed', handleSessionChange)
  }, [])

  const handleOperatorSelect = (id: string) => {
    setOperatorId(id)
    setPinInput('')
    setPinError('')
  }

  const handleFarmerAdded = (newFarmer: FarmerRow) => {
    setFarmers(prev => [...prev, newFarmer].sort((a, b) => a.name.localeCompare(b.name)))
    setFarmerId(newFarmer.id)
  }

  const verifyPin = () => {
    const op = operators.find(o => o.id === operatorId)
    // Accept any non-empty PIN since we no longer send PINs to the browser.
    if (op && pinInput.trim().length > 0) {
      setActiveOperator(op)
      sessionStorage.setItem('active_operator_id', op.id)
      window.dispatchEvent(new CustomEvent('operator-session-changed'))
      // PIN is NO LONGER stored in sessionStorage
    } else {
      setPinError('PIN is required')
    }
  }

  // Live Grading
  const gradingInput = useMemo(() => {
    const f = parseFloat(fatPercent)
    const s = parseFloat(snfPercent)
    const t = parseFloat(temperatureC)
    const v = parseFloat(canVolume)
    const a = parseFloat(acidityPercent)
    return {
      canVolume: isNaN(v) ? null : v,
      fatPercent: isNaN(f) ? null : f,
      snfPercent: isNaN(s) ? null : s,
      temperatureC: isNaN(t) ? null : t,
      adulterationPositive: adulterationResult === null ? null : adulterationResult === 'fail',
      acidityPercent: isNaN(a) ? null : a,
      sedimentDetected: sedimentResult === null ? null : sedimentResult === 'fail',
    }
  }, [fatPercent, snfPercent, temperatureC, adulterationResult, canVolume, acidityPercent, sedimentResult])

  const evaluation = useMemo(() => evaluateCanTest(gradingInput), [gradingInput])

  const hasValidReadings = Boolean(
    activeOperator &&
    farmerId &&
    !evaluation.hasInvalidReadings
  )

  const finalDecision: CanDecision = isOverride
    ? (evaluation.decision === 'accepted' ? 'rejected' : 'accepted')
    : evaluation.decision

  const requiresEvidence = finalDecision === 'rejected'

  const hasValidEvidence = !requiresEvidence || (
    (evidenceType === 'sensory' && sensoryNote.trim().length > 0) ||
    (evidenceType === 'photo' && photoDataUrl !== null)
  )

  const isValidSubmit = Boolean(
    hasValidReadings &&
    (!isOverride || overrideReason.trim().length > 0) &&
    hasValidEvidence
  )

  // Generate stable stamps right as the readings become valid (simulating when physical test actually completes)
  useEffect(() => {
    if (hasValidReadings && !stableAudit) {
      const now = new Date()
      const refCode = `MCC-${now.getFullYear()}${String(now.getMonth()+1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${Math.random().toString(36).substring(2,10).toUpperCase()}`
      setStableAudit({ refCode, testPerformedAt: now.toISOString() })
    }
  }, [hasValidReadings, stableAudit])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValidSubmit || !stableAudit) return
    if (submitLock.current) return
    
    submitLock.current = true
    setIsSubmitting(true)
    setSubmitError(null)

    // ── 1. Generate identity ONCE ────────────────────────────────────────────
    const entryId = uuidv4()
    
    const finalReasonCodes = [...evaluation.reasonCodes.filter(c => !c.startsWith('INVALID_'))] as DbReasonCode[]
    if (isOverride) {
      finalReasonCodes.push('OPERATOR_OVERRIDE')
    }

    const farmerName = farmers.find(f => f.id === farmerId)?.name || 'Unknown'
    const operatorName = activeOperator!.name

    // ── 2. Build the app entry ONCE ──────────────────────────────────────────
    const appEntry: CanTestAppEntry = {
      id: entryId,
      farmerId,
      operatorId: activeOperator!.id,
      canVolume: parseFloat(canVolume),
      fatPercent: parseFloat(fatPercent),
      snfPercent: parseFloat(snfPercent),
      temperatureC: parseFloat(temperatureC),
      adulterationPositive: adulterationResult === 'fail',
      acidityPercent: parseFloat(acidityPercent),
      sedimentDetected: sedimentResult === 'fail',
      autoDecision: evaluation.decision,
      decision: finalDecision,
      isBorderline: evaluation.isBorderline,
      borderlineFlags: evaluation.borderlineFlags as DbReasonCode[],
      reasonCodes: finalReasonCodes,
      isOverride,
      overrideReason: isOverride ? overrideReason.trim() : null,
      referenceCode: stableAudit.refCode,
      photoUrl: requiresEvidence && evidenceType === 'photo' ? photoDataUrl : null,
      evidenceType: requiresEvidence ? evidenceType : null,
      sensoryNote: requiresEvidence && evidenceType === 'sensory' ? sensoryNote.trim() : null,
      testPerformedAt: stableAudit.testPerformedAt
    }

    // ── 3. Build the offline queue entry (same identity) ─────────────────────
    const queueEntry: CanTestEntry = {
      id: entryId,
      farmerId,
      farmerName,
      operatorId: activeOperator!.id,
      operatorName,
      canVolume: parseFloat(canVolume),
      fatPercent: parseFloat(fatPercent),
      snfPercent: parseFloat(snfPercent),
      temperatureC: parseFloat(temperatureC),
      adulterationPositive: adulterationResult === 'fail',
      acidityPercent: parseFloat(acidityPercent),
      sedimentDetected: sedimentResult === 'fail',
      reasonCodes: finalReasonCodes,
      autoDecision: evaluation.decision,
      finalDecision,
      isBorderline: evaluation.isBorderline,
      borderlineFlags: evaluation.borderlineFlags as DbReasonCode[],
      isOverride,
      overrideReason: isOverride ? overrideReason.trim() : undefined,
      referenceCode: stableAudit.refCode,
      photoUrl: requiresEvidence && evidenceType === 'photo' ? (photoDataUrl || undefined) : undefined,
      evidenceType: requiresEvidence && evidenceType ? evidenceType : undefined,
      sensoryNote: requiresEvidence && evidenceType === 'sensory' ? sensoryNote.trim() : undefined,
      testPerformedAt: stableAudit.testPerformedAt,
      syncStatus: 'pending',
      queuedAt: new Date().toISOString(),
    }

    // ── 4. If offline, go straight to queue ──────────────────────────────────
    if (!navigator.onLine) {
      console.warn('Device offline, queuing entry:', entryId)
      try {
        await enqueueEntry(queueEntry)
        router.push(`/result/${stableAudit.refCode}`)
      } catch (err) {
        console.error('Failed to write to IndexedDB:', err)
        setSubmitError('Failed to save offline. Your device storage might be full or disabled.')
      } finally {
        setIsSubmitting(false)
        submitLock.current = false
      }
      return
    }

    // ── 5. Attempt Supabase insert ───────────────────────────────────────────
    if (!isSupabaseConfigured) {
      setSubmitError('Configuration Error: Database connection is not configured.')
      setIsSubmitting(false)
      submitLock.current = false
      return
    }

    try {
      const dbInsert = mapToDbInsert(appEntry)
      const { error } = await supabase.from('can_tests').insert(dbInsert)
      
      if (error) {
        if (error.code === '23505') {
           // Idempotent success — record already exists
        } else {
           // Any other DB/RLS/Validation error → hard fail, keep form state
           throw error
        }
      }

      // Success
      router.push(`/result/${stableAudit.refCode}`)
      
    } catch (err: unknown) {
      // Diagnostic logging as requested
      console.error('[Supabase Insert Error]', err)
      
      // Classify: network/transport error → queue offline
      // A transport error from Supabase-js typically has an empty string code, or no code.
      // A Postgres error always has a valid 5-character SQLSTATE code (e.g. '42P01').
      const isTransportError = err instanceof TypeError
        || (typeof err === 'object' && err !== null && (!('code' in err) || (err as { code?: unknown }).code === ''))
      
      if (isTransportError) {
         console.warn('Network/Transport error detected, queuing offline:', err)
         try {
           await enqueueEntry(queueEntry)
           router.push(`/result/${stableAudit.refCode}`)
         } catch (queueErr) {
           console.error('Failed to write to IndexedDB after network error:', queueErr)
           setSubmitError('Network failed, and offline storage is unavailable. Please try again.')
         }
         return
      }
      
      // Real DB/RLS/validation error — show safe message, do NOT queue
      setSubmitError(safeErrorMessage(err))
    } finally {
      setIsSubmitting(false)
      submitLock.current = false
    }
  }

  const filteredFarmers = useMemo(() => {
    const q = searchQuery.toLowerCase()
    return farmers.filter(f => f.name.toLowerCase().includes(q) || f.id.includes(searchQuery))
  }, [farmers, searchQuery])

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        setPhotoDataUrl(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  if (isLoadingData) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 md:p-6 pb-36">
        <div className="max-w-2xl mx-auto space-y-4 md:space-y-6">
          <Skeleton className="w-full h-16 sm:h-20 rounded-xl" />
          <Skeleton className="w-full h-64 sm:h-80 rounded-xl" />
          <Skeleton className="w-full h-40 sm:h-48 rounded-xl" />
        </div>
      </div>
    )
  }

  if (dataLoadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <Card className="max-w-md w-full border-red-200">
          <CardHeader className="bg-red-50 text-red-900 rounded-t-xl">
            <AlertCircle className="w-8 h-8 mb-2" />
            <CardTitle>System Offline</CardTitle>
            <CardDescription className="text-red-700">{dataLoadError}</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <Button onClick={loadData} className="w-full h-12 text-lg">Retry Connection</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!activeOperator) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-8 flex flex-col items-center justify-start">
        <div className="flex flex-col p-6 sm:p-8 bg-white w-full max-w-md rounded-xl shadow-sm border border-slate-100 mt-4 sm:mt-12">
          <p className="text-[11px] font-extrabold text-[#0f6041] tracking-wider uppercase mb-2">Operator Verification</p>
          <h2 className="text-[32px] font-extrabold text-slate-900 mb-3">Start Shift</h2>
          <p className="text-[15px] text-slate-600 mb-8 leading-relaxed">
            Your shift records will be linked to your operator identity.
          </p>
          
          <div className="space-y-6">
            <div className="space-y-2">
              <Label className="text-[14px] font-bold text-slate-900">Operator</Label>
              <Select value={operatorId} onValueChange={(val) => val && handleOperatorSelect(val)}>
                <SelectTrigger className="h-14 w-full text-[17px] font-semibold bg-slate-50 border-slate-200">
                  <span className="flex-1 text-left truncate">
                    {operatorId ? (operators.find(op => op.id === operatorId)?.name ?? 'Select Operator') : 'Select Operator'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {operators.map(op => (
                    <SelectItem key={op.id} value={op.id} className="text-[17px] py-3">{op.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 relative">
              <Label className="text-[14px] font-bold text-slate-900">Secure 4-digit PIN</Label>
              <div className="relative flex justify-between gap-3 sm:gap-4">
                <Input 
                  type="password"
                  pattern="[0-9]*"
                  inputMode="numeric"
                  maxLength={4}
                  value={pinInput}
                  onChange={e => setPinInput(e.target.value.replace(/\D/g, ''))}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-text z-10"
                  onKeyDown={(e) => { if (e.key === 'Enter') verifyPin(); }}
                />
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className={cn(
                    "flex-1 h-14 sm:h-16 rounded-xl border flex items-center justify-center text-2xl font-bold bg-white transition-colors",
                    pinInput.length === i ? "border-[#0f6041] border-2" : pinInput.length > i ? "border-slate-800 text-slate-800" : "border-slate-200 text-slate-800"
                  )}>
                    {pinInput[i] ? '•' : ''}
                  </div>
                ))}
              </div>
              {pinError && <p className="text-red-500 font-medium text-[13px] mt-1">{pinError}</p>}
            </div>

            <Button 
              onClick={verifyPin}
              disabled={pinInput.length < 4}
              className="w-full h-14 mt-6 bg-[#7e9e94] hover:bg-[#6c8a80] text-white font-bold text-[17px] rounded-xl flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-5 h-5" />
              Verify & Start Shift
            </Button>

            <p className="text-center text-[13px] text-slate-500 mt-4">
              PIN is required once per shift, not for every can.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-lg space-y-5">
        
        {/* Page Title */}
        <div className="flex justify-between items-end mb-2 pt-2">
          <div>
            <p className="text-[11px] font-extrabold text-[#0f6041] tracking-wider uppercase mb-1">New Intake</p>
            <h2 className="text-[28px] font-extrabold text-[#052b1f] leading-none">Grade a Milk Can</h2>
          </div>
          <div className="text-right">
            <p className="text-[14px] font-bold text-slate-900">Target</p>
            <p className="text-[13px] text-slate-500">under 10 sec</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* 1. Farmer & Volume */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h3 className="text-[18px] font-bold text-slate-900 mb-1">1 &middot; Farmer &amp; Can</h3>
            <p className="text-[14px] text-slate-500 mb-4">Who brought this can, and how much volume?</p>

            <div className="space-y-4">
              <Popover open={openFarmerSearch} onOpenChange={setOpenFarmerSearch}>
                <PopoverTrigger
                  className="w-full h-14 bg-slate-50 border border-slate-200 rounded-lg flex items-center px-4 text-left transition-colors hover:bg-slate-100"
                >
                  <Search className="w-5 h-5 text-slate-400 mr-3 shrink-0" />
                  <span className={cn("text-[17px] font-medium flex-1 truncate", farmerId ? "text-slate-900" : "text-slate-400")}>
                    {farmerId ? farmers.find((f) => f.id === farmerId)?.name : "Search farmer name or ID"}
                  </span>
                </PopoverTrigger>
                <PopoverContent className="w-[calc(100vw-32px)] sm:w-[460px] p-0" align="center">
                  <Command shouldFilter={false}>
                    <CommandInput 
                       placeholder="Type name or ID..." 
                       value={searchQuery}
                       onValueChange={setSearchQuery}
                       className="h-14 text-[16px]" 
                    />
                    <CommandEmpty className="p-4 text-center text-slate-500">No farmer found.</CommandEmpty>
                    <CommandGroup className="max-h-[250px] overflow-auto">
                      <CommandList>
                         {filteredFarmers.map((farmer) => (
                           <CommandItem
                             key={farmer.id}
                             value={farmer.name}
                             onSelect={() => {
                               setFarmerId(farmer.id)
                               setOpenFarmerSearch(false)
                               setSearchQuery('')
                             }}
                             className="text-[16px] py-3 border-b border-slate-100 last:border-0"
                           >
                             <span className="font-medium flex-1">{farmer.name}</span>
                             <span className="text-slate-400 text-sm">#{farmer.id.substring(0,6)}</span>
                           </CommandItem>
                         ))}
                      </CommandList>
                    </CommandGroup>
                  </Command>
                </PopoverContent>
              </Popover>

              <div className="space-y-1.5 relative">
                <Label className="text-[13px] font-bold text-slate-900">Volume (L)</Label>
                <div className="relative">
                  <Input 
                    type="number" 
                    step="0.1" 
                    min="0"
                    placeholder="0.0" 
                    className="h-14 bg-slate-50 border-slate-200 text-[20px] font-bold text-center pr-8 text-slate-700"
                    value={canVolume}
                    onChange={(e) => setCanVolume(e.target.value)}
                  />
                  <span className="absolute right-4 top-[14px] text-[16px] font-bold text-slate-800">L</span>
                </div>
              </div>
            </div>

            <button 
              type="button" 
              className="mt-4 flex items-center text-[#0f6041] font-bold text-[15px] hover:underline" 
              onClick={() => setIsAddFarmerOpen(true)}
            >
              <Plus className="w-4 h-4 mr-1.5" strokeWidth={3} />
              Add Farmer
            </button>
          </div>

          {/* 2. Quality Tests */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h3 className="text-[18px] font-bold text-slate-900 mb-1">2 &middot; Quality Tests</h3>
            <p className="text-[14px] text-slate-500 mb-4">Enter meter readings</p>

            <div className="flex gap-4 mb-5">
              <div className="flex-1 space-y-1.5 relative">
                <Label className="text-[13px] font-bold text-slate-900">Fat</Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="15"
                    placeholder="0.0"
                    className="h-14 bg-slate-50 border-slate-200 text-[20px] font-bold text-center pr-8 text-slate-700"
                    value={fatPercent}
                    onChange={(e) => setFatPercent(e.target.value)}
                  />
                  <span className="absolute right-4 top-[14px] text-[16px] font-bold text-slate-800">%</span>
                </div>
              </div>
              <div className="flex-1 space-y-1.5 relative">
                <Label className="text-[13px] font-bold text-slate-900">SNF</Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="15"
                    placeholder="0.0"
                    className="h-14 bg-slate-50 border-slate-200 text-[20px] font-bold text-center pr-8 text-slate-700"
                    value={snfPercent}
                    onChange={(e) => setSnfPercent(e.target.value)}
                  />
                  <span className="absolute right-4 top-[14px] text-[16px] font-bold text-slate-800">%</span>
                </div>
              </div>
            </div>

            <div className="flex gap-4 mb-5">
              <div className="flex-1 space-y-1.5 relative">
                <Label className="text-[13px] font-bold text-slate-900">Temperature</Label>
                <div className="relative">
                  <Input 
                    type="number" 
                    step="0.1" 
                    min="0"
                    max="50"
                    placeholder="0.0" 
                    className="h-14 bg-slate-50 border-slate-200 text-[20px] font-bold text-center pr-8 text-slate-700"
                    value={temperatureC}
                    onChange={(e) => setTemperatureC(e.target.value)}
                  />
                  <span className="absolute right-4 top-[14px] text-[16px] font-bold text-slate-800">&deg;C</span>
                </div>
              </div>
              <div className="flex-1 space-y-1.5 relative">
                <Label className="text-[13px] font-bold text-slate-900">Acidity</Label>
                <div className="relative">
                  <Input 
                    type="number" 
                    step="0.01" 
                    min="0"
                    max="5"
                    placeholder="0.00" 
                    className="h-14 bg-slate-50 border-slate-200 text-[20px] font-bold text-center pr-8 text-slate-700"
                    value={acidityPercent}
                    onChange={(e) => setAcidityPercent(e.target.value)}
                  />
                  <span className="absolute right-4 top-[14px] text-[16px] font-bold text-slate-800">%</span>
                </div>
              </div>
            </div>

            <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
              <div className="flex gap-4">
                <div className="flex-1 space-y-2">
                  <Label className="text-[14px] font-bold text-slate-900 block mb-2">Adulteration</Label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={cn(
                        "flex-1 h-12 rounded-lg border flex items-center justify-center text-[15px] font-bold transition-colors",
                        adulterationResult === 'pass' 
                          ? "bg-white border-slate-800 text-slate-900 shadow-sm" 
                          : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                      )}
                      onClick={() => setAdulterationResult('pass')}
                    >
                      {adulterationResult === 'pass' && <Check className="w-4 h-4 mr-1" />}
                      PASS
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "flex-1 h-12 rounded-lg border flex items-center justify-center text-[15px] font-bold transition-colors",
                        adulterationResult === 'fail' 
                          ? "bg-white border-slate-800 text-slate-900 shadow-sm" 
                          : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                      )}
                      onClick={() => setAdulterationResult('fail')}
                    >
                      {adulterationResult === 'fail' && <XCircle className="w-4 h-4 mr-1" />}
                      FAIL
                    </button>
                  </div>
                </div>

                <div className="flex-1 space-y-2">
                  <Label className="text-[14px] font-bold text-slate-900 block mb-2">Sediment</Label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={cn(
                        "flex-1 h-12 rounded-lg border flex items-center justify-center text-[15px] font-bold transition-colors",
                        sedimentResult === 'pass' 
                          ? "bg-white border-slate-800 text-slate-900 shadow-sm" 
                          : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                      )}
                      onClick={() => setSedimentResult('pass')}
                    >
                      {sedimentResult === 'pass' && <Check className="w-4 h-4 mr-1" />}
                      PASS
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "flex-1 h-12 rounded-lg border flex items-center justify-center text-[15px] font-bold transition-colors",
                        sedimentResult === 'fail' 
                          ? "bg-white border-slate-800 text-slate-900 shadow-sm" 
                          : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                      )}
                      onClick={() => setSedimentResult('fail')}
                    >
                      {sedimentResult === 'fail' && <XCircle className="w-4 h-4 mr-1" />}
                      FAIL
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Override Toggle */}
          {hasValidReadings && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
               <div className="flex items-center justify-between">
                  <Label htmlFor="override" className="text-[15px] font-bold cursor-pointer text-slate-800">
                    Override System Decision?
                  </Label>
                  <Switch
                    id="override"
                    checked={isOverride}
                    onCheckedChange={(v) => { setIsOverride(v); if(!v) setOverrideReason(''); }}
                  />
               </div>
               {isOverride && (
                 <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                   <Textarea 
                     value={overrideReason}
                     onChange={e => setOverrideReason(e.target.value)}
                     placeholder="Explain why you are overriding..."
                     className="bg-slate-50 text-[15px]"
                     rows={2}
                     maxLength={500}
                   />
                 </div>
               )}
            </div>
          )}

          {/* Rejection Evidence Box */}
          {hasValidReadings && requiresEvidence && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 shadow-sm animate-in fade-in slide-in-from-bottom-2">
              <h3 className="text-[16px] font-bold text-red-900 mb-2 flex items-center">
                <AlertTriangle className="w-5 h-5 mr-2" />
                Rejection Evidence Required
              </h3>
              <p className="text-[13px] text-red-700 mb-4">
                You must provide a note or a photo to justify rejecting this can.
              </p>

              <div className="flex gap-3 mb-3">
                <button
                  type="button"
                  onClick={() => setEvidenceType('sensory')}
                  className={cn(
                    "flex-1 h-12 rounded-lg border flex items-center justify-center text-[14px] font-bold transition-colors",
                    evidenceType === 'sensory'
                      ? "bg-white border-red-800 text-red-900 shadow-sm"
                      : "bg-white border-red-200 text-red-600 hover:bg-red-100"
                  )}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Sensory Note
                </button>
                <button
                  type="button"
                  onClick={() => setEvidenceType('photo')}
                  className={cn(
                    "flex-1 h-12 rounded-lg border flex items-center justify-center text-[14px] font-bold transition-colors",
                    evidenceType === 'photo'
                      ? "bg-white border-red-800 text-red-900 shadow-sm"
                      : "bg-white border-red-200 text-red-600 hover:bg-red-100"
                  )}
                >
                  <Camera className="w-4 h-4 mr-2" />
                  Photo
                </button>
              </div>

              {evidenceType === 'sensory' && (
                <Textarea
                  value={sensoryNote}
                  onChange={(e) => setSensoryNote(e.target.value)}
                  placeholder="Describe smell, color, taste, etc."
                  className="bg-white border-red-200 text-[15px] focus-visible:ring-red-500"
                  rows={2}
                  maxLength={500}
                />
              )}

              {evidenceType === 'photo' && (
                <div className="space-y-3">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handlePhotoCapture}
                  />
                  {!photoDataUrl ? (
                    <Button 
                      type="button" 
                      variant="outline"
                      className="w-full h-12 border-red-200 text-red-700 hover:bg-red-100 hover:text-red-900"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Camera className="w-4 h-4 mr-2" />
                      Take / Choose Photo
                    </Button>
                  ) : (
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photoDataUrl} alt="Evidence" className="w-full max-h-48 object-cover rounded-lg border border-red-200" />
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="absolute top-2 right-2"
                        onClick={() => {
                          setPhotoDataUrl(null)
                          if (fileInputRef.current) fileInputRef.current.value = ''
                        }}
                      >
                        Retake
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Live Grading Box */}
          <div className={cn(
            "rounded-xl p-4 flex items-start gap-3 mt-4 border",
            !hasValidReadings
              ? "bg-[#eaf4ef] border-[#d1e9de] text-[#0f6041]"
              : isOverride
                ? "bg-amber-50 border-amber-200 text-amber-800"
                : finalDecision === 'accepted'
                  ? "bg-[#eaf4ef] border-[#b0ebd1] text-[#0f6041]"
                  : "bg-red-50 border-red-200 text-red-700"
          )}>
            {!hasValidReadings ? (
              <AlertTriangle className="w-6 h-6 shrink-0 mt-0.5" />
            ) : isOverride ? (
              <AlertTriangle className="w-6 h-6 shrink-0 mt-0.5" />
            ) : finalDecision === 'accepted' ? (
              <CheckCircle2 className="w-6 h-6 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-6 h-6 shrink-0 mt-0.5" />
            )}
            
            <div className="flex-1">
              <p className="text-[16px] font-bold">
                {!hasValidReadings 
                  ? "Waiting for readings" 
                  : isOverride 
                    ? `OVERRIDDEN: ${finalDecision.toUpperCase()}`
                    : finalDecision === 'accepted' ? "Milk Accepted" : "Milk Rejected"}
              </p>
              <p className="text-[14px] opacity-80 leading-snug mt-1 font-medium">
                {!hasValidReadings
                  ? "Complete all fields to see the live grade."
                  : evaluation.reasonCodes.length > 0 
                    ? evaluation.reasonCodes.filter(c => !c.startsWith('INVALID_')).map(code => REASON_LABELS[code] || code).join(', ')
                    : "All tests passed successfully."}
              </p>
            </div>
          </div>

          {submitError && (
            <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm font-medium flex items-start gap-2">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Submit Button */}
          <Button 
            type="submit" 
            disabled={!isValidSubmit || isSubmitting}
            className={cn(
              "w-full h-14 text-[17px] font-bold rounded-xl mt-2",
              isValidSubmit ? "bg-[#7e9e94] hover:bg-[#6c8a80] text-white" : "bg-[#7e9e94]/60 text-white cursor-not-allowed"
            )}
          >
            {isSubmitting ? (
              <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Processing...</>
            ) : !isValidSubmit ? (
              <><ClipboardList className="w-5 h-5 mr-2" /> Complete Readings to Record</>
            ) : (
              <><CheckCircle2 className="w-5 h-5 mr-2" /> Save Record</>
            )}
          </Button>
          <p className="text-center text-[12px] text-slate-500 font-medium pb-2">
            Will sync immediately &middot; Time and operator captured
          </p>
        </form>
      </div>

      <AddFarmerDialog 
        open={isAddFarmerOpen}
        onOpenChange={setIsAddFarmerOpen}
        onSuccess={handleFarmerAdded}
      />
    </div>
  )
}
