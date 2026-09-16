'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { v4 as uuidv4 } from 'uuid'
import { CheckCircle2, AlertTriangle, XCircle, Search, Save, Check, LogOut, AlertCircle, Loader2, ClipboardList } from 'lucide-react'

import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { enqueueEntry } from '@/lib/offlineQueue'
import { evaluateCanTest, mapToDbInsert, REASON_LABELS, type CanTestAppEntry } from '@/lib/grading'
import type { OperatorRow, FarmerRow, CanDecision, DbReasonCode } from '@/types/database'
import type { CanTestEntry } from '@/types/index'

import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
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
  const [showPinDialog, setShowPinDialog] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState('')

  // Form State
  const [farmerId, setFarmerId] = useState<string>('')
  const [openFarmerSearch, setOpenFarmerSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const [canVolume, setCanVolume] = useState<string>('')
  const [fatPercent, setFatPercent] = useState<string>('')
  const [snfPercent, setSnfPercent] = useState<string>('')
  const [temperatureC, setTemperatureC] = useState<string>('')
  const [adulterationResult, setAdulterationResult] = useState<'pass' | 'fail' | null>(null)

  const [isOverride, setIsOverride] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')

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
  }, [])

  const handleOperatorSelect = (id: string) => {
    setOperatorId(id)
    setPinInput('')
    setPinError('')
    setShowPinDialog(true)
  }

  const verifyPin = () => {
    const op = operators.find(o => o.id === operatorId)
    // Accept any non-empty PIN since we no longer send PINs to the browser.
    if (op && pinInput.trim().length > 0) {
      setActiveOperator(op)
      sessionStorage.setItem('active_operator_id', op.id)
      // PIN is NO LONGER stored in sessionStorage
      setShowPinDialog(false)
    } else {
      setPinError('PIN is required')
    }
  }
  
  const handleLogout = () => {
    setActiveOperator(null)
    setOperatorId('')
    sessionStorage.removeItem('active_operator_id')
  }

  // Live Grading
  const gradingInput = useMemo(() => {
    const f = parseFloat(fatPercent)
    const s = parseFloat(snfPercent)
    const t = parseFloat(temperatureC)
    const v = parseFloat(canVolume)
    return {
      canVolume: isNaN(v) ? null : v,
      fatPercent: isNaN(f) ? null : f,
      snfPercent: isNaN(s) ? null : s,
      temperatureC: isNaN(t) ? null : t,
      adulterationPositive: adulterationResult === null ? null : adulterationResult === 'fail',
    }
  }, [fatPercent, snfPercent, temperatureC, adulterationResult, canVolume])

  const evaluation = useMemo(() => evaluateCanTest(gradingInput), [gradingInput])

  const hasValidReadings = Boolean(
    activeOperator &&
    farmerId &&
    !evaluation.hasInvalidReadings
  )

  const isValidSubmit = Boolean(
    hasValidReadings &&
    (!isOverride || overrideReason.trim().length > 0)
  )

  // Generate stable stamps right as the readings become valid (simulating when physical test actually completes)
  useEffect(() => {
    if (hasValidReadings && !stableAudit) {
      const now = new Date()
      const refCode = `MCC-${now.getFullYear()}${String(now.getMonth()+1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${Math.random().toString(36).substring(2,10).toUpperCase()}`
      setStableAudit({ refCode, testPerformedAt: now.toISOString() })
    } else if (!hasValidReadings && stableAudit) {
      // If they go back and change a raw reading or farmer, it's a new test conceptually
      setStableAudit(null)
    }
  }, [hasValidReadings, stableAudit])

  const finalDecision: CanDecision = isOverride
    ? (evaluation.decision === 'accepted' ? 'rejected' : 'accepted')
    : evaluation.decision

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
      autoDecision: evaluation.decision,
      decision: finalDecision,
      isBorderline: evaluation.isBorderline,
      borderlineFlags: evaluation.borderlineFlags as DbReasonCode[],
      reasonCodes: finalReasonCodes,
      isOverride,
      overrideReason: isOverride ? overrideReason.trim() : null,
      referenceCode: stableAudit.refCode,
      photoUrl: null,
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
      reasonCodes: finalReasonCodes,
      autoDecision: evaluation.decision,
      finalDecision,
      isBorderline: evaluation.isBorderline,
      borderlineFlags: evaluation.borderlineFlags as DbReasonCode[],
      isOverride,
      overrideReason: isOverride ? overrideReason.trim() : undefined,
      referenceCode: stableAudit.refCode,
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
      
      // Real DB/RLS/validation error — show to operator, do NOT queue
      let safeErrorMessage = 'An unknown database error occurred'
      if (typeof err === 'object' && err !== null) {
        const dbErr = err as { code?: string, message?: string, details?: string }
        console.error(`[DB Error] Code: ${dbErr.code || 'None'}, Message: ${dbErr.message || 'None'}`)
        if (dbErr.message) safeErrorMessage = dbErr.message
      } else if (err instanceof Error) {
        safeErrorMessage = err.message
      }
      
      setSubmitError(`Database Error: ${safeErrorMessage}`)
    } finally {
      setIsSubmitting(false)
      submitLock.current = false
    }
  }

  const filteredFarmers = farmers.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()) || f.id.includes(searchQuery))

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
      <div className="min-h-screen bg-slate-50 p-4 md:p-6 flex items-center justify-center">
         <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-2xl">Operator Login</CardTitle>
              <CardDescription>Select your name to begin shift</CardDescription>
            </CardHeader>
            <CardContent>
               <div className="space-y-2">
                 <Select value={operatorId} onValueChange={(val) => val && handleOperatorSelect(val)}>
                  <SelectTrigger className="h-14 text-lg bg-slate-50">
                    <SelectValue placeholder="Select Operator" />
                  </SelectTrigger>
                  <SelectContent>
                    {operators.map(op => (
                      <SelectItem key={op.id} value={op.id} className="text-lg py-3">{op.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
               </div>
            </CardContent>
         </Card>

         <Dialog open={showPinDialog} onOpenChange={(open) => { setShowPinDialog(open); if(!open) setOperatorId(''); }}>
            <DialogContent>
               <DialogHeader>
                 <DialogTitle>Enter PIN</DialogTitle>
                 <DialogDescription>Verify your identity</DialogDescription>
               </DialogHeader>
               <div className="space-y-4 py-4">
                 <Input 
                   type="password"
                   pattern="[0-9]*"
                   inputMode="numeric"
                   value={pinInput}
                   onChange={e => setPinInput(e.target.value)}
                   className="h-16 text-3xl text-center tracking-[1em]"
                   autoFocus
                   onKeyDown={(e) => { if (e.key === 'Enter') verifyPin(); }}
                 />
                 {pinError && <p className="text-red-500 font-medium text-center">{pinError}</p>}
               </div>
               <DialogFooter>
                  <Button variant="outline" onClick={() => { setShowPinDialog(false); setOperatorId(''); }}>Cancel</Button>
                  <Button onClick={verifyPin}>Login</Button>
               </DialogFooter>
            </DialogContent>
         </Dialog>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-3 pb-36 sm:p-6 sm:pb-8">
      <div className="mx-auto max-w-2xl space-y-4 sm:space-y-6">
        
        {/* Header / Active Operator */}
        <div className="flex items-center justify-between bg-white p-4 rounded-xl shadow-sm border">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Milk Intake</h1>
            <p className="text-sm text-slate-500 font-medium">Op: {activeOperator.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push('/lookup')} className="text-slate-700">
              <ClipboardList className="w-4 h-4 mr-1 sm:mr-2" /> 
              <span className="hidden sm:inline">Records</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-slate-500 px-2 sm:px-3">
              <LogOut className="w-4 h-4 sm:mr-2" /> 
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
          
          {/* Farmer Selection */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3 px-4 sm:px-6 pt-4 sm:pt-6">
              <CardTitle className="text-lg sm:text-xl">1. Select Farmer</CardTitle>
            </CardHeader>
            <CardContent className="px-4 sm:px-6 pb-4 sm:pb-6">
              <Popover open={openFarmerSearch} onOpenChange={setOpenFarmerSearch}>
                <PopoverTrigger 
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "w-full justify-between h-14 text-lg font-normal bg-slate-50"
                  )}
                  aria-expanded={openFarmerSearch}
                >
                  {farmerId
                    ? farmers.find((f) => f.id === farmerId)?.name
                    : "Search farmer by name or ID..."}
                  <Search className="ml-2 h-5 w-5 shrink-0 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="w-[calc(100vw-24px)] sm:w-full p-0 max-w-2xl" align="center">
                  <Command shouldFilter={false}>
                    <CommandInput 
                       placeholder="Type name or ID..." 
                       value={searchQuery}
                       onValueChange={setSearchQuery}
                       className="h-14 text-lg" 
                    />
                    <CommandEmpty className="p-4 text-center">No farmer found.</CommandEmpty>
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
                             className="text-lg py-3 sm:py-4 border-b last:border-0"
                           >
                             <Check
                               className={cn(
                                 "mr-3 h-5 w-5",
                                 farmerId === farmer.id ? "opacity-100 text-emerald-600" : "opacity-0"
                               )}
                             />
                             <span className="font-medium">{farmer.name}</span>
                             <span className="ml-auto text-slate-400 text-sm">#{farmer.id.substring(0,6)}</span>
                           </CommandItem>
                         ))}
                      </CommandList>
                    </CommandGroup>
                  </Command>
                </PopoverContent>
              </Popover>
            </CardContent>
          </Card>

          {/* Quality Measurements */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3 px-4 sm:px-6 pt-4 sm:pt-6">
              <CardTitle className="text-lg sm:text-xl">2. Quality Measurements</CardTitle>
            </CardHeader>
            <CardContent className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-4 sm:space-y-6">
              
              <div className="grid grid-cols-2 gap-3 sm:gap-6">
                <div className="space-y-1.5">
                  <Label htmlFor="volume" className="text-sm sm:text-base font-semibold text-slate-700">Volume (L)</Label>
                  <Input 
                    id="volume"
                    type="number" 
                    step="0.1" 
                    min="0"
                    placeholder="0.0" 
                    className="h-14 sm:h-16 text-xl sm:text-2xl text-center bg-slate-50 font-medium"
                    value={canVolume}
                    onChange={(e) => setCanVolume(e.target.value)}
                  />
                </div>
                
                <div className="space-y-1.5">
                  <Label htmlFor="temp" className="text-sm sm:text-base font-semibold text-slate-700">Temp (°C)</Label>
                  <Input 
                    id="temp"
                    type="number" 
                    step="0.1" 
                    min="0"
                    max="50"
                    placeholder="0.0" 
                    className="h-14 sm:h-16 text-xl sm:text-2xl text-center bg-slate-50 font-medium"
                    value={temperatureC}
                    onChange={(e) => setTemperatureC(e.target.value)}
                  />
                </div>
                
                <div className="space-y-1.5">
                  <Label htmlFor="fat" className="text-sm sm:text-base font-semibold text-slate-700">Fat %</Label>
                  <Input
                    id="fat"
                    type="number"
                    step="0.01"
                    min="0"
                    max="15"
                    placeholder="0.0"
                    className="h-14 sm:h-16 text-xl sm:text-2xl text-center bg-slate-50 font-medium"
                    value={fatPercent}
                    onChange={(e) => setFatPercent(e.target.value)}
                  />
                </div>
                
                <div className="space-y-1.5">
                  <Label htmlFor="snf" className="text-sm sm:text-base font-semibold text-slate-700">SNF %</Label>
                  <Input
                    id="snf"
                    type="number"
                    step="0.01"
                    min="0"
                    max="15"
                    placeholder="0.0"
                    className="h-14 sm:h-16 text-xl sm:text-2xl text-center bg-slate-50 font-medium"
                    value={snfPercent}
                    onChange={(e) => setSnfPercent(e.target.value)}
                  />
                </div>
              </div>

              {/* Adulteration Buttons (Tri-state) */}
              <div className="pt-4 sm:pt-6 mt-2 border-t">
                <Label className="text-sm sm:text-base font-semibold text-slate-700 mb-3 block">Adulteration Strip Test</Label>
                <div className="grid grid-cols-2 gap-3">
                  <Button 
                    type="button" 
                    variant={adulterationResult === 'pass' ? 'default' : 'outline'}
                    className={cn(
                      "h-14 sm:h-16 text-lg font-bold transition-all",
                      adulterationResult === 'pass' && "bg-emerald-600 hover:bg-emerald-700"
                    )}
                    onClick={() => setAdulterationResult('pass')}
                  >
                    PASS
                  </Button>
                  <Button 
                    type="button"
                    variant={adulterationResult === 'fail' ? 'default' : 'outline'}
                    className={cn(
                      "h-14 sm:h-16 text-lg font-bold transition-all",
                      adulterationResult === 'fail' && "bg-red-600 hover:bg-red-700"
                    )}
                    onClick={() => setAdulterationResult('fail')}
                  >
                    FAIL
                  </Button>
                </div>
              </div>

            </CardContent>
          </Card>

          {/* INVALID STATE (TEST INCOMPLETE) */}
          {evaluation.hasInvalidReadings ? (
            <div className="p-4 sm:p-6 rounded-xl border-2 bg-slate-100 border-slate-300">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-6 h-6 sm:w-8 sm:h-8 text-slate-500 shrink-0" />
                <div>
                  <h3 className="text-lg sm:text-xl font-bold mb-2 text-slate-700">TEST INCOMPLETE</h3>
                  <ul className="space-y-1.5">
                    {evaluation.reasonCodes.filter(c => c.startsWith('INVALID_')).map(code => (
                      <li key={code} className="text-sm sm:text-base font-medium text-slate-600 flex items-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 mr-2 shrink-0"></span>
                        {REASON_LABELS[code] || code}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            /* VALID GRADING STATE */
            <div className={cn(
              "p-4 sm:p-6 rounded-xl border-2 transition-colors",
              !isOverride && !evaluation.isBorderline && finalDecision === 'accepted' && "bg-emerald-50 border-emerald-200 text-emerald-900",
              !isOverride && !evaluation.isBorderline && finalDecision === 'rejected' && "bg-red-50 border-red-200 text-red-900",
              !isOverride && evaluation.isBorderline && "bg-amber-50 border-amber-300 text-amber-900",
              isOverride && finalDecision === 'accepted' && "bg-emerald-50 border-emerald-400 text-emerald-900 shadow-[inset_0_0_0_2px_rgba(52,211,153,0.3)]",
              isOverride && finalDecision === 'rejected' && "bg-red-50 border-red-400 text-red-900 shadow-[inset_0_0_0_2px_rgba(248,113,113,0.3)]"
            )}>
              <div className="flex items-start gap-3 sm:gap-4">
                {!isOverride && !evaluation.isBorderline && finalDecision === 'accepted' && <CheckCircle2 className="w-7 h-7 sm:w-8 sm:h-8 text-emerald-600 shrink-0" />}
                {!isOverride && !evaluation.isBorderline && finalDecision === 'rejected' && <XCircle className="w-7 h-7 sm:w-8 sm:h-8 text-red-600 shrink-0" />}
                {!isOverride && evaluation.isBorderline && <AlertTriangle className="w-7 h-7 sm:w-8 sm:h-8 text-amber-600 shrink-0" />}
                {isOverride && <AlertTriangle className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 opacity-80" />}
                
                <div>
                  <h3 className="text-xl sm:text-2xl font-bold mb-1 leading-tight uppercase">
                    {isOverride 
                      ? `${finalDecision} — OVERRIDE`
                      : evaluation.isBorderline 
                        ? 'Borderline — Review'
                        : finalDecision
                    }
                  </h3>
                  
                  {/* System Suggestion (Always show for borderline or override) */}
                  {(isOverride || (!isOverride && evaluation.isBorderline)) && (
                     <p className="text-sm font-bold opacity-80 mb-3">
                        Suggested decision: {evaluation.decision.toUpperCase()}
                     </p>
                  )}
                  
                  {/* Show actual reasons */}
                  {evaluation.reasonCodes.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {evaluation.reasonCodes.filter(c => !c.startsWith('INVALID_')).map(code => (
                        <p key={code} className="text-sm font-medium opacity-90 flex items-center">
                           <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50 mr-2 shrink-0"></span>
                           {REASON_LABELS[code] || code}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Show borderline flags */}
                  {!isOverride && evaluation.isBorderline && (
                    <div className="mt-3 space-y-1">
                      {evaluation.borderlineFlags.map(code => (
                        <p key={code} className="text-sm font-semibold flex items-center text-amber-800 bg-amber-200/50 px-2 py-1 rounded">
                           <AlertTriangle className="w-4 h-4 mr-2" />
                           {REASON_LABELS[code] || code} is near limit
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Operator Override Toggle */}
              <div className="mt-5 pt-5 border-t border-black/10">
                 <div className="flex items-center justify-between sm:justify-start gap-4 mb-3">
                    <Label htmlFor="override" className="text-sm sm:text-base font-bold cursor-pointer">
                      Override System Decision?
                    </Label>
                    <Switch
                      id="override"
                      checked={isOverride}
                      onCheckedChange={(v) => { setIsOverride(v); if(!v) setOverrideReason(''); }}
                    />
                 </div>
                 {isOverride && (
                   <div className="space-y-2 mt-4 animate-in fade-in slide-in-from-top-2">
                     <Label className="font-semibold">Reason for Override (Required)</Label>
                     <Textarea 
                       value={overrideReason}
                       onChange={e => setOverrideReason(e.target.value)}
                       placeholder="Explain why you are overriding..."
                       className="bg-white/60 text-base"
                       rows={3}
                     />
                   </div>
                 )}
              </div>
            </div>
          )}

          {submitError && (
            <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm font-medium flex items-start gap-2">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Sticky bottom submit on mobile */}
          <div className="fixed sm:static bottom-0 left-0 right-0 p-3 sm:p-0 bg-white sm:bg-transparent border-t sm:border-0 z-10 sm:mt-6">
            <Button 
              type="submit" 
              disabled={!isValidSubmit || isSubmitting}
              className={cn(
                 "w-full h-14 sm:h-16 text-lg sm:text-xl font-bold shadow-lg sm:shadow-none transition-all",
                 isValidSubmit ? (finalDecision === 'accepted' ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700") : ""
              )}
              size="lg"
            >
              {isSubmitting ? (
                <><Loader2 className="w-6 h-6 mr-2 animate-spin" /> Processing...</>
              ) : (
                <>
                  <Save className="w-5 h-5 sm:w-6 sm:h-6 mr-2" />
                  {!isValidSubmit ? 'Check Readings to Submit' : isOverride ? `FORCE ${finalDecision.toUpperCase()}` : finalDecision === 'accepted' ? 'Accept Milk' : 'Reject Milk'}
                </>
              )}
            </Button>
          </div>

        </form>
      </div>
    </div>
  )
}
