"use client"

import type { AgentNode } from "@/lib/types"
import { cn } from "@/lib/utils"

interface AgentPanelViewProps {
  agents: AgentNode[]
}

const STATUS_BORDER: Record<string, string> = {
  running: "border-blue-500/50",
  completed: "border-green-500/50",
  failed: "border-red-500/50",
  killed: "border-gray-400/50",
}

const STATUS_BG: Record<string, string> = {
  running: "bg-blue-500/10",
  completed: "bg-green-500/10",
  failed: "bg-red-500/10",
  killed: "bg-gray-400/10",
}

export function AgentPanelView({ agents }: AgentPanelViewProps) {
  if (agents.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>暂无多 Agent 数据</p>
      </div>
    )
  }

  return (
    <div
      className="grid gap-3 p-4"
      style={{
        gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
      }}
    >
      {agents.map((agent) => (
        <div
          key={agent.id}
          className={cn(
            "rounded-lg border p-3",
            STATUS_BORDER[agent.status],
            STATUS_BG[agent.status]
          )}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium truncate max-w-[250px]">
              {agent.prompt?.slice(0, 50) ?? `Agent ${agent.id.slice(0, 8)}`}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                agent.status === "running" && "bg-blue-500/20 text-blue-400",
                agent.status === "completed" && "bg-green-500/20 text-green-400",
                agent.status === "failed" && "bg-red-500/20 text-red-400",
                agent.status === "killed" && "bg-gray-500/20 text-gray-400"
              )}
            >
              {agent.status}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            <p>Depth: {agent.depth}</p>
            {agent.completedAt && (
              <p>
                Duration:{" "}
                {Math.round(
                  (new Date(agent.completedAt).getTime() -
                    new Date(agent.startedAt).getTime()) /
                    1000
                )}s
              </p>
            )}
          </div>
          <div className="mt-2 max-h-[200px] overflow-y-auto rounded bg-background/50 p-2 text-xs font-mono">
            <p className="text-muted-foreground">Agent output stream...</p>
          </div>
        </div>
      ))}
    </div>
  )
}
