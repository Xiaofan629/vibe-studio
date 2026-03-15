"use client"

import { useState } from "react"
import { Brain, ChevronDown, ChevronRight } from "lucide-react"

interface ThinkingIndicatorProps {
  content: string
  isActive?: boolean
}

export function ThinkingIndicator({ content, isActive }: ThinkingIndicatorProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-purple-500/10 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-purple-400" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-purple-400" />
        )}
        <Brain className={`h-3.5 w-3.5 shrink-0 text-purple-400 ${isActive ? "animate-pulse" : ""}`} />
        <span className="text-xs font-medium text-purple-400">Thinking</span>
        {isActive && (
          <span className="ml-1 flex items-center gap-1">
            <span className="h-1 w-1 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="h-1 w-1 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="h-1 w-1 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: "300ms" }} />
          </span>
        )}
        {!expanded && content.length > 0 && (
          <span className="ml-1 truncate text-xs text-muted-foreground">
            {content.slice(0, 60)}...
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-t border-purple-500/20 px-3 py-2">
          <div className="max-h-64 overflow-auto text-xs text-muted-foreground whitespace-pre-wrap">
            {content}
          </div>
        </div>
      )}
    </div>
  )
}
