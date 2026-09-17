'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { format } from 'date-fns'
import Link from 'next/link'
import { AlertCircle, RefreshCw, Loader2, ArrowRight, CheckCircle2, XCircle, AlertTriangle, Scale, Calendar as CalendarIcon, Info } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { getPendingEntries } from '@/lib/offlineQueue'
import { REASON_LABELS } from '@/lib/grading'
import type { CanTestWithDetails } from '@/types/database'
import { AppHeader } from '@/components/AppHeader'
import { BottomNav } from '@/components/BottomNav'
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

  const fetchData = useCallback(async (dateStr: string) => {
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

      // 2. Fetch open disputes
      // We don't strictly filter open disputes by the date in the UI usually, but the requirements just say "OPEN DISPUTES" - we'll get all of them.
      const { data: disputesData, error: disputesError } = await supabase
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

      if (disputesError) throw disputesError

      // 3. Fetch local pending
      const pending = await getPendingEntries()
      const pendingForDate = pending.filter(entry => {
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
        pendingCount: pendingForDate.length,
        pendingLiters
      })
    } catch (err: unknown) {
      console.error('Dashboard fetch error:', err)
      setError('Failed to load dashboard data. Please check connection.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData(selectedDate)
  }, [fetchData, selectedDate])

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <AppHeader />
      <div className="max-w-md mx-auto p-4 space-y-6">
        
        {/* Header & Date Scope */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-900">Daily Summary</h1>
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-4 h-4 text-slate-500" />
            <Input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="h-8 w-[140px] text-sm"
              max={format(new Date(), 'yyyy-MM-dd')}
            />
          </div>
        </div>

        {error ? (
          <div className="bg-red-50 text-red-700 p-4 rounded-lg flex flex-col items-center justify-center space-y-3">
            <AlertCircle className="w-6 h-6" />
            <p className="text-sm font-medium text-center">{error}</p>
            <Button onClick={() => fetchData(selectedDate)} variant="outline" className="bg-white">
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry
            </Button>
          </div>
        ) : isLoading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="w-8 h-8 text-[#0f6041] animate-spin" />
          </div>
        ) : !data ? null : (
          <>
            {/* Local Pending Warning */}
            {data.pendingCount > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <h3 className="text-sm font-semibold text-amber-800">Local Pending</h3>
                  <p className="text-xs text-amber-700 mt-1">
                    {data.pendingCount} {data.pendingCount === 1 ? 'entry' : 'entries'} ({data.pendingLiters} L) awaiting sync to server totals.
                  </p>
                </div>
              </div>
            )}

            {/* Empty State */}
            {data.totalCans === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-8 text-center shadow-sm mb-6">
                <div className="bg-slate-100 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Info className="w-6 h-6 text-slate-400" />
                </div>
                <h3 className="font-semibold text-slate-900">No records found</h3>
                <p className="text-sm text-slate-500 mt-1">
                  No milk tests were recorded on this date.
                </p>
              </div>
            ) : (
              <div className="space-y-6 mb-6">
                
                {/* Primary Metrics Grid */}
                <div>
                  <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Server Totals</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col">
                      <span className="text-sm text-slate-500 font-medium">Liters Collected</span>
                      <span className="text-2xl font-bold text-slate-900 mt-1">{data.totalLiters}</span>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col">
                      <span className="text-sm text-slate-500 font-medium">Total Cans</span>
                      <span className="text-2xl font-bold text-slate-900 mt-1">{data.totalCans}</span>
                    </div>
                    <div className="bg-emerald-50 rounded-xl border border-emerald-100 p-4 shadow-sm flex flex-col">
                      <span className="text-sm text-emerald-600 font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" />
                        Accepted
                      </span>
                      <span className="text-2xl font-bold text-emerald-700 mt-1">{data.accepted}</span>
                    </div>
                    <div className="bg-red-50 rounded-xl border border-red-100 p-4 shadow-sm flex flex-col">
                      <span className="text-sm text-red-600 font-medium flex items-center gap-1">
                        <XCircle className="w-4 h-4" />
                        Rejected
                      </span>
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-2xl font-bold text-red-700">{data.rejected}</span>
                        <span className="text-sm font-medium text-red-500">
                          ({data.rejectionRate.toFixed(1)}%)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Rejection Causes */}
                {data.rejected > 0 && (
                  <div>
                    <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Rejection Causes</h2>
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                      {data.causes.length > 0 ? (
                        <div className="divide-y divide-slate-100">
                          {data.causes.map((cause, idx) => (
                            <div key={idx} className="p-3 px-4 flex items-center justify-between">
                              <span className="text-sm font-medium text-slate-700">{cause.label}</span>
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-bold text-slate-900">{cause.count}</span>
                                <span className="text-xs font-medium text-slate-400 w-8 text-right">{cause.percentage.toFixed(0)}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-4 text-center text-sm text-slate-500">
                          No specific rejection reasons recorded.
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2 px-1">
                      * Multiple causes may occur per can.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Open Disputes */}
            <div className="mb-6">
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Open Disputes</h2>
                  <Link href="/disputes" className="block bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden hover:border-[#0f6041] transition-colors">
                    <div className="p-4 flex items-center justify-between border-b border-slate-100">
                      <div className="flex items-center gap-2 text-[#0f6041]">
                        <Scale className="w-5 h-5" />
                        <span className="font-semibold text-sm">Operator Queue</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {data.openDisputesCount > 0 ? (
                          <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">
                            {data.openDisputesCount} Action Required
                          </span>
                        ) : (
                          <span className="text-sm font-medium text-slate-400">0 Open</span>
                        )}
                        <ArrowRight className="w-4 h-4 text-slate-400" />
                      </div>
                    </div>
                    {data.recentDisputes.length > 0 && (
                      <div className="bg-slate-50 px-4 py-3 divide-y divide-slate-200/60">
                        {data.recentDisputes.map(d => (
                          <div key={d.id} className="py-2 first:pt-0 last:pb-0 flex justify-between items-start">
                            <div>
                              <div className="text-xs font-semibold text-slate-700">{d.can_test?.farmer?.name || 'Unknown Farmer'}</div>
                              <div className="text-[10px] font-mono text-slate-500">{d.can_test?.reference_code}</div>
                            </div>
                            <span className="text-[10px] text-slate-400">
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
                    <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Recent Activity</h2>
                    <Link href={`/lookup?startDate=${selectedDate}&endDate=${selectedDate}`} className="text-xs font-semibold text-[#0f6041] flex items-center hover:underline">
                      View All
                      <ArrowRight className="w-3 h-3 ml-1" />
                    </Link>
                  </div>
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
                    {data.recentRecords.map(r => (
                      <Link 
                        key={r.id} 
                        href={`/lookup/${r.reference_code}`}
                        className="flex items-center justify-between p-3 px-4 hover:bg-slate-50 active:bg-slate-100 transition-colors block"
                      >
                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            {r.farmer?.name || 'Unknown Farmer'}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] font-mono font-medium text-slate-500">
                              {r.reference_code}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              {format(new Date(r.test_performed_at), 'HH:mm')}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {r.is_override && (
                            <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded">OVERRIDE</span>
                          )}
                          {r.is_borderline && (
                            <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded">BORDERLINE</span>
                          )}
                          {r.decision === 'accepted' ? (
                            <div className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              ACCEPT
                            </div>
                          ) : (
                            <div className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1">
                              <XCircle className="w-3 h-3" />
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
      <BottomNav />
    </div>
  )
}
