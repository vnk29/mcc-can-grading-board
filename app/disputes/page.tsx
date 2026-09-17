'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'
import { Scale, CheckCircle2, ChevronRight, XCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { CanDecision } from '@/types/database'

type DisputeListItem = {
  id: string
  status: 'open' | 'resolved'
  submitted_at: string
  resolution_type: 'adjustment' | 'final_rejection' | null
  can_test: {
    reference_code: string
    decision: CanDecision
    test_performed_at: string
    farmer: { name: string }
  }
}

export default function DisputesPage() {
  const [openDisputes, setOpenDisputes] = useState<DisputeListItem[]>([])
  const [resolvedDisputes, setResolvedDisputes] = useState<DisputeListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchDisputes() {
      setIsLoading(true)
      setError(null)
      try {
        const [openRes, resolvedRes] = await Promise.all([
          supabase
            .from('disputes')
            .select(`
              id, status, submitted_at, resolution_type,
              can_test:can_tests!inner (
                reference_code, decision, test_performed_at,
                farmer:farmers!inner (name)
              )
            `)
            .eq('status', 'open')
            .order('submitted_at', { ascending: false }),
          
          supabase
            .from('disputes')
            .select(`
              id, status, submitted_at, resolution_type,
              can_test:can_tests!inner (
                reference_code, decision, test_performed_at,
                farmer:farmers!inner (name)
              )
            `)
            .eq('status', 'resolved')
            .order('resolved_at', { ascending: false })
            .limit(50)
        ])

        if (openRes.error) throw openRes.error
        if (resolvedRes.error) throw resolvedRes.error

        setOpenDisputes(openRes.data as unknown as DisputeListItem[])
        setResolvedDisputes(resolvedRes.data as unknown as DisputeListItem[])
      } catch (err) {
        console.error('Failed to load disputes:', err)
        setError('Failed to load disputes. Please check your connection.')
      } finally {
        setIsLoading(false)
      }
    }
    fetchDisputes()
  }, [])

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Top Header */}
      <div className="bg-white border-b border-slate-200 sticky top-16 z-10 shadow-sm">
        <div className="max-w-xl mx-auto px-4 py-4">
          <h1 className="text-[22px] font-extrabold text-[#052b1f] tracking-tight flex items-center">
            <Scale className="w-6 h-6 mr-2" />
            Dispute Queue
          </h1>
          <p className="text-[13px] text-slate-500 font-medium mt-1">Manage farmer disputes and overrides</p>
        </div>
      </div>

      <div className="max-w-xl mx-auto p-4 space-y-8">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm font-medium">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-[120px] w-full rounded-xl" />
            <Skeleton className="h-[120px] w-full rounded-xl" />
          </div>
        ) : (
          <>
            {/* Open Disputes */}
            <section>
              <h2 className="text-[15px] font-bold text-slate-800 mb-3 uppercase tracking-wider flex items-center justify-between">
                <span>Action Required</span>
                <span className="bg-amber-100 text-amber-800 text-[11px] px-2 py-0.5 rounded-full">
                  {openDisputes.length}
                </span>
              </h2>
              
              {openDisputes.length === 0 ? (
                <div className="bg-white rounded-xl border border-dashed border-slate-300 p-8 text-center">
                  <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3 opacity-50" />
                  <p className="text-slate-500 font-medium">No open disputes</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {openDisputes.map(dispute => (
                    <Link key={dispute.id} href={`/disputes/${dispute.id}`} className="block">
                      <Card className="border-amber-200 bg-white shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
                      <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-amber-400" />
                      <CardContent className="p-4 pl-5">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <p className="font-bold text-[17px] text-slate-900">{dispute.can_test.farmer.name}</p>
                            <p className="text-[13px] text-slate-500 font-mono mt-0.5">{dispute.can_test.reference_code}</p>
                          </div>
                          <ChevronRight className="w-5 h-5 text-slate-400 shrink-0 mt-1" />
                        </div>
                        
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
                          <span className="text-[12px] font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-md">
                            Awaiting Review
                          </span>
                          <span className="text-[12px] text-slate-400 ml-auto">
                            {format(new Date(dispute.submitted_at), 'MMM d, h:mm a')}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            {/* Resolved Disputes */}
            <section className="pt-4 border-t border-slate-200">
              <h2 className="text-[14px] font-bold text-slate-500 mb-3 uppercase tracking-wider flex items-center justify-between">
                <span>Recently Resolved</span>
                <span className="bg-slate-100 text-slate-600 text-[11px] px-2 py-0.5 rounded-full">
                  {resolvedDisputes.length}
                </span>
              </h2>

              {resolvedDisputes.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-4">No recent resolutions</p>
              ) : (
                <div className="space-y-3 opacity-80">
                  {resolvedDisputes.map(dispute => (
                    <Link key={dispute.id} href={`/disputes/${dispute.id}`} className="block">
                      <Card className="border-slate-200 bg-white shadow-none hover:bg-slate-50 transition-colors">
                      <CardContent className="p-4 flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-[15px] text-slate-700">{dispute.can_test.farmer.name}</p>
                          <p className="text-[12px] text-slate-500 font-mono mt-0.5">{dispute.can_test.reference_code}</p>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          {dispute.resolution_type === 'adjustment' ? (
                            <span className="text-[11px] font-bold text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded-md flex items-center">
                              <CheckCircle2 className="w-3 h-3 mr-1" /> Accepted
                            </span>
                          ) : (
                            <span className="text-[11px] font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded-md flex items-center">
                              <XCircle className="w-3 h-3 mr-1" /> Rejected
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
