"use client"

import type { SessionStats } from "@/lib/types"
import { Clock, Zap, Database } from "lucide-react"

interface SessionStatsProps {
  stats: SessionStats | null
}

export function SessionStatsPanel({ stats }: SessionStatsProps) {
  if (!stats) return null

  const formatNumber = (num: number) => num.toLocaleString()
  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    if (hours > 0) return `${hours}h ${minutes % 60}m`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  }

  return (
    <div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-muted/30 text-xs">
      {stats.totalTokens && (
        <div className="flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Tokens:</span>
          <span className="font-medium">{formatNumber(stats.totalTokens)}</span>
        </div>
      )}

      {stats.totalDurationMs > 0 && (
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Duration:</span>
          <span className="font-medium">{formatDuration(stats.totalDurationMs)}</span>
        </div>
      )}

      {stats.contextWindowUsagePercent && (
        <div className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Context:</span>
          <span className="font-medium">{stats.contextWindowUsagePercent.toFixed(1)}%</span>
        </div>
      )}
    </div>
  )
}
