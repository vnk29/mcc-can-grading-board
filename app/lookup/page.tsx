'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Loader2, AlertCircle, ArrowRight, FilterX, Calendar } from 'lucide-react'
import { format } from 'date-fns'

import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { CanTestWithDetails } from '@/types/database'
import { cn } from '@/lib/utils'

export default function LookupSearchPage() {
  const router = useRouter()
  
  const [searchQuery, setSearchQuery] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [results, setResults] = useState<CanTestWithDetails[]>([])
  const [error, setError] = useState<string | null>(null)

  // Clear results if all filters are cleared
  useEffect(() => {
    if (!searchQuery && !startDate && !endDate) {
      setResults([])
      setHasSearched(false)
      setError(null)
    }
  }, [searchQuery, startDate, endDate])

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    
    // Require at least one filter
    if (!searchQuery.trim() && !startDate && !endDate) {
      return
    }

    setIsSearching(true)
    setError(null)
    setHasSearched(true)

    try {
      let query = supabase
        .from('can_tests')
        .select(`
          *,
          farmer:farmers!inner (name),
          operator:operators (name)
        `)
        .order('test_performed_at', { ascending: false })
        .limit(50)

      if (searchQuery.trim()) {
        const text = searchQuery.trim()
        // If it looks like a reference code (contains MCC-), search by ref code exactly
        if (text.toUpperCase().includes('MCC-')) {
          query = query.ilike('reference_code', `%${text.toUpperCase()}%`)
        } else {
          // Otherwise search by farmer name using ilike on the joined table
          query = query.ilike('farmers.name', `%${text}%`)
        }
      }

      if (startDate) {
        // Start of day
        const start = new Date(startDate)
        start.setHours(0, 0, 0, 0)
        query = query.gte('test_performed_at', start.toISOString())
      }

      if (endDate) {
        // End of day
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999)
        query = query.lte('test_performed_at', end.toISOString())
      }

      const { data, error: dbError } = await query.returns<CanTestWithDetails[]>()

      if (dbError) throw dbError

      // Data is typed via .returns()
      setResults(data || [])

    } catch (err) {
      console.error('Search error:', err)
      setError('Failed to search records. Please check your connection and try again.')
    } finally {
      setIsSearching(false)
    }
  }

  const clearFilters = () => {
    setSearchQuery('')
    setStartDate('')
    setEndDate('')
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dispute Resolution</h1>
            <p className="text-sm text-slate-500 font-medium">Search immutable test records</p>
          </div>
          <Button variant="outline" onClick={() => router.push('/')}>
            Back to Intake
          </Button>
        </div>

        {/* Search Form */}
        <Card className="shadow-sm border-slate-200">
          <CardHeader className="pb-4">
            <CardTitle>Search Records</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSearch} className="space-y-4">
              
              <div className="space-y-1.5">
                <Label htmlFor="search" className="text-sm font-semibold">Farmer Name or Reference Code</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                  <Input 
                    id="search"
                    placeholder="e.g. Ram or MCC-..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 h-14 text-lg bg-slate-50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="startDate" className="text-sm font-semibold">Start Date</Label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input 
                      id="startDate"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="pl-9 h-12 bg-slate-50"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="endDate" className="text-sm font-semibold">End Date</Label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input 
                      id="endDate"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="pl-9 h-12 bg-slate-50"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={clearFilters}
                  aria-label="Clear filters"
                  className="h-12 px-4 shrink-0"
                  disabled={!searchQuery && !startDate && !endDate}
                >
                  <FilterX className="h-5 w-5" />
                </Button>
                <Button 
                  type="submit" 
                  className="h-12 flex-1 text-lg font-bold"
                  disabled={isSearching || (!searchQuery && !startDate && !endDate)}
                >
                  {isSearching ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Search className="h-5 w-5 mr-2" />}
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

          {isSearching && !results.length && (
            <div className="space-y-4 pt-2">
              <Skeleton className="w-full h-[104px] rounded-xl" />
              <Skeleton className="w-full h-[104px] rounded-xl" />
              <Skeleton className="w-full h-[104px] rounded-xl" />
            </div>
          )}

          {!hasSearched && !isSearching && !error && (
            <div className="py-12 flex flex-col items-center justify-center text-slate-400 bg-white rounded-xl border border-dashed border-slate-200">
               <Search className="w-10 h-10 mb-3 opacity-20" />
               <p className="font-semibold text-lg text-slate-600">Search for records</p>
               <p className="text-sm">Enter a farmer name, reference code, or date range.</p>
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
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider px-1">
                Showing {results.length} result{results.length !== 1 ? 's' : ''}
              </p>
              
              {results.map((record) => {
                const date = new Date(record.test_performed_at)
                
                return (
                  <button
                    key={record.id}
                    onClick={() => router.push(`/lookup/${record.reference_code}`)}
                    className="w-full text-left bg-white p-4 sm:p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-300 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center justify-between group"
                  >
                    <div className="space-y-1.5 flex-1 pr-4">
                      <div className="flex items-center justify-between sm:justify-start gap-3">
                         <h3 className="font-bold text-slate-900 text-lg line-clamp-1">{record.farmer?.name || 'Unknown Farmer'}</h3>
                         <span className="text-xs font-mono font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded shrink-0">
                           {record.reference_code}
                         </span>
                      </div>
                      
                      <div className="flex items-center text-sm text-slate-600 font-medium">
                        {format(date, 'MMM d, yyyy • h:mm a')}
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <span className={cn(
                          "text-xs font-bold px-2 py-0.5 rounded-sm uppercase tracking-wider",
                          record.decision === 'accepted' ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                        )}>
                          {record.decision}
                        </span>
                        
                        {record.is_override && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-sm uppercase tracking-wider bg-slate-200 text-slate-700">
                            Override
                          </span>
                        )}
                        
                        {record.is_borderline && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-sm uppercase tracking-wider bg-amber-100 text-amber-800 flex items-center">
                            Borderline
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <div className="shrink-0 text-slate-400 group-hover:text-blue-600 transition-colors">
                      <ArrowRight className="w-6 h-6" />
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