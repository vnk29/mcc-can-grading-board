'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { v4 as uuidv4 } from 'uuid'
import { CheckCircle2, AlertTriangle, XCircle, Search, Save, Check } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { enqueueEntry } from '@/lib/offlineQueue'
import { evaluateCanTest, mapToDbInsert, type CanTestAppEntry } from '@/lib/grading'
import type { OperatorRow, FarmerRow, CanDecision, DbReasonCode } from '@/types/database'

import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export default function IntakePage() {
  const router = useRouter()
  
  // Data State
  const [operators, setOperators] = useState<OperatorRow[]>([])
  const [farmers, setFarmers] = useState<FarmerRow[]>([])
  const [isLoadingData, setIsLoadingData] = useState(true)

  // Form State
  const [operatorId, setOperatorId] = useState<string>('')
  const [farmerId, setFarmerId] = useState<string>('')
  const [openFarmerSearch, setOpenFarmerSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const [canVolume, setCanVolume] = useState<string>('')
  const [fatPercent, setFatPercent] = useState<string>('')
  const [snfPercent, setSnfPercent] = useState<string>('')
  const [temperatureC, setTemperatureC] = useState<string>('')
  const [adulterationPositive, setAdulterationPositive] = useState<boolean>(false)

  const [isOverride, setIsOverride] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Load operators, farmers, and saved operator
  useEffect(() => {
    async function loadData() {
      setIsLoadingData(true)
      const [opRes, fmRes] = await Promise.all([
        supabase.from('operators').select('*').order('name'),
        supabase.from('farmers').select('*').order('name')
      ])
      
      const operatorsData = opRes.data as OperatorRow[] | null
      const farmersData = fmRes.data as FarmerRow[] | null

      if (operatorsData) setOperators(operatorsData)
      if (farmersData) setFarmers(farmersData)
      
      const savedOpId = localStorage.getItem('active_operator_id')
      if (savedOpId && operatorsData?.some(o => o.id === savedOpId)) {
        setOperatorId(savedOpId)
      }
      setIsLoadingData(false)
    }
    loadData()
  }, [])

  // Persist operator selection
  useEffect(() => {
    if (operatorId) {
      localStorage.setItem('active_operator_id', operatorId)
    }
  }, [operatorId])

  // Live Grading
  const gradingInput = useMemo(() => {
    const f = parseFloat(fatPercent)
    const s = parseFloat(snfPercent)
    const t = parseFloat(temperatureC)
    return {
      fatPercent: isNaN(f) ? null : f,
      snfPercent: isNaN(s) ? null : s,
      temperatureC: isNaN(t) ? null : t,
      adulterationPositive,
    }
  }, [fatPercent, snfPercent, temperatureC, adulterationPositive])

  const evaluation = useMemo(() => evaluateCanTest(gradingInput), [gradingInput])

  const isValidSubmit = Boolean(
    operatorId &&
    farmerId &&
    canVolume && !isNaN(parseFloat(canVolume)) &&
    !evaluation.hasInvalidReadings &&
    (!isOverride || overrideReason.trim().length > 0)
  )

  const finalDecision: CanDecision = isOverride
    ? (evaluation.decision === 'accepted' ? 'rejected' : 'accepted')
    : evaluation.decision

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValidSubmit) return

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const entryId = uuidv4()
      const now = new Date()
      // e.g. MCC-20260915-A3F2 (pseudo-random part for prototype uniqueness)
      const refCode = `MCC-${now.getFullYear()}${String(now.getMonth()+1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${Math.random().toString(36).substring(2,6).toUpperCase()}`

      const finalReasonCodes = [...evaluation.reasonCodes.filter(c => !c.startsWith('INVALID_'))] as DbReasonCode[]
      if (isOverride) {
        finalReasonCodes.push('OPERATOR_OVERRIDE')
      }

      const appEntry: CanTestAppEntry = {
        id: entryId,
        farmerId,
        operatorId,
        canVolume: parseFloat(canVolume),
        fatPercent: parseFloat(fatPercent),
        snfPercent: parseFloat(snfPercent),
        temperatureC: parseFloat(temperatureC),
        adulterationPositive,
        decision: finalDecision,
        reasonCodes: finalReasonCodes,
        isOverride,
        overrideReason: isOverride ? overrideReason.trim() : null,
        referenceCode: refCode,
        photoUrl: null,
        testPerformedAt: now.toISOString()
      }

      const dbInsert = mapToDbInsert(appEntry)

      // Attempt Supabase insert
      // cast to any to bypass TS inferring 'never' on immutable tables
      const { error } = await supabase.from('can_tests').insert(dbInsert as any)
      
      if (error) {
        // Stage 6 offline prep: if network fails, enqueue locally
        if (error.message.includes('fetch') || error.code === '23505' /* unique constraint */ === false) {
           console.warn('Network error, queueing offline:', error)
           // Create a CanTestEntry (which has some extra UI-friendly fields like names) for the queue
           // For Stage 2, we just ensure it's structured safely.
           const farmerName = farmers.find(f => f.id === farmerId)?.name || 'Unknown'
           const operatorName = operators.find(o => o.id === operatorId)?.name || 'Unknown'
           
           await enqueueEntry({
             ...appEntry,
             overrideReason: appEntry.overrideReason ?? undefined,
             photoUrl: appEntry.photoUrl ?? undefined,
             farmerName,
             operatorName,
             autoDecision: evaluation.decision,
             finalDecision,
             isBorderline: evaluation.isBorderline,
             syncStatus: 'pending'
           })
        } else {
           throw error
        }
      }

      // Success (online or queued)
      // Reset form
      setFarmerId('')
      setCanVolume('')
      setFatPercent('')
      setSnfPercent('')
      setTemperatureC('')
      setAdulterationPositive(false)
      setIsOverride(false)
      setOverrideReason('')
      
      // Navigate to results (fake path for now, adjust as needed in Stage 3/4)
      alert(`Success! Entry saved. Ref: ${refCode}`)
      
    } catch (err: any) {
      console.error(err)
      setSubmitError(err.message || 'An unknown error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Pre-filter farmers for performance if large list
  const filteredFarmers = farmers.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()) || f.id.includes(searchQuery))

  return (
    <div className="min-h-screen bg-slate-50 p-4 pb-24 md:p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        
        {/* Header / Operator Select */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm border">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Milk Intake</h1>
            <p className="text-sm text-slate-500">Can Grading & Analysis</p>
          </div>
          <div className="w-full sm:w-64">
            <Select value={operatorId} onValueChange={(val) => val && setOperatorId(val as string)} disabled={isLoadingData}>
              <SelectTrigger className="h-12 bg-slate-50">
                <SelectValue placeholder="Select Operator" />
              </SelectTrigger>
              <SelectContent>
                {operators.map(op => (
                  <SelectItem key={op.id} value={op.id} className="text-lg py-3">{op.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          
          {/* Farmer Selection */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>1. Select Farmer</CardTitle>
            </CardHeader>
            <CardContent>
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
                <PopoverContent className="w-full p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput 
                       placeholder="Type name or ID..." 
                       value={searchQuery}
                       onValueChange={setSearchQuery}
                       className="h-12 text-lg" 
                    />
                    <CommandEmpty>No farmer found.</CommandEmpty>
                    <CommandGroup className="max-h-[300px] overflow-auto">
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
                             className="text-lg py-3"
                           >
                             <Check
                               className={cn(
                                 "mr-2 h-5 w-5",
                                 farmerId === farmer.id ? "opacity-100" : "opacity-0"
                               )}
                             />
                             {farmer.name} 
                             <span className="ml-2 text-slate-400 text-sm">#{farmer.id.substring(0,8)}</span>
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
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>2. Quality Measurements</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="volume" className="text-base text-slate-600">Volume (Litres)</Label>
                  <Input
                    id="volume"
                    type="number"
                    step="0.1"
                    placeholder="0.0"
                    className="h-16 text-2xl text-center bg-slate-50"
                    value={canVolume}
                    onChange={(e) => setCanVolume(e.target.value)}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="temp" className="text-base text-slate-600">Temperature (°C)</Label>
                  <Input
                    id="temp"
                    type="number"
                    step="0.1"
                    placeholder="0.0"
                    className="h-16 text-2xl text-center bg-slate-50"
                    value={temperatureC}
                    onChange={(e) => setTemperatureC(e.target.value)}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="fat" className="text-base text-slate-600">Fat %</Label>
                  <Input
                    id="fat"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    className="h-16 text-2xl text-center bg-slate-50"
                    value={fatPercent}
                    onChange={(e) => setFatPercent(e.target.value)}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="snf" className="text-base text-slate-600">SNF %</Label>
                  <Input
                    id="snf"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    className="h-16 text-2xl text-center bg-slate-50"
                    value={snfPercent}
                    onChange={(e) => setSnfPercent(e.target.value)}
                  />
                </div>
              </div>

              {/* Adulteration Switch */}
              <div className="pt-4 border-t">
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border">
                  <div>
                    <Label className="text-lg font-medium">Adulteration Test</Label>
                    <p className="text-sm text-slate-500">Strip test result</p>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className={cn("text-lg font-bold", !adulterationPositive ? "text-emerald-600" : "text-slate-400")}>PASS</span>
                    <Switch
                      checked={adulterationPositive}
                      onCheckedChange={setAdulterationPositive}
                      className={cn("data-[state=checked]:bg-red-500 scale-125")}
                    />
                    <span className={cn("text-lg font-bold", adulterationPositive ? "text-red-600" : "text-slate-400")}>FAIL</span>
                  </div>
                </div>
              </div>

            </CardContent>
          </Card>

          {/* Live Grading State */}
          {!evaluation.hasInvalidReadings && (
            <div className={cn(
              "p-6 rounded-xl border-2 transition-colors",
              evaluation.decision === 'accepted' && !evaluation.isBorderline && "bg-emerald-50 border-emerald-200 text-emerald-900",
              evaluation.decision === 'accepted' && evaluation.isBorderline && "bg-amber-50 border-amber-200 text-amber-900",
              evaluation.decision === 'rejected' && "bg-red-50 border-red-200 text-red-900"
            )}>
              <div className="flex items-start gap-4">
                {evaluation.decision === 'accepted' && !evaluation.isBorderline && <CheckCircle2 className="w-8 h-8 text-emerald-600 shrink-0" />}
                {evaluation.decision === 'accepted' && evaluation.isBorderline && <AlertTriangle className="w-8 h-8 text-amber-600 shrink-0" />}
                {evaluation.decision === 'rejected' && <XCircle className="w-8 h-8 text-red-600 shrink-0" />}
                
                <div>
                  <h3 className="text-2xl font-bold mb-1">
                    {evaluation.decision === 'accepted' 
                      ? (evaluation.isBorderline ? 'Borderline — Review' : 'Accepted')
                      : 'Rejected'
                    }
                  </h3>
                  {evaluation.reasonCodes.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {evaluation.reasonCodes.map(code => (
                        <p key={code} className="text-sm font-medium">
                          • {code.replace(/_/g, ' ')}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Operator Override */}
              <div className="mt-6 pt-6 border-t border-black/10">
                 <div className="flex items-center gap-3 mb-4">
                    <Switch
                      id="override"
                      checked={isOverride}
                      onCheckedChange={(v) => { setIsOverride(v); if(!v) setOverrideReason(''); }}
                    />
                    <Label htmlFor="override" className="text-base font-medium">
                      Override automatic decision (force {evaluation.decision === 'accepted' ? 'REJECT' : 'ACCEPT'})
                    </Label>
                 </div>
                 {isOverride && (
                   <div className="space-y-2">
                     <Label>Reason for Override (Required)</Label>
                     <Textarea 
                       value={overrideReason}
                       onChange={e => setOverrideReason(e.target.value)}
                       placeholder="Explain why you are changing the system decision..."
                       className="bg-white/50"
                     />
                   </div>
                 )}
              </div>
            </div>
          )}

          {submitError && (
            <div className="p-4 bg-red-50 text-red-600 rounded-lg text-sm font-medium">
              Error saving: {submitError}
            </div>
          )}

          {/* Submit Button */}
          <Button 
            type="submit" 
            disabled={!isValidSubmit || isSubmitting}
            className="w-full h-16 text-xl"
            size="lg"
          >
            {isSubmitting ? (
              "Saving..."
            ) : (
              <>
                <Save className="w-6 h-6 mr-2" />
                {isOverride ? `Force ${finalDecision.toUpperCase()}` : finalDecision === 'accepted' ? 'Accept Milk' : 'Reject Milk'}
              </>
            )}
          </Button>

        </form>
      </div>
    </div>
  )
}
