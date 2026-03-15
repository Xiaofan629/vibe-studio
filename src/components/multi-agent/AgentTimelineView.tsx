"use client"

import type { TimelineEntry } from "@/lib/types"
import { cn } from "@/lib/utils"

interface AgentTimelineViewProps {
  timeline: TimelineEntry[]
}

const STATUS_BG: Record<string, string> = {
  running: "bg-blue-500",
  completed: "bg-green-500",
  failed: "bg-red-500",
  killed: "bg-gray-400",
}

export function AgentTimelineView({ timeline }: AgentTimelineViewProps) {
  if (timeline.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>暂无时间线数据</p>
      </div>
    )
  }

  const minTime = Math.min(...timeline.map((e) => e.startTime))
  const maxTime = Math.max(
    ...timeline.map((e) => e.endTime ?? Date.now())
  )
  const totalDuration = maxTime - minTime || 1

  return (
    <div className="overflow-x-auto p-4">
      {/* Time scale */}
      <div className="relative mb-2 h-6 border-b border-border">
        {[0, 25, 50, 75, 100].map((pct) => (
          <span
            key={pct}
            className="absolute text-[10px] text-muted-foreground -translate-x-1/2"
            style={{ left: `${pct}%` }}
          >
            {formatDuration(((pct / 100) * totalDuration) / 1000)}
          </span>
        ))}
      </div>

      {/* Timeline bars */}
      {timeline.map((entry) => {
        const left =
          ((entry.startTime - minTime) / totalDuration) * 100
        const width =
          (((entry.endTime ?? Date.now()) - entry.startTime) / totalDuration) *
          100

        return (
          <div
            key={entry.id}
            className="relative my-1.5 h-7"
            style={{ marginLeft: `${entry.depth * 20}px` }}
          >
            <div
              className={cn(
                "absolute h-full rounded-md flex items-center px-2 min-w-[40px]",
                STATUS_BG[entry.status]
              )}
              style={{ left: `${left}%`, width: `${Math.max(width, 2)}%` }}
            >
              <span className="text-[11px] font-medium text-white truncate">
                {entry.label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${mins}m${secs}s`
}
