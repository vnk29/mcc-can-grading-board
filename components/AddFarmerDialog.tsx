'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { FarmerRow } from '@/types/database'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'

export type AddFarmerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (farmer: FarmerRow) => void
}

export function AddFarmerDialog({ open, onOpenChange, onSuccess }: AddFarmerDialogProps) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [village, setVillage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const resetForm = () => {
    setName('')
    setPhone('')
    setVillage('')
    setError(null)
    setSuccess(false)
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && !isSubmitting) {
      resetForm()
      onOpenChange(false)
    } else if (newOpen) {
      onOpenChange(true)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // 1. Validation
    const trimmedName = name.trim()
    const trimmedPhone = phone.trim()
    const trimmedVillage = village.trim()

    if (!trimmedName) {
      setError('Farmer name is required.')
      return
    }

    if (trimmedName.length > 100) {
      setError('Farmer name is too long.')
      return
    }

    if (trimmedPhone && trimmedPhone.length > 20) {
      setError('Phone number is too long.')
      return
    }

    if (trimmedVillage && trimmedVillage.length > 100) {
      setError('Village name is too long.')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      // 2. Duplicate Check
      // Simple duplicate check: name matches exactly (case insensitive) and phone matches
      let query = supabase.from('farmers').select('*').ilike('name', trimmedName)
      if (trimmedPhone) {
        query = query.eq('phone', trimmedPhone)
      }
      
      const { data: existing, error: searchError } = await query.limit(1)
      
      if (searchError) {
        throw new Error('Failed to check for existing farmers.')
      }

      if (existing && existing.length > 0) {
        setError('A farmer with this name and phone already exists.')
        setIsSubmitting(false)
        return
      }

      // 3. Insert
      const { data, error: insertError } = await supabase
        .from('farmers')
        .insert({
          name: trimmedName,
          phone: trimmedPhone || null,
          village: trimmedVillage || null
        })
        .select()
        .single()

      if (insertError) {
        // Handle constraint errors or RLS gracefully
        console.error('Insert error:', insertError)
        if (insertError.code === '23505') {
          setError('This farmer already exists in the database.')
        } else if (insertError.code === '42501') {
          setError('Permission denied. You do not have access to add farmers.')
        } else {
          setError('Failed to add farmer. Please try again.')
        }
        setIsSubmitting(false)
        return
      }

      // 4. Success Flow
      setSuccess(true)
      
      // Notify parent after a short delay so they can see the success state
      setTimeout(() => {
        if (onSuccess && data) {
          onSuccess(data as FarmerRow)
        }
        handleOpenChange(false)
      }, 1000)

    } catch (err) {
      console.error(err)
      setError('An unexpected error occurred. Please try again.')
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]" showCloseButton={!isSubmitting}>
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Add Farmer</DialogTitle>
          <DialogDescription>
            Register a new farmer in the system.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="py-8 flex flex-col items-center justify-center space-y-3">
            <CheckCircle2 className="w-12 h-12 text-[#0f6041]" />
            <p className="text-lg font-bold text-[#0f6041]">Farmer added successfully.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 py-4">
            {error && (
              <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm font-medium flex items-start gap-2">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm font-bold">
                Farmer Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ramesh Patel"
                className="h-12 text-base bg-slate-50 border-slate-200 focus-visible:ring-[#0f6041]"
                disabled={isSubmitting}
                maxLength={100}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="text-sm font-bold">
                Phone <span className="text-slate-400 font-normal">(Optional)</span>
              </Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 9876543210"
                className="h-12 text-base bg-slate-50 border-slate-200 focus-visible:ring-[#0f6041]"
                disabled={isSubmitting}
                maxLength={20}
                type="tel"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="village" className="text-sm font-bold">
                Village <span className="text-slate-400 font-normal">(Optional)</span>
              </Label>
              <Input
                id="village"
                value={village}
                onChange={(e) => setVillage(e.target.value)}
                placeholder="e.g. North Village"
                className="h-12 text-base bg-slate-50 border-slate-200 focus-visible:ring-[#0f6041]"
                disabled={isSubmitting}
                maxLength={100}
              />
            </div>

            <DialogFooter className="sm:justify-between pt-4 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                className="h-12 w-full sm:w-auto"
                onClick={() => handleOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="h-12 w-full sm:w-auto font-bold bg-[#0f6041] hover:bg-[#0a422c] text-white"
                disabled={isSubmitting}
              >
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Farmer
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
