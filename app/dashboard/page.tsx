'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { format } from 'date-fns'
import Link from 'next/link'
import { AlertCircle, RefreshCw, Loader2, ArrowRight, CheckCircle2, XCircle, AlertTriangle, Scale, Calendar as CalendarIcon, Info } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { getPendingEntries } from '@/lib/offlineQueue'
import { REASON_LABELS } from '@/lib/grading'
import type { CanTestWithDetails } from '@/types/database'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

type DashboardData = {
  totalCans: number
  totalLiters: number
  accepted: number
  rejected: number
  rejectionRate: number
  causes: { label: string; count: number; percentage: number }[]
  recentRecords: CanTestWithDetails[]
  openDisputesCount: number
  disputesError: boolean
  recentDisputes: {
    id: string
    status: string
    submitted_at: string
    resolution_type: string | null
    can_test: {
      reference_code: string
      decision: string
      test_performed_at: string
      farmer: { name: string }
    }
  }[]
  pendingCount: number
  pendingLiters: number
}

export default function DashboardPage() {
  const [selectedDate, setSelectedDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<DashboardData | null>(null)
  const requestRef = useRef(0)

  const fetchData = useCallback(async (dateStr: string) => {
    const currentRequest = ++requestRef.current
    setIsLoading(true)
    setError(null)
    
    try {
      const [year, month, day] = dateStr.split('-').map(Number)
      const start = new Date(year, month - 1, day, 0, 0, 0, 0)
      const end = new Date(year, month - 1, day, 23, 59, 59, 999)

      const startIso = start.toISOString()
      const endIso = end.toISOString()

      // 1. Fetch server totals
      const { data: recordsData, error: recordsError } = await supabase
        .from('can_tests')
        .select(`
          id, reference_code, can_volume, decision, reason_codes, is_borderline, is_override, test_performed_at, farmer_id,
          farmer:farmers!inner (name)
        `)
        .gte('test_performed_at', startIso)
        .lte('test_performed_at', endIso)
        .order('test_performed_at', { ascending: false })

      if (recordsError) throw recordsError

      // 2. Fetch open disputes — best-effort, don't crash dashboard if this fails
      type DisputeRow = {
        id: string; status: string; submitted_at: string; resolution_type: string | null;
        can_test: { reference_code: string; decision: string; test_performed_at: string; farmer: { name: string } }
      }
      let disputesData: DisputeRow[] = []
      let disputesError = false
      try {
        const { data: dData, error: dErr } = await supabase
          .from('disputes')
          .select(`
            id, status, submitted_at, resolution_type,
            can_test:can_tests!inner (
              reference_code, decision, test_performed_at,
              farmer:farmers!inner (name)
            )
          `)
          .eq('status', 'open')
          .order('submitted_at', { ascending: false })
        if (dErr) {
          disputesError = true
        } else if (dData) {
          disputesData = dData as DisputeRow[]
        }
      } catch {
        disputesError = true
      }

      // 3. Fetch local pending
      const pending = await getPendingEntries()
      const pendingForDate = pending.filter(entry => {
        if (entry.syncStatus === 'failed') return false
        const entryDate = new Date(entry.testPerformedAt)
        return entryDate >= start && entryDate <= end
      })

      // Calculate Metrics
      const totalCans = recordsData?.length || 0
      const totalLiters = recordsData?.reduce((acc, r) => acc + (r.can_volume || 0), 0) || 0
      const accepted = recordsData?.filter(r => r.decision === 'accepted').length || 0
      const rejected = recordsData?.filter(r => r.decision === 'rejected').length || 0
      const rejectionRate = totalCans > 0 ? (rejected / totalCans) * 100 : 0

      // Rejection Causes
      const causeCounts: Record<string, number> = {}
      recordsData?.forEach(r => {
        if (r.decision === 'rejected' && r.reason_codes && Array.isArray(r.reason_codes)) {
          r.reason_codes.forEach(code => {
            const strCode = String(code)
            causeCounts[strCode] = (causeCounts[strCode] || 0) + 1
          })
        }
      })

      const causes = Object.entries(causeCounts)
        .map(([code, count]) => ({
          label: REASON_LABELS[code as keyof typeof REASON_LABELS] || code,
          count,
          percentage: rejected > 0 ? (count / rejected) * 100 : 0
        }))
        .sort((a, b) => b.count - a.count)

      // Pending metrics
      const pendingLiters = pendingForDate.reduce((acc, r) => acc + (r.canVolume || 0), 0)

      if (currentRequest !== requestRef.current) return
      
      setData({
        totalCans,
        totalLiters,
        accepted,
        rejected,
        rejectionRate,
        causes,
        recentRecords: (recordsData?.slice(0, 5) || []) as unknown as CanTestWithDetails[],
        openDisputesCount: disputesData?.length || 0,
        recentDisputes: disputesData?.slice(0, 3) || [],
        disputesError,
        pendingCount: pendingForDate.length,
        pendingLiters
      })
    } catch (err: unknown) {
      if (currentRequest !== requestRef.current) return
      console.error('Dashboard fetch error:', err)
      setError('Failed to load dashboard data. Please check connection.')
    } finally {
      if (currentRequest === requestRef.current) {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    fetchData(selectedDate)
  }, [fetchData, selectedDate])

  return (
    <div className="w-full bg-background">
      <div className="max-w-2xl mx-auto px-3 py-4 sm:px-6 sm:py-6 space-y-5">
        
        {/* Header & Date Scope */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-black text-foreground tracking-tight">Daily Summary</h1>
          <div className="flex items-center gap-2 bg-card border-2 border-input rounded-xl px-2 h-10 shadow-sm focus-within:ring-2 focus-within:ring-primary focus-within:border-primary">
            <CalendarIcon className="w-5 h-5 text-muted-foreground ml-1" />
            <Input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="h-8 w-[140px] text-[15px] font-bold border-0 bg-transparent focus-visible:ring-0 shadow-none p-0 px-1"
              max={format(new Date(), 'yyyy-MM-dd')}
            />
          </div>
        </div>

        {error ? (
          <div className="bg-rose-50 text-rose-700 p-4 rounded-xl border-2 border-rose-200 flex flex-col items-center justify-center space-y-3 font-bold">
            <AlertCircle className="w-8 h-8" />
            <p className="text-[15px] text-center">{error}</p>
            <Button onClick={() => fetchData(selectedDate)} variant="outline" className="bg-card border-2 border-rose-200 hover:bg-rose-100 text-rose-800">
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry
            </Button>
          </div>
        ) : isLoading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : !data ? null : (
          <>
            {/* Local Pending Warning */}
            {data.pendingCount > 0 && (
              <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4 flex items-start gap-4 shadow-sm">
                <AlertTriangle className="w-6 h-6 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <h3 className="text-[16px] font-black text-amber-900 tracking-tight">Local Pending</h3>
                  <p className="text-[13px] font-bold text-amber-700 mt-1">
                    {data.pendingCount} {data.pendingCount === 1 ? 'entry' : 'entries'} ({data.pendingLiters} L) awaiting sync to server totals.
                  </p>
                </div>
              </div>
            )}

            {/* Empty State */}
            {data.totalCans === 0 ? (
              <div className="bg-card rounded-2xl border-2 border-dashed border-input p-8 text-center mb-6">
                <div className="bg-muted w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Info className="w-7 h-7 text-muted-foreground" />
                </div>
                <h3 className="font-black text-[18px] text-foreground tracking-tight">No records found</h3>
                <p className="text-[14px] font-bold text-muted-foreground mt-1">
                  No milk tests were recorded on this date.
                </p>
              </div>
            ) : (
              <div className="space-y-6 mb-6">
                
                {/* Primary Metrics Grid */}
                <div>
                  <h2 className="text-[13px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Server Totals</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-card rounded-2xl border-2 border-input p-5 shadow-sm flex flex-col">
                      <span className="text-[12px] text-muted-foreground font-bold uppercase tracking-widest">Liters Collected</span>
                      <span className="text-[28px] font-black text-foreground mt-1 tracking-tighter">{data.totalLiters}</span>
                    </div>
                    <div className="bg-card rounded-2xl border-2 border-input p-5 shadow-sm flex flex-col">
                      <span className="text-[12px] text-muted-foreground font-bold uppercase tracking-widest">Total Cans</span>
                      <span className="text-[28px] font-black text-foreground mt-1 tracking-tighter">{data.totalCans}</span>
                    </div>
                    <div className="bg-emerald-50 rounded-2xl border-2 border-emerald-200 p-5 shadow-sm flex flex-col">
                      <span className="text-[12px] text-emerald-700 font-black uppercase tracking-widest flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" />
                        Accepted
                      </span>
                      <span className="text-[28px] font-black text-emerald-800 mt-1 tracking-tighter">{data.accepted}</span>
                    </div>
                    <div className="bg-rose-50 rounded-2xl border-2 border-rose-200 p-5 shadow-sm flex flex-col">
                      <span className="text-[12px] text-rose-700 font-black uppercase tracking-widest flex items-center gap-1.5">
                        <XCircle className="w-4 h-4" />
                        Rejected
                      </span>
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-[28px] font-black text-rose-800 tracking-tighter">{data.rejected}</span>
                        <span className="text-[14px] font-bold text-rose-600">
                          ({data.rejectionRate.toFixed(1)}%)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Rejection Causes */}
                {data.rejected > 0 && (
                  <div>
                    <h2 className="text-[13px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Rejection Causes</h2>
                    <div className="bg-card rounded-2xl border-2 border-input overflow-hidden shadow-sm">
                      {data.causes.length > 0 ? (
                        <div className="divide-y-2 divide-border">
                          {data.causes.map((cause, idx) => (
                            <div key={idx} className="p-4 px-5 flex items-center justify-between">
                              <span className="text-[15px] font-black text-foreground">{cause.label}</span>
                              <div className="flex items-center gap-3">
                                <span className="text-[16px] font-black text-foreground">{cause.count}</span>
                                <span className="text-[13px] font-bold text-muted-foreground w-8 text-right">{cause.percentage.toFixed(0)}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-5 text-center text-[14px] font-bold text-muted-foreground">
                          No specific rejection reasons recorded.
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] font-bold text-muted-foreground mt-2 px-2">
                      * Multiple causes may occur per can.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Open Disputes */}
            <div className="mb-8">
              <h2 className="text-[13px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Open Disputes</h2>
                  <Link href="/disputes" className="block bg-card rounded-2xl border-2 border-input shadow-sm overflow-hidden hover:border-primary active:scale-[0.99] transition-all">
                    <div className="p-5 flex items-center justify-between border-b-2 border-border">
                      <div className="flex items-center gap-2 text-primary">
                        <Scale className="w-6 h-6" />
                        <span className="font-black text-[16px] tracking-tight">Operator Queue</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {data.disputesError ? (
                          <span className="text-[14px] font-bold text-rose-500">Unavailable</span>
                        ) : data.openDisputesCount > 0 ? (
                          <span className="bg-amber-100 border border-amber-200 text-amber-800 text-[12px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider">
                            {data.openDisputesCount} Action Required
                          </span>
                        ) : (
                          <span className="text-[14px] font-bold text-muted-foreground">0 Open</span>
                        )}
                        <ArrowRight className="w-5 h-5 text-muted-foreground" />
                      </div>
                    </div>
                    {data.recentDisputes.length > 0 && (
                      <div className="bg-muted/50 px-5 py-4 divide-y-2 divide-border">
                        {data.recentDisputes.map(d => (
                          <div key={d.id} className="py-3 flex justify-between items-start first:pt-0 last:pb-0">
                            <div>
                              <div className="text-[15px] font-black text-foreground tracking-tight">{d.can_test?.farmer?.name || 'Unknown Farmer'}</div>
                              <div className="text-[12px] font-mono font-bold text-muted-foreground mt-0.5">{d.can_test?.reference_code}</div>
                            </div>
                            <span className="text-[12px] font-bold text-muted-foreground mt-0.5">
                              {format(new Date(d.submitted_at), 'HH:mm')}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Link>
                </div>

                {/* Today's Records (Compact) */}
                {data.totalCans > 0 && (
                  <div>
                    <div className="flex justify-between items-center mb-3">
                    <h2 className="text-[13px] font-bold text-muted-foreground uppercase tracking-widest">Recent Activity</h2>
                    <Link href={`/lookup?startDate=${selectedDate}&endDate=${selectedDate}`} className="text-[13px] font-black text-primary flex items-center hover:underline uppercase tracking-widest">
                      View All
                      <ArrowRight className="w-4 h-4 ml-1" />
                    </Link>
                  </div>
                  <div className="bg-card rounded-2xl border-2 border-input shadow-sm overflow-hidden divide-y-2 divide-border">
                    {data.recentRecords.map(r => (
                      <Link 
                        key={r.id} 
                        href={`/lookup/${r.reference_code}`}
                        className="flex items-center justify-between p-4 px-5 hover:bg-muted active:scale-[0.99] transition-all block"
                      >
                        <div>
                          <div className="text-[16px] font-black text-foreground tracking-tight">
                            {r.farmer?.name || 'Unknown Farmer'}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[12px] font-mono font-bold text-muted-foreground">
                              {r.reference_code}
                            </span>
                            <span className="text-[12px] font-bold text-muted-foreground/50">•</span>
                            <span className="text-[12px] font-bold text-muted-foreground">
                              {format(new Date(r.test_performed_at), 'HH:mm')}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {r.is_override && (
                            <span className="bg-amber-100 text-amber-800 text-[10px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest">OVERRIDE</span>
                          )}
                          {r.is_borderline && (
                            <span className="bg-amber-100 text-amber-800 text-[10px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest">BORDERLINE</span>
                          )}
                          {r.decision === 'accepted' ? (
                            <div className="bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-md text-[11px] font-black flex items-center gap-1.5 uppercase tracking-widest">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              ACCEPT
                            </div>
                          ) : (
                            <div className="bg-rose-100 text-rose-800 px-2.5 py-1 rounded-md text-[11px] font-black flex items-center gap-1.5 uppercase tracking-widest">
                              <XCircle className="w-3.5 h-3.5" />
                              REJECT
                            </div>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

          </>
        )}
      </div>
    </div>
  )
}
