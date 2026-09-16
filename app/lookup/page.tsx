'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Loader2, AlertCircle, ArrowRight, FilterX, Calendar, WifiOff, CloudOff, CheckCircle2 } from 'lucide-react'
import { format } from 'date-fns'

import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { getPendingEntries } from '@/lib/offlineQueue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
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
            farmer:farmers!inner (name),
            operator:operators (name)
          `)
          .order('test_performed_at', { ascending: false })
          .limit(500)

        if (searchQuery.trim()) {
          const text = searchQuery.trim()
          if (text.toUpperCase().includes('MCC-')) {
            query = query.ilike('reference_code', `%${text.toUpperCase()}%`)
          } else {
            query = query.ilike('farmers.name', `%${text}%`)
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

        const { data, error: dbError } = await query.returns<CanTestWithDetails[]>()
        if (dbError) throw dbError
        remoteRecords = data || []
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
    <div className="min-h-screen bg-slate-50 p-3 sm:p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-4">
        
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Records</h1>
            <p className="text-sm text-slate-500 font-medium">Daily ledger & dispute lookup</p>
          </div>
          <Button variant="outline" onClick={() => router.push('/')}>
            Back to Intake
          </Button>
        </div>

        {/* Search Form */}
        <Card className="shadow-sm border-slate-200">
          <CardContent className="pt-6">
            <form onSubmit={handleSearch} className="space-y-4">
              
              <div className="space-y-1.5">
                <Label htmlFor="search" className="text-xs font-bold uppercase text-slate-500">Farmer Name or Reference</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                  <Input 
                    id="search"
                    placeholder="e.g. Ram or MCC-..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 h-12 text-base bg-slate-50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="startDate" className="text-xs font-bold uppercase text-slate-500">Start Date</Label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input 
                      id="startDate"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="pl-9 h-11 bg-slate-50 text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="endDate" className="text-xs font-bold uppercase text-slate-500">End Date</Label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input 
                      id="endDate"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="pl-9 h-11 bg-slate-50 text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={clearFilters}
                  aria-label="Clear filters"
                  className="h-11 px-4 shrink-0"
                  disabled={!searchQuery && !startDate && !endDate}
                >
                  <FilterX className="h-4 w-4" />
                </Button>
                <Button 
                  type="submit" 
                  className="h-11 flex-1 font-bold"
                  disabled={isSearching}
                >
                  {isSearching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
                  Search
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Results Area */}
        <div className="space-y-4 pb-20">
          
          {error && (
            <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm font-medium flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 shrink-0" />
                {error}
              </div>
              <Button variant="outline" size="sm" onClick={() => handleSearch()} className="bg-white">Retry</Button>
            </div>
          )}

          {isSearching && results.length === 0 && !error && (
            <div className="space-y-3 pt-2">
              <Skeleton className="w-full h-[90px] rounded-xl" />
              <Skeleton className="w-full h-[90px] rounded-xl" />
              <Skeleton className="w-full h-[90px] rounded-xl" />
            </div>
          )}

          {/* Today Summary */}
          {!isSearching && !error && results.length > 0 && (
            <div className="grid grid-cols-4 gap-2 mb-4">
              <div className="bg-white p-2 rounded-xl border shadow-sm flex flex-col items-center justify-center text-center">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Total</span>
                <span className="text-lg sm:text-xl font-black text-slate-900">{totalCans}</span>
              </div>
              <div className="bg-emerald-50 p-2 rounded-xl border border-emerald-100 shadow-sm flex flex-col items-center justify-center text-center">
                <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider mb-0.5">Accepted</span>
                <span className="text-lg sm:text-xl font-black text-emerald-900">{acceptedCans}</span>
              </div>
              <div className="bg-red-50 p-2 rounded-xl border border-red-100 shadow-sm flex flex-col items-center justify-center text-center">
                <span className="text-[10px] font-bold text-red-700 uppercase tracking-wider mb-0.5">Rejected</span>
                <span className="text-lg sm:text-xl font-black text-red-900">{rejectedCans}</span>
              </div>
              <div className="bg-amber-50 p-2 rounded-xl border border-amber-100 shadow-sm flex flex-col items-center justify-center text-center">
                <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-0.5">Pending</span>
                <span className="text-lg sm:text-xl font-black text-amber-900">{pendingCans}</span>
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
            <div className="space-y-2">
              
              {results.map((record) => {
                const date = new Date(record.test_performed_at)
                
                return (
                  <button
                    key={record.id}
                    onClick={() => router.push(`/lookup/${record.reference_code}`)}
                    className="w-full text-left bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-300 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center justify-between group"
                  >
                    <div className="space-y-1.5 flex-1 pr-3">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                         <div className="flex items-center gap-2">
                           <span className="text-sm font-semibold text-slate-500">
                             {format(date, 'HH:mm')}
                           </span>
                           <h3 className="font-bold text-slate-900 text-base line-clamp-1">{record.farmer_name}</h3>
                         </div>
                         <span className="text-[11px] font-mono font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                           {record.reference_code}
                         </span>
                      </div>
                      
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className={cn(
                            "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider",
                            record.decision === 'accepted' ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                          )}>
                            {record.decision}
                          </span>
                          
                          {record.is_override && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider bg-slate-200 text-slate-700">
                              Override
                            </span>
                          )}
                          
                          {record.is_borderline && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider bg-amber-100 text-amber-800">
                              Border
                            </span>
                          )}
                        </div>

                        <div className={cn(
                          "flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider",
                          record.sync_status === 'synced' ? "text-slate-500" : 
                          record.sync_status === 'failed' ? "text-red-700 bg-red-50" : "text-amber-700 bg-amber-50"
                        )}>
                          {record.sync_status === 'synced' ? (
                            <><CheckCircle2 className="w-3 h-3 mr-1"/> Synced</>
                          ) : record.sync_status === 'failed' ? (
                            <><CloudOff className="w-3 h-3 mr-1"/> Sync Failed</>
                          ) : (
                            <><WifiOff className="w-3 h-3 mr-1"/> Pending</>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="shrink-0 text-slate-400 group-hover:text-blue-600 transition-colors">
                      <ArrowRight className="w-5 h-5" />
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}