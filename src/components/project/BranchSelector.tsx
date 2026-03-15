"use client"

import type { GitBranch } from "@/lib/types"
import { GitBranch as GitBranchIcon, ChevronDown } from "lucide-react"
import { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"

interface BranchSelectorProps {
  branches: GitBranch[]
  currentBranch: string | null
  onCheckout: (branch: string) => void
  loading?: boolean
  disabled?: boolean
}

export function BranchSelector({
  branches,
  currentBranch,
  onCheckout,
  loading,
  disabled,
}: BranchSelectorProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const localBranches = branches.filter((b) => !b.isRemote)
  const remoteBranches = branches.filter((b) => b.isRemote)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={loading || disabled}
        className={cn(
          "flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1 text-sm text-foreground transition-colors",
          disabled ? "cursor-not-allowed opacity-60" : "hover:bg-accent"
        )}
      >
        <GitBranchIcon className="h-3.5 w-3.5" />
        <span className="max-w-[120px] truncate">
          {currentBranch ?? "—"}
        </span>
        {!disabled && <ChevronDown className="h-3 w-3 text-muted-foreground" />}
      </button>

      {open && !disabled && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-56 overflow-auto rounded-md border border-border bg-popover py-1 shadow-lg">
          {localBranches.length > 0 && (
            <>
              <div className="px-2 py-1 text-[10px] font-medium uppercase text-muted-foreground">
                Local
              </div>
              {localBranches.map((b) => (
                <button
                  key={b.name}
                  onClick={() => {
                    onCheckout(b.name)
                    setOpen(false)
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                    b.name === currentBranch && "bg-accent/50 font-medium"
                  )}
                >
                  <span className="truncate">{b.name}</span>
                  {b.name === currentBranch && (
                    <span className="ml-auto text-xs text-green-500">●</span>
                  )}
                </button>
              ))}
            </>
          )}

          {remoteBranches.length > 0 && (
            <>
              <div className="mt-1 border-t border-border px-2 py-1 text-[10px] font-medium uppercase text-muted-foreground">
                Remote
              </div>
              {remoteBranches.map((b) => (
                <button
                  key={b.name}
                  onClick={() => {
                    onCheckout(b.name.replace("origin/", ""))
                    setOpen(false)
                  }}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <span className="truncate">{b.name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
