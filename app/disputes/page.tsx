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
      } catch (err: unknown) {
        console.error('Failed to load disputes:', err)
        
        // Distinguish network errors from Supabase/PostgREST DB errors
        const errorMsg = err instanceof Error ? err.message : ''
        const errorCode = (err as Record<string, unknown>)?.code
        if (errorMsg === 'Failed to fetch' || errorMsg.includes('NetworkError') || !errorCode) {
          setError('Connection problem. Please try again.')
        } else {
          setError('Disputes could not be loaded. Please try again.')
        }
      } finally {
        setIsLoading(false)
      }
    }
    fetchDisputes()
  }, [])

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Top Header */}
      <div className="bg-card border-b-2 border-border sticky top-0 z-10 shadow-sm">
        <div className="max-w-xl mx-auto px-4 py-4">
          <h1 className="text-[24px] font-black text-foreground tracking-tight flex items-center">
            <Scale className="w-6 h-6 mr-2" />
            Dispute Queue
          </h1>
          <p className="text-[14px] text-muted-foreground font-bold mt-1 uppercase tracking-wider">Manage farmer disputes and overrides</p>
        </div>
      </div>

      <div className="max-w-xl mx-auto p-4 space-y-8 mt-2">
        {error ? (
          <div className="bg-rose-50 border-2 border-rose-200 text-rose-700 p-6 rounded-2xl text-center">
            <XCircle className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="font-bold mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="bg-white border-2 border-rose-200 text-rose-700 px-4 py-2 rounded-lg font-bold hover:bg-rose-100 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-[120px] w-full rounded-2xl" />
            <Skeleton className="h-[120px] w-full rounded-2xl" />
          </div>
        ) : (
          <>
            {/* Open Disputes */}
            <section>
              <h2 className="text-[14px] font-black text-foreground mb-4 uppercase tracking-widest flex items-center justify-between">
                <span>Action Required</span>
                <span className="bg-amber-100 border border-amber-200 text-amber-800 text-[12px] px-2 py-0.5 rounded-md">
                  {openDisputes.length}
                </span>
              </h2>
              
              {openDisputes.length === 0 ? (
                <div className="bg-card rounded-2xl border-2 border-dashed border-input p-8 text-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3 opacity-50" />
                  <p className="text-muted-foreground font-bold">No open disputes</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {openDisputes.map(dispute => (
                    <Link key={dispute.id} href={`/disputes/${dispute.id}`} className="block">
                      <Card className="border-2 border-amber-200 bg-card shadow-sm hover:shadow-md transition-all active:scale-[0.99] relative overflow-hidden rounded-2xl">
                      <div className="absolute left-0 top-0 bottom-0 w-2 bg-amber-400" />
                      <CardContent className="p-5 pl-6">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <p className="font-black text-[18px] text-foreground tracking-tight">{dispute.can_test.farmer.name}</p>
                            <p className="text-[14px] text-muted-foreground font-mono font-bold mt-0.5">{dispute.can_test.reference_code}</p>
                          </div>
                          <ChevronRight className="w-6 h-6 text-muted-foreground shrink-0 mt-1" />
                        </div>
                        
                        <div className="flex items-center gap-2 mt-4 pt-4 border-t-2 border-border">
                          <span className="text-[12px] font-bold text-amber-800 bg-amber-100 border border-amber-200 px-2 py-1 rounded-md uppercase tracking-wider">
                            Awaiting Review
                          </span>
                          <span className="text-[12px] text-muted-foreground font-bold ml-auto">
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
            <section className="pt-6 border-t-2 border-border">
              <h2 className="text-[14px] font-black text-muted-foreground mb-4 uppercase tracking-widest flex items-center justify-between">
                <span>Recently Resolved</span>
                <span className="bg-muted text-muted-foreground border border-border text-[12px] px-2 py-0.5 rounded-md">
                  {resolvedDisputes.length}
                </span>
              </h2>

              {resolvedDisputes.length === 0 ? (
                <p className="text-muted-foreground text-[14px] font-bold text-center py-4">No recent resolutions</p>
              ) : (
                <div className="space-y-4 opacity-90">
                  {resolvedDisputes.map(dispute => (
                    <Link key={dispute.id} href={`/disputes/${dispute.id}`} className="block">
                      <Card className="border-2 border-input bg-card shadow-sm hover:bg-muted transition-colors rounded-2xl active:scale-[0.99]">
                      <CardContent className="p-5 flex items-center justify-between">
                        <div>
                          <p className="font-black text-[16px] text-foreground tracking-tight">{dispute.can_test.farmer.name}</p>
                          <p className="text-[13px] text-muted-foreground font-mono font-bold mt-0.5">{dispute.can_test.reference_code}</p>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          {dispute.resolution_type === 'adjustment' ? (
                            <span className="text-[12px] font-bold text-emerald-800 bg-emerald-100 border border-emerald-200 px-2.5 py-1.5 rounded-lg flex items-center uppercase tracking-wider">
                              <CheckCircle2 className="w-4 h-4 mr-1.5" /> Accepted
                            </span>
                          ) : (
                            <span className="text-[12px] font-bold text-rose-800 bg-rose-100 border border-rose-200 px-2.5 py-1.5 rounded-lg flex items-center uppercase tracking-wider">
                              <XCircle className="w-4 h-4 mr-1.5" /> Rejected
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
