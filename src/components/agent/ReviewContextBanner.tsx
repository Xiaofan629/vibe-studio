"use client"

import { useEffect, useState } from "react"
import { Check, ChevronDown, MessageSquareQuote } from "lucide-react"

interface ReviewContextBannerProps {
  count: number
  preview?: string | null
}

export function ReviewContextBanner({
  count,
  preview,
}: ReviewContextBannerProps) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  if (count === 0) {
    return null
  }

  const previewText = preview?.trim()

  useEffect(() => {
    if (!copied) {
      return
    }

    const timer = window.setTimeout(() => {
      setCopied(false)
    }, 1800)

    return () => window.clearTimeout(timer)
  }, [copied])

  const handleCopy = async () => {
    if (!previewText) {
      return
    }

    try {
      await navigator.clipboard.writeText(`${previewText}\n\n---\n\n`)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const handleToggle = () => {
    setOpen((current) => !current)
    void handleCopy()
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={handleToggle}
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/20 bg-amber-500/6 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-amber-500/30 hover:bg-amber-500/10"
      >
        <MessageSquareQuote className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        <span className="max-w-[220px] truncate">
          点击复制 {count} 条评审评论
        </span>
        <ChevronDown
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && previewText && (
        <div className="absolute right-0 top-full z-20 mt-2 w-[360px] max-w-[min(360px,calc(100vw-2rem))] rounded-xl border border-border bg-popover p-3 shadow-[0_20px_50px_-30px_rgba(15,23,42,0.45)]">
          <div className="mb-2 text-[11px] font-medium text-foreground/80">
            评论上下文预览
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-muted-foreground">
            {previewText}
          </pre>
          <div className="mt-2 text-[11px] text-muted-foreground/80">
            点击上方按钮会自动复制，粘贴到对话输入框即可
          </div>
          {copied && (
            <div className="mt-2 rounded-md border border-emerald-500/20 bg-emerald-500/8 px-2 py-1 text-[11px] text-emerald-700 dark:text-emerald-400">
              <span className="inline-flex items-center gap-1">
                <Check className="h-3.5 w-3.5" />
                已复制到剪贴板
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
