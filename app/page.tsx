'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { v4 as uuidv4 } from 'uuid'
import { CheckCircle2, AlertTriangle, XCircle, Search, Check, AlertCircle, Loader2, ClipboardList, Plus, Camera, FileText, ArrowRight } from 'lucide-react'

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
        supabase.from('operator_profiles').select('id, name').order('name'),
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
      console.error('Data load error:', err)
      const message = err instanceof Error ? err.message : (err as { message?: string })?.message
      setDataLoadError(message || 'Failed to load system data')
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
      sessionStorage.setItem('active_operator_name', op.name)
      window.dispatchEvent(new CustomEvent('operator-session-changed'))
      // PIN is NO LONGER stored in sessionStorage
    } else {
      setPinError('PIN is required')
    }
  }

  const pinRefs = useRef<(HTMLInputElement | null)[]>([])

  const handlePinChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1)
    const newPin = pinInput.split('')
    newPin[index] = digit
    
    if (!digit) {
      newPin[index] = ''
    }

    const updatedPin = newPin.join('')
    setPinInput(updatedPin)

    if (digit && index < 3) {
      pinRefs.current[index + 1]?.focus()
    }
  }

  const handlePinKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !pinInput[index] && index > 0) {
      pinRefs.current[index - 1]?.focus()
    } else if (e.key === 'Enter') {
      verifyPin()
    }
  }

  const handlePinPaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4)
    if (pastedData) {
      setPinInput(pastedData)
      const nextIndex = Math.min(pastedData.length, 3)
      pinRefs.current[nextIndex]?.focus()
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
      if (file.size > 10 * 1024 * 1024) {
        setSubmitError('Photo is too large. Please take a new one under 10MB.')
        return
      }
      if (submitError === 'Photo is too large. Please take a new one under 10MB.') {
        setSubmitError('')
      }
      
      const reader = new FileReader()
      reader.onload = () => {
        const img = new Image()
        img.onload = () => {
          setSubmitError('')
          const canvas = document.createElement('canvas')
          const MAX_DIMENSION = 1024
          let { width, height } = img

          if (width > height) {
            if (width > MAX_DIMENSION) {
              height = Math.round((height * MAX_DIMENSION) / width)
              width = MAX_DIMENSION
            }
          } else {
            if (height > MAX_DIMENSION) {
              width = Math.round((width * MAX_DIMENSION) / height)
              height = MAX_DIMENSION
            }
          }

          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          ctx?.drawImage(img, 0, 0, width, height)

          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8)
          setPhotoDataUrl(compressedDataUrl)
        }
        img.onerror = () => {
          setSubmitError('Failed to decode the selected photo.')
        }
        img.src = reader.result as string
      }
      reader.onerror = () => {
        setSubmitError('Failed to read the selected photo file.')
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
      <div className="min-h-[calc(100vh-64px)] bg-slate-50 px-3 py-6 sm:px-4 sm:py-8 flex flex-col items-center justify-start">
        <div className="flex flex-col p-5 sm:p-8 bg-white w-full max-w-md rounded-2xl shadow-sm border mt-2 sm:mt-12">
          <p className="text-[11px] font-bold text-mcc-dark tracking-widest uppercase mb-2">Operator Verification</p>
          <h2 className="text-[28px] sm:text-[36px] font-extrabold text-foreground mb-2 tracking-tight">Start Shift</h2>
          <p className="text-[14px] text-muted-foreground mb-6 leading-relaxed">
            Select your identity and enter your secure PIN.
          </p>
          
          <div className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="operator-select" className="text-[11px] font-bold text-mcc-dark tracking-wide uppercase block">Select Operator</label>
              {/* Native select — avoids portal/z-index overlap on mobile */}
              <select
                id="operator-select"
                value={operatorId}
                onChange={e => e.target.value && handleOperatorSelect(e.target.value)}
                className={cn(
                  "w-full h-14 rounded-xl border-2 bg-white px-4 text-[15px] font-bold text-foreground appearance-none cursor-pointer focus:outline-none transition-colors",
                  operatorId ? "border-mcc-green" : "border-border"
                )}
              >
                <option value="">Select Operator</option>
                {operators.map(op => (
                  <option key={op.id} value={op.id}>{op.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-bold text-mcc-dark tracking-wide uppercase block">Secure 4-digit PIN</label>
              <div className="flex justify-between gap-2 sm:gap-4" onPaste={handlePinPaste}>
                {[0, 1, 2, 3].map(i => (
                  <input 
                    key={i}
                    ref={el => { pinRefs.current[i] = el }}
                    type="password"
                    pattern="[0-9]*"
                    inputMode="numeric"
                    maxLength={1}
                    aria-label={`PIN digit ${i + 1}`}
                    value={pinInput[i] || ''}
                    onChange={e => handlePinChange(i, e.target.value)}
                    onKeyDown={e => handlePinKeyDown(i, e)}
                    className={cn(
                      "flex-1 h-14 min-w-0 rounded-xl border-2 text-center text-2xl font-bold bg-white transition-colors outline-none",
                      pinInput.length === i
                        ? "border-mcc-green shadow-sm"
                        : pinInput.length > i
                          ? "border-mcc-dark"
                          : "border-border"
                    )}
                  />
                ))}
              </div>
              {pinError && <p className="text-destructive font-medium text-[13px] mt-1">{pinError}</p>}
            </div>

            <Button 
              onClick={verifyPin} 
              disabled={!operatorId || pinInput.length < 4}
              className="w-full h-14 text-[15px] font-bold bg-[#759e93] hover:bg-mcc-green text-white rounded-xl shadow-none transition-colors disabled:opacity-50"
            >
              <CheckCircle2 className="w-5 h-5 mr-2 opacity-80" />
              Start Shift
              <ArrowRight className="w-5 h-5 ml-2 opacity-80" />
            </Button>
            
            <p className="text-center text-[12px] text-muted-foreground">
              Verified locally. Valid for this shift only.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full bg-background px-3 py-4 sm:px-6 sm:py-6 pb-24">
      <div className="mx-auto max-w-lg space-y-5">
        
        {/* Page Title */}
        <div className="flex justify-between items-end mb-4 pt-2">
          <div>
            <p className="text-[12px] font-bold text-mcc-dark tracking-widest uppercase mb-1">New Intake</p>
            <h2 className="text-[32px] md:text-[36px] font-extrabold text-foreground leading-tight tracking-tight">Grade a Milk Can</h2>
          </div>
          <div className="text-right pb-1">
            <p className="text-[12px] font-bold text-mcc-dark uppercase tracking-wide">Target</p>
            <p className="text-[14px] text-muted-foreground font-bold">&lt; 10 sec</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          
          {/* 1. Farmer & Volume */}
          <div className="bg-white rounded-2xl border-2 border-border p-5 md:p-6 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-[18px] font-extrabold text-foreground mb-1">1 &middot; Farmer &amp; Can</h3>
                <p className="text-[13px] text-muted-foreground">Select farmer and enter volume</p>
              </div>
              <button 
                type="button" 
                aria-label="Add farmer"
                className="flex items-center justify-center w-10 h-10 rounded-full bg-mcc-light text-mcc-dark hover:bg-mcc-light/80 transition-colors" 
                onClick={() => setIsAddFarmerOpen(true)}
              >
                <Plus className="w-5 h-5" strokeWidth={2.5} />
              </button>
            </div>

            <div className="space-y-5">
              <Popover open={openFarmerSearch} onOpenChange={setOpenFarmerSearch}>
                <PopoverTrigger
                  className={cn(
                    "w-full h-14 bg-white border-2 rounded-xl flex items-center px-4 text-left transition-colors hover:bg-slate-50",
                    farmerId ? "border-mcc-green" : "border-border"
                  )}
                >
                  <Search className={cn("w-5 h-5 mr-3 shrink-0", farmerId ? "text-mcc-dark" : "text-muted-foreground")} />
                  <span className={cn("text-[16px] font-bold flex-1 truncate", farmerId ? "text-foreground" : "text-muted-foreground")}>
                    {farmerId ? farmers.find((f) => f.id === farmerId)?.name : "Search farmer name or ID"}
                  </span>
                </PopoverTrigger>
                <PopoverContent className="w-[calc(100vw-32px)] sm:w-[460px] p-0 rounded-xl" align="center">
                  <Command shouldFilter={false}>
                    <CommandInput 
                       placeholder="Type name or ID..." 
                       value={searchQuery}
                       onValueChange={setSearchQuery}
                       className="h-14 text-[16px] font-medium" 
                    />
                    <CommandEmpty className="p-4 text-center text-muted-foreground font-medium">No farmer found.</CommandEmpty>
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
                             className="text-[17px] py-4 border-b border-border last:border-0"
                           >
                             <span className="font-bold flex-1">{farmer.name}</span>
                             <span className="text-muted-foreground font-medium text-[15px]">#{farmer.id.substring(0,6)}</span>
                           </CommandItem>
                         ))}
                      </CommandList>
                    </CommandGroup>
                  </Command>
                </PopoverContent>
              </Popover>

              <div className="space-y-2 relative">
                <Label className="text-[14px] font-bold text-foreground ml-1">Volume</Label>
                <div className="relative">
                  <Input 
                    type="number" 
                    step="0.1" 
                    min="0"
                    placeholder="0.0" 
                    className="h-16 bg-muted/50 border-input text-[24px] font-extrabold text-center pr-12 text-foreground rounded-xl"
                    value={canVolume}
                    onChange={(e) => setCanVolume(e.target.value)}
                  />
                  <span className="absolute right-5 top-[18px] text-[18px] font-extrabold text-muted-foreground">L</span>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Quality Tests */}
          <div className="bg-white rounded-2xl border-2 border-border p-5 md:p-6 shadow-sm">
            <h3 className="text-[18px] font-extrabold text-foreground mb-1">2 &middot; Quality Tests</h3>
            <p className="text-[13px] text-muted-foreground mb-5">Enter meter readings</p>

            <div className="grid grid-cols-2 gap-4 mb-5">
              <div className="space-y-2 relative">
                <Label className="text-[14px] font-bold text-foreground ml-1">Fat</Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="15"
                    placeholder="0.0"
                    className="h-16 bg-muted/50 border-input text-[22px] font-extrabold text-center pr-8 text-foreground rounded-xl"
                    value={fatPercent}
                    onChange={(e) => setFatPercent(e.target.value)}
                  />
                  <span className="absolute right-4 top-[18px] text-[16px] font-bold text-muted-foreground">%</span>
                </div>
              </div>
              <div className="space-y-2 relative">
                <Label className="text-[14px] font-bold text-foreground ml-1">SNF</Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="15"
                    placeholder="0.0"
                    className="h-16 bg-muted/50 border-input text-[22px] font-extrabold text-center pr-8 text-foreground rounded-xl"
                    value={snfPercent}
                    onChange={(e) => setSnfPercent(e.target.value)}
                  />
                  <span className="absolute right-4 top-[18px] text-[16px] font-bold text-muted-foreground">%</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="space-y-2 relative">
                <Label className="text-[14px] font-bold text-foreground ml-1">Temperature</Label>
                <div className="relative">
                  <Input 
                    type="number" 
                    step="0.1" 
                    min="0"
                    max="50"
                    placeholder="0.0" 
                    className="h-16 bg-muted/50 border-input text-[22px] font-extrabold text-center pr-8 text-foreground rounded-xl"
                    value={temperatureC}
                    onChange={(e) => setTemperatureC(e.target.value)}
                  />
                  <span className="absolute right-3 top-[18px] text-[16px] font-bold text-muted-foreground">&deg;C</span>
                </div>
              </div>
              <div className="space-y-2 relative">
                <Label className="text-[14px] font-bold text-foreground ml-1">Acidity</Label>
                <div className="relative">
                  <Input 
                    type="number" 
                    step="0.01" 
                    min="0"
                    max="5"
                    placeholder="0.00" 
                    className="h-16 bg-muted/50 border-input text-[22px] font-extrabold text-center pr-8 text-foreground rounded-xl"
                    value={acidityPercent}
                    onChange={(e) => setAcidityPercent(e.target.value)}
                  />
                  <span className="absolute right-4 top-[18px] text-[16px] font-bold text-muted-foreground">%</span>
                </div>
              </div>
            </div>

            <div className="space-y-4 pt-5 border-t border-border">
              <div className="flex gap-4">
                <div className="flex-1 space-y-2">
                  <Label className="text-[14px] font-bold text-foreground block mb-2 ml-1">Adulteration</Label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={cn(
                        "flex-1 h-14 rounded-xl border-2 flex items-center justify-center text-[15px] font-bold transition-all active:scale-[0.98]",
                        adulterationResult === 'pass' 
                          ? "bg-emerald-50 border-emerald-500 text-emerald-700 shadow-sm" 
                          : "bg-card border-input text-muted-foreground hover:bg-muted"
                      )}
                      onClick={() => setAdulterationResult('pass')}
                    >
                      {adulterationResult === 'pass' && <Check className="w-5 h-5 mr-1" />}
                      PASS
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "flex-1 h-14 rounded-xl border-2 flex items-center justify-center text-[15px] font-bold transition-all active:scale-[0.98]",
                        adulterationResult === 'fail' 
                          ? "bg-rose-50 border-rose-500 text-rose-700 shadow-sm" 
                          : "bg-card border-input text-muted-foreground hover:bg-muted"
                      )}
                      onClick={() => setAdulterationResult('fail')}
                    >
                      {adulterationResult === 'fail' && <XCircle className="w-5 h-5 mr-1" />}
                      FAIL
                    </button>
                  </div>
                </div>

                <div className="flex-1 space-y-2">
                  <Label className="text-[14px] font-bold text-foreground block mb-2 ml-1">Sediment</Label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={cn(
                        "flex-1 h-14 rounded-xl border-2 flex items-center justify-center text-[15px] font-bold transition-all active:scale-[0.98]",
                        sedimentResult === 'pass' 
                          ? "bg-emerald-50 border-emerald-500 text-emerald-700 shadow-sm" 
                          : "bg-card border-input text-muted-foreground hover:bg-muted"
                      )}
                      onClick={() => setSedimentResult('pass')}
                    >
                      {sedimentResult === 'pass' && <Check className="w-5 h-5 mr-1" />}
                      PASS
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "flex-1 h-14 rounded-xl border-2 flex items-center justify-center text-[15px] font-bold transition-all active:scale-[0.98]",
                        sedimentResult === 'fail' 
                          ? "bg-rose-50 border-rose-500 text-rose-700 shadow-sm" 
                          : "bg-card border-input text-muted-foreground hover:bg-muted"
                      )}
                      onClick={() => setSedimentResult('fail')}
                    >
                      {sedimentResult === 'fail' && <XCircle className="w-5 h-5 mr-1" />}
                      FAIL
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Override Toggle */}
          {hasValidReadings && (
            <div className="bg-card rounded-2xl border p-5 shadow-sm space-y-4">
               <div className="flex items-center justify-between">
                  <Label htmlFor="override" className="text-[16px] font-bold cursor-pointer text-foreground">
                    Override System Decision?
                  </Label>
                  <Switch
                    id="override"
                    checked={isOverride}
                    onCheckedChange={(v) => { setIsOverride(v); if(!v) setOverrideReason(''); }}
                    className="data-[state=checked]:bg-primary"
                  />
               </div>
               {isOverride && (
                 <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                   <Textarea 
                     value={overrideReason}
                     onChange={e => setOverrideReason(e.target.value)}
                     placeholder="Explain why you are overriding..."
                     className="bg-muted/50 text-[16px] font-medium p-4 rounded-xl border-input"
                     rows={3}
                     maxLength={500}
                   />
                 </div>
               )}
            </div>
          )}

          {/* Rejection Evidence Box */}
          {hasValidReadings && requiresEvidence && (
            <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-5 shadow-sm animate-in fade-in slide-in-from-bottom-2">
              <h3 className="text-[18px] font-extrabold text-rose-900 mb-2 flex items-center">
                <AlertTriangle className="w-5 h-5 mr-2" />
                Evidence Required
              </h3>
              <p className="text-[14px] text-rose-700 font-medium mb-5 leading-relaxed">
                You must provide a sensory note or a photo to justify rejecting this can.
              </p>

              <div className="flex gap-3 mb-4">
                <button
                  type="button"
                  onClick={() => setEvidenceType('sensory')}
                  className={cn(
                    "flex-1 h-14 rounded-xl border-2 flex items-center justify-center text-[15px] font-bold transition-all active:scale-[0.98]",
                    evidenceType === 'sensory'
                      ? "bg-card border-rose-500 text-rose-700 shadow-sm"
                      : "bg-card border-rose-200 text-rose-600/70 hover:bg-rose-100/50"
                  )}
                >
                  <FileText className="w-5 h-5 mr-2" />
                  Sensory Note
                </button>
                <button
                  type="button"
                  onClick={() => setEvidenceType('photo')}
                  className={cn(
                    "flex-1 h-14 rounded-xl border-2 flex items-center justify-center text-[15px] font-bold transition-all active:scale-[0.98]",
                    evidenceType === 'photo'
                      ? "bg-card border-rose-500 text-rose-700 shadow-sm"
                      : "bg-card border-rose-200 text-rose-600/70 hover:bg-rose-100/50"
                  )}
                >
                  <Camera className="w-5 h-5 mr-2" />
                  Photo
                </button>
              </div>

              {evidenceType === 'sensory' && (
                <Textarea
                  value={sensoryNote}
                  onChange={(e) => setSensoryNote(e.target.value)}
                  placeholder="Describe smell, color, taste, etc."
                  className="bg-card border-rose-200 text-[16px] font-medium p-4 rounded-xl focus-visible:ring-rose-500"
                  rows={3}
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
                      className="w-full h-14 rounded-xl border-2 border-rose-200 text-rose-700 font-bold hover:bg-rose-100 hover:text-rose-900 text-[16px]"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Camera className="w-5 h-5 mr-2" />
                      Take / Choose Photo
                    </Button>
                  ) : (
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photoDataUrl} alt="Evidence" className="w-full max-h-48 object-cover rounded-xl border-2 border-rose-200" />
                      <Button
                        type="button"
                        variant="destructive"
                        className="absolute top-2 right-2 rounded-lg font-bold"
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
            "rounded-2xl p-5 flex items-start gap-4 mt-6 border-2 transition-colors",
            !hasValidReadings
              ? "bg-slate-100 border-slate-200 text-slate-500"
              : isOverride
                ? "bg-amber-100 border-amber-400 text-amber-900"
                : finalDecision === 'accepted'
                  ? "bg-emerald-100 border-emerald-500 text-emerald-900"
                  : "bg-rose-100 border-rose-500 text-rose-900"
          )}>
            {!hasValidReadings ? (
              <AlertTriangle className="w-7 h-7 shrink-0 mt-0.5 opacity-50" />
            ) : isOverride ? (
              <AlertTriangle className="w-7 h-7 shrink-0 mt-0.5 text-amber-600" />
            ) : finalDecision === 'accepted' ? (
              <CheckCircle2 className="w-7 h-7 shrink-0 mt-0.5 text-emerald-600" />
            ) : (
              <XCircle className="w-7 h-7 shrink-0 mt-0.5 text-rose-600" />
            )}
            
            <div className="flex-1">
              <p className="text-[18px] font-extrabold tracking-tight">
                {!hasValidReadings 
                  ? "Waiting for readings" 
                  : isOverride 
                    ? `OVERRIDDEN: ${finalDecision.toUpperCase()}`
                    : finalDecision === 'accepted' ? "✓ ACCEPTED" : "✕ REJECTED"}
              </p>
              <p className="text-[15px] font-medium opacity-90 leading-snug mt-1">
                {!hasValidReadings
                  ? "Complete all fields to see the live grade."
                  : evaluation.reasonCodes.length > 0 
                    ? evaluation.reasonCodes.filter(c => !c.startsWith('INVALID_')).map(code => REASON_LABELS[code] || code).join(', ')
                    : "All recorded measurements are within the configured limits."}
              </p>
            </div>
          </div>

          {submitError && (
            <div className="p-4 bg-rose-50 border-2 border-rose-200 text-rose-800 rounded-xl text-[15px] font-bold flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Submit Button */}
          <Button 
            type="submit" 
            disabled={!isValidSubmit || isSubmitting}
            className={cn(
              "w-full h-16 text-[18px] font-extrabold rounded-2xl mt-4 transition-all active:scale-[0.98]",
              !hasValidReadings 
                ? "bg-slate-200 text-slate-400 cursor-not-allowed" 
                : finalDecision === 'accepted'
                  ? "bg-mcc-dark hover:bg-mcc-dark/90 text-white shadow-md"
                  : "bg-rose-600 hover:bg-rose-700 text-white shadow-md"
            )}
          >
            {isSubmitting ? (
              <><Loader2 className="w-6 h-6 mr-2 animate-spin" /> Processing...</>
            ) : !isValidSubmit ? (
              <><ClipboardList className="w-6 h-6 mr-2" /> Complete Readings</>
            ) : finalDecision === 'accepted' ? (
              <><CheckCircle2 className="w-6 h-6 mr-2" /> RECORD ACCEPTED CAN</>
            ) : (
              <><XCircle className="w-6 h-6 mr-2" /> RECORD REJECTION</>
            )}
          </Button>
          <p className="text-center text-[13px] text-muted-foreground font-medium pb-2">
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
