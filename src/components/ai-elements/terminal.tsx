"use client"

import { useState, useRef, useEffect, useCallback, useMemo, type HTMLAttributes } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CheckIcon, CopyIcon, TerminalIcon, Trash2Icon } from "lucide-react"

interface TerminalProps extends HTMLAttributes<HTMLDivElement> {
  output: string
  isStreaming?: boolean
  autoScroll?: boolean
  onClear?: () => void
}

function normalizeTerminalOutput(output: string): string {
  if (!output) return output

  const hasEscapedAnsi =
    output.includes("\\u001b") ||
    output.includes("\\u001B") ||
    output.includes("\\x1b") ||
    output.includes("\\x1B")

  if (!hasEscapedAnsi) return output

  return output
    .replace(/\\u001b/gi, "\u001b")
    .replace(/\\x1b/gi, "\u001b")
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "")
}

export function Terminal({
  output,
  isStreaming = false,
  autoScroll = true,
  onClear,
  className,
  ...props
}: TerminalProps) {
  const normalizedOutput = useMemo(
    () => stripAnsi(normalizeTerminalOutput(output)),
    [output]
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const [isCopied, setIsCopied] = useState(false)
  const timeoutRef = useRef<number>(0)

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [output, autoScroll])

  const copyToClipboard = useCallback(async () => {
    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
      return
    }

    try {
      await navigator.clipboard.writeText(output)
      setIsCopied(true)
      timeoutRef.current = window.setTimeout(() => setIsCopied(false), 2000)
    } catch (error) {
      console.error("Failed to copy:", error)
    }
  }, [output])

  useEffect(
    () => () => {
      window.clearTimeout(timeoutRef.current)
    },
    []
  )

  const Icon = isCopied ? CheckIcon : CopyIcon

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground",
        className
      )}
      {...props}
    >
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <TerminalIcon className="size-4" />
          <span>Terminal</span>
        </div>
        <div className="flex items-center gap-1">
          {isStreaming && (
            <span className="text-xs text-muted-foreground animate-pulse">
              Running...
            </span>
          )}
          <Button
            className="size-7 shrink-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={copyToClipboard}
            size="icon"
            variant="ghost"
          >
            <Icon size={14} />
          </Button>
          {onClear && (
            <Button
              className="size-7 shrink-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={onClear}
              size="icon"
              variant="ghost"
            >
              <Trash2Icon size={14} />
            </Button>
          )}
        </div>
      </div>
      <div
        className="max-h-96 overflow-auto p-4 font-mono text-sm leading-relaxed"
        ref={containerRef}
      >
        <pre className="whitespace-pre-wrap break-words">
          {normalizedOutput}
          {isStreaming && (
            <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-foreground" />
          )}
        </pre>
      </div>
    </div>
  )
}
