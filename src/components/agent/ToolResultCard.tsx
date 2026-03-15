"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, CheckCircle2 } from "lucide-react"
import type { AgentLogEntry } from "@/lib/types"

interface ToolResultCardProps {
  entry: AgentLogEntry
}

export function ToolResultCard({ entry }: ToolResultCardProps) {
  const [expanded, setExpanded] = useState(false)

  const contentPreview = entry.content.length > 80
    ? entry.content.slice(0, 80) + "..."
    : entry.content

  const lineCount = entry.content.split("\n").length

  return (
    <div className="rounded-lg border border-border bg-card/30 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-400" />
        <span className="text-xs font-medium text-green-400">Result</span>
        <span className="ml-1 truncate font-mono text-xs text-muted-foreground">
          {contentPreview}
        </span>
        {lineCount > 1 && (
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {lineCount} lines
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-t border-border px-3 py-2">
          <pre className="max-h-64 overflow-auto rounded bg-muted/50 p-2 text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">
            {entry.content}
          </pre>
        </div>
      )}
    </div>
  )
}
