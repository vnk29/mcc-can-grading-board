'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Loader2, AlertCircle, FilterX, Calendar, WifiOff, CloudOff, CheckCircle2 } from 'lucide-react'
import { format } from 'date-fns'

import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { getPendingEntries } from '@/lib/offlineQueue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { AddFarmerDialog } from '@/components/AddFarmerDialog'
import type { CanTestWithDetails } from '@/types/database'
import { cn } from '@/lib/utils'

type UnifiedRecord = {
  id: string
  reference_code: string
  farmer_name: string
  test_performed_at: string
  decision: 'accepted' | 'rejected'
  is_override: boolean
  is_borderline: boolean
  sync_status: 'synced' | 'pending' | 'failed'
}

export default function LookupSearchPage() {
  const router = useRouter()
  
  const [searchQuery, setSearchQuery] = useState('')
  // Default to today
  const [startDate, setStartDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  
  const [isSearching, setIsSearching] = useState(true)
  const [hasSearched, setHasSearched] = useState(false)
  const [results, setResults] = useState<UnifiedRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  
  const [isAddFarmerOpen, setIsAddFarmerOpen] = useState(false)

  const handleSearch = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    
    setIsSearching(true)
    setError(null)
    setHasSearched(true)

    try {
      // 1. Fetch remote from Supabase
      let remoteRecords: CanTestWithDetails[] = []
      if (isSupabaseConfigured) {
        let query = supabase
          .from('can_tests')
          .select(`
            *,
            farmer:farmers!inner (name)
          `)
          .order('test_performed_at', { ascending: false })
          .limit(500)

        if (searchQuery.trim()) {
          const text = searchQuery.trim()
          if (text.toUpperCase().includes('MCC-')) {
            query = query.ilike('reference_code', `%${text.toUpperCase()}%`)
          } else {
            query = query.ilike('farmer.name', `%${text}%`)
          }
        }

        if (startDate) {
          const start = new Date(startDate)
          start.setHours(0, 0, 0, 0)
          query = query.gte('test_performed_at', start.toISOString())
        }

        if (endDate) {
          const end = new Date(endDate)
          end.setHours(23, 59, 59, 999)
          query = query.lte('test_performed_at', end.toISOString())
        }

        const { data: dbData, error: dbError } = await query.returns<CanTestWithDetails[]>()
        if (dbError) throw dbError
        
        if (dbData && dbData.length > 0) {
          const { data: opsData } = await supabase.from('operator_profiles').select('id, name')
          if (opsData) {
            dbData.forEach((row: unknown) => {
              const record = row as CanTestWithDetails & { operator_id?: string }
              if (record.operator_id) {
                const op = opsData.find(o => o.id === record.operator_id)
                record.operator = op ? { name: op.name } : { name: 'Unknown' }
              }
            })
          }
        }
        
        remoteRecords = dbData || []
      }

      // 2. Fetch local queue
      const pendingQueue = await getPendingEntries()
      
      // 3. Filter local queue exactly like the remote query
      let filteredLocal = pendingQueue

      if (searchQuery.trim()) {
        const text = searchQuery.trim().toLowerCase()
        filteredLocal = filteredLocal.filter(entry => 
          entry.referenceCode.toLowerCase().includes(text) || 
          entry.farmerName.toLowerCase().includes(text)
        )
      }

      if (startDate) {
        const start = new Date(startDate)
        start.setHours(0, 0, 0, 0)
        filteredLocal = filteredLocal.filter(entry => new Date(entry.testPerformedAt) >= start)
      }
      if (endDate) {
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999)
        filteredLocal = filteredLocal.filter(entry => new Date(entry.testPerformedAt) <= end)
      }

      // 4. Map and merge
      const remoteIds = new Set(remoteRecords.map(r => r.id))
      const remoteRefs = new Set(remoteRecords.map(r => r.reference_code))
      
      const unified: UnifiedRecord[] = []

      // Add local entries that are NOT in remote
      for (const entry of filteredLocal) {
        if (!remoteIds.has(entry.id) && !remoteRefs.has(entry.referenceCode)) {
          unified.push({
            id: entry.id,
            reference_code: entry.referenceCode,
            farmer_name: entry.farmerName,
            test_performed_at: entry.testPerformedAt,
            decision: entry.finalDecision,
            is_override: entry.isOverride,
            is_borderline: entry.isBorderline,
            sync_status: entry.syncStatus === 'failed' ? 'failed' : 'pending'
          })
        }
      }

      // Add remote entries
      for (const record of remoteRecords) {
        unified.push({
            id: record.id,
            reference_code: record.reference_code,
            farmer_name: record.farmer?.name || 'Unknown',
            test_performed_at: record.test_performed_at,
            decision: record.decision as 'accepted' | 'rejected',
            is_override: record.is_override ?? false,
            is_borderline: record.is_borderline ?? false,
            sync_status: 'synced'
        })
      }

      // Sort combined array by test_performed_at desc
      unified.sort((a, b) => new Date(b.test_performed_at).getTime() - new Date(a.test_performed_at).getTime())

      setResults(unified)

    } catch (err) {
      console.error('Search error:', err)
      setError('Failed to load records. Please check your connection and try again.')
    } finally {
      setIsSearching(false)
    }
  }, [searchQuery, startDate, endDate])

  // Initial fetch on mount
  useEffect(() => {
    handleSearch()
  }, [handleSearch])

  const clearFilters = () => {
    setSearchQuery('')
    setStartDate('')
    setEndDate('')
    // After clear, it will rely on the user to hit search, or we could trigger search
    // But since handleSearch is triggered manually for search term changes usually, 
    // we'll just clear the text.
  }

  // Derived summary
  const totalCans = results.length
  const acceptedCans = results.filter(r => r.decision === 'accepted').length
  const rejectedCans = results.filter(r => r.decision === 'rejected').length
  const pendingCans = results.filter(r => r.sync_status === 'pending' || r.sync_status === 'failed').length

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Top Header */}
      <div className="bg-card border-b-2 border-border sticky top-0 z-10 shadow-sm">
        <div className="max-w-xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-[24px] font-black text-foreground tracking-tight">Daily Ledger</h1>
            <p className="text-[14px] text-muted-foreground font-bold uppercase tracking-wider">Today&apos;s Intake</p>
          </div>
          <Button 
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold h-12 px-5 rounded-xl shadow-sm transition-all active:scale-95"
            onClick={() => setIsAddFarmerOpen(true)}
          >
            + Add Farmer
          </Button>
        </div>
      </div>

      <div className="max-w-xl mx-auto p-4 space-y-6">
        {/* Search Form */}
        <Card className="shadow-sm border-2 border-input rounded-2xl overflow-hidden bg-card">
          <CardContent className="p-5">
            <form onSubmit={handleSearch} className="space-y-4">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-6 w-6 text-muted-foreground" />
                <Input 
                  id="search"
                  placeholder="Search by ID or Farmer name..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-12 h-14 text-[16px] font-semibold bg-background border-2 border-input rounded-xl focus-visible:ring-primary focus-visible:ring-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input 
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="pl-10 h-14 bg-background text-[15px] font-bold border-2 border-input rounded-xl focus-visible:ring-primary focus-visible:ring-2"
                  />
                </div>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input 
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="pl-10 h-14 bg-background text-[15px] font-bold border-2 border-input rounded-xl focus-visible:ring-primary focus-visible:ring-2"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={clearFilters}
                  aria-label="Clear filters"
                  className="h-14 px-5 shrink-0 border-2 border-input text-muted-foreground rounded-xl font-bold hover:bg-muted"
                  disabled={!searchQuery && !startDate && !endDate}
                >
                  <FilterX className="h-6 w-6" />
                </Button>
                <Button 
                  type="submit" 
                  className="h-14 flex-1 text-[17px] font-extrabold bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl transition-all active:scale-[0.98]"
                  disabled={isSearching}
                >
                  {isSearching ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Search className="h-5 w-5 mr-2" />}
                  Search
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Results Area */}
        <div className="space-y-4">
          
          {error && (
            <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-xl text-sm font-medium flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 shrink-0" />
                {error}
              </div>
              <Button variant="outline" size="sm" onClick={() => handleSearch()} className="bg-white border-red-200 hover:bg-red-50">Retry</Button>
            </div>
          )}

          {isSearching && results.length === 0 && !error && (
            <div className="space-y-3 pt-2">
              <Skeleton className="w-full h-[140px] rounded-xl" />
              <Skeleton className="w-full h-[140px] rounded-xl" />
              <Skeleton className="w-full h-[140px] rounded-xl" />
            </div>
          )}

          {/* Today Summary */}
          {!isSearching && !error && results.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="bg-card p-3 rounded-2xl border-2 border-input shadow-sm flex flex-col items-center justify-center text-center">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Total</span>
                <span className="text-2xl font-black text-foreground">{totalCans}</span>
              </div>
              <div className="bg-emerald-50 p-3 rounded-2xl border-2 border-emerald-200 shadow-sm flex flex-col items-center justify-center text-center">
                <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-widest mb-1">Accepted</span>
                <span className="text-2xl font-black text-emerald-900">{acceptedCans}</span>
              </div>
              <div className="bg-rose-50 p-3 rounded-2xl border-2 border-rose-200 shadow-sm flex flex-col items-center justify-center text-center">
                <span className="text-[11px] font-bold text-rose-700 uppercase tracking-widest mb-1">Rejected</span>
                <span className="text-2xl font-black text-rose-900">{rejectedCans}</span>
              </div>
              <div className="bg-amber-50 p-3 rounded-2xl border-2 border-amber-200 shadow-sm flex flex-col items-center justify-center text-center">
                <span className="text-[11px] font-bold text-amber-700 uppercase tracking-widest mb-1">Pending</span>
                <span className="text-2xl font-black text-amber-900">{pendingCans}</span>
              </div>
            </div>
          )}

          {hasSearched && !isSearching && !error && results.length === 0 && (
            <div className="py-12 flex flex-col items-center justify-center text-slate-500 bg-white rounded-xl border border-dashed border-slate-300">
               <Search className="w-10 h-10 mb-3 opacity-20" />
               <p className="font-semibold text-lg text-slate-700">No records found</p>
               <p className="text-sm">Try adjusting your filters or date range.</p>
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-4">
              {results.map((record) => {
                const date = new Date(record.test_performed_at)
                const isAccepted = record.decision === 'accepted'
                
                return (
                  <button
                    key={record.id}
                    onClick={() => router.push(`/lookup/${record.reference_code}`)}
                    className="w-full text-left bg-card p-5 rounded-2xl border-2 border-input shadow-sm hover:shadow-md hover:border-primary/40 transition-all focus:outline-none focus:ring-2 focus:ring-primary block relative active:scale-[0.99]"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-[14px] font-bold text-muted-foreground uppercase tracking-widest">
                        CAN ID: <span className="text-foreground font-mono font-black text-[16px]">{record.reference_code}</span>
                      </span>
                      <span className="text-[14px] font-bold text-muted-foreground bg-muted px-2 py-1 rounded-md">
                        {format(date, 'hh:mm a')}
                      </span>
                    </div>

                    <div className="mb-4 border-b-2 border-border pb-4">
                      <p className="text-[18px] font-black text-foreground">
                        Farmer: {record.farmer_name}
                      </p>
                    </div>
                    
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                      <div className="flex gap-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn(
                            "text-[14px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg",
                            isAccepted ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                          )}>
                            {isAccepted ? 'Accepted' : 'Rejected'}
                          </span>
                          
                          {record.is_override && (
                            <span className="text-[11px] font-bold px-2 py-1 rounded uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200">
                              Override
                            </span>
                          )}
                          
                          {record.is_borderline && (
                            <span className="text-[11px] font-bold px-2 py-1 rounded uppercase tracking-wider bg-orange-100 text-orange-800 border border-orange-200">
                              Border
                            </span>
                          )}
                        </div>
                      </div>

                      <div className={cn(
                        "flex items-center text-[12px] font-bold px-3 py-1.5 rounded-lg border",
                        record.sync_status === 'synced' ? "bg-slate-100 text-slate-700 border-slate-200" : 
                        record.sync_status === 'failed' ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"
                      )}>
                        {record.sync_status === 'synced' ? (
                          <><CheckCircle2 className="w-4 h-4 mr-1.5 text-emerald-600"/> Synced</>
                        ) : record.sync_status === 'failed' ? (
                          <><CloudOff className="w-4 h-4 mr-1.5"/> Failed</>
                        ) : (
                          <><WifiOff className="w-4 h-4 mr-1.5"/> Pending</>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
      
      <AddFarmerDialog 
        open={isAddFarmerOpen}
        onOpenChange={setIsAddFarmerOpen}
      />
    </div>
  )
}