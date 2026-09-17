"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "cn"
import { XIcon } from "lucide-react"

// ─── Root ─────────────────────────────────────────────────────────────────────
interface DialogContextValue {
  open: boolean
  onOpenChange: (open: boolean) => void
}
const DialogContext = React.createContext<DialogContextValue | null>(null)

function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  // Close on Escape
  React.useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false)
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, onOpenChange])

  // Prevent body scroll when open
  React.useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => { document.body.style.overflow = "" }
  }, [open])

  return (
    <DialogContext.Provider value={{ open, onOpenChange }}>
      {children}
    </DialogContext.Provider>
  )
}

function DialogTrigger({
  children,
  ...props
}: React.ComponentProps<"button">) {
  const ctx = React.useContext(DialogContext)
  return (
    <button type="button" onClick={() => ctx?.onOpenChange(true)} {...props}>
      {children}
    </button>
  )
}

// Renders at document.body via a React Portal — always above all stacking contexts
function DialogPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  if (!mounted || typeof document === "undefined") return null
  return createPortal(children, document.body)
}

function DialogOverlay({ className, ...props }: React.ComponentProps<"div">) {
  const ctx = React.useContext(DialogContext)
  return (
    <div
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm",
        className
      )}
      onClick={() => ctx?.onOpenChange(false)}
      aria-hidden="true"
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<"div"> & { showCloseButton?: boolean }) {
  const ctx = React.useContext(DialogContext)
  const dialogRef = React.useRef<HTMLDivElement>(null)

  // Focus management
  React.useEffect(() => {
    if (!ctx?.open) return
    const activeBeforeOpen = document.activeElement as HTMLElement
    
    // Move focus into the dialog
    if (dialogRef.current) {
      dialogRef.current.focus()
    }
    
    // Trap focus
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !dialogRef.current) return
      
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => !el.hasAttribute('disabled'))
      
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }
      
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      
      if (e.shiftKey) {
        if (document.activeElement === first || document.activeElement === dialogRef.current) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    
    document.addEventListener('keydown', handleTab)
    
    return () => {
      document.removeEventListener('keydown', handleTab)
      if (activeBeforeOpen && typeof activeBeforeOpen.focus === 'function') {
        activeBeforeOpen.focus()
      }
    }
  }, [ctx?.open])

  if (!ctx?.open) return null

  return (
    <DialogPortal>
      <DialogOverlay />
      {/* Scroll container — handles keyboard open on mobile */}
      <div 
        className="fixed inset-0 z-[201] overflow-y-auto"
        onClick={() => ctx?.onOpenChange(false)}
      >
        <div className="flex min-h-full items-center justify-center p-4">
          <div
            ref={dialogRef}
            tabIndex={-1}
            data-slot="dialog-content"
            className={cn(
              "relative w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-black/10 p-5 outline-none",
              "animate-in fade-in-0 zoom-in-95 duration-100",
              className
            )}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            {...props}
          >
            {children}
            {showCloseButton && (
              <button
                type="button"
                onClick={() => ctx.onOpenChange(false)}
                className="absolute top-3 right-3 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-slate-100 transition-colors"
                aria-label="Close"
              >
                <XIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 mb-4", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, children, ...props }: React.ComponentProps<"div"> & { showCloseButton?: boolean }) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 pt-4 border-t border-slate-100 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="dialog-title"
      className={cn("text-lg font-bold text-foreground leading-tight", className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function DialogClose({ children, ...props }: React.ComponentProps<"button">) {
  const ctx = React.useContext(DialogContext)
  return (
    <button type="button" onClick={() => ctx?.onOpenChange(false)} {...props}>
      {children}
    </button>
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
