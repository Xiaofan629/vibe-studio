"use client"

import type { AgentNode } from "@/lib/types"
import { cn } from "@/lib/utils"

interface AgentTreeViewProps {
  agents: AgentNode[]
}

const STATUS_COLORS: Record<string, string> = {
  running: "bg-blue-500",
  completed: "bg-green-500",
  failed: "bg-red-500",
  killed: "bg-gray-400",
}

function TreeNode({ node, depth = 0 }: { node: AgentNode; depth?: number }) {
  return (
    <div className="flex flex-col">
      <div
        className="flex items-center gap-2 py-1.5"
        style={{ paddingLeft: `${depth * 24}px` }}
      >
        {depth > 0 && (
          <div className="h-px w-4 bg-border" />
        )}
        <div
          className={cn(
            "h-3 w-3 rounded-full shrink-0",
            STATUS_COLORS[node.status] ?? "bg-gray-400"
          )}
        />
        <span className="text-sm font-medium truncate max-w-[200px]">
          {node.prompt?.slice(0, 40) ?? `Agent ${node.id.slice(0, 8)}`}
        </span>
        <span className="text-xs text-muted-foreground">
          [{node.status}]
        </span>
        {node.completedAt && (
          <span className="text-xs text-muted-foreground ml-auto">
            {Math.round(
              (new Date(node.completedAt).getTime() -
                new Date(node.startedAt).getTime()) /
                1000
            )}s
          </span>
        )}
      </div>
      {node.children.map((child) => (
        <TreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}

export function AgentTreeView({ agents }: AgentTreeViewProps) {
  // Build tree from flat list
  const rootAgents = buildTree(agents)

  if (rootAgents.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>暂无多 Agent 数据</p>
      </div>
    )
  }

  return (
    <div className="overflow-auto p-4">
      {rootAgents.map((agent) => (
        <TreeNode key={agent.id} node={agent} />
      ))}
    </div>
  )
}

function buildTree(agents: AgentNode[]): AgentNode[] {
  const map = new Map<string, AgentNode>()
  agents.forEach((a) => map.set(a.id, { ...a, children: [] }))

  const roots: AgentNode[] = []
  map.forEach((agent) => {
    if (agent.parentId && map.has(agent.parentId)) {
      map.get(agent.parentId)!.children.push(agent)
    } else {
      roots.push(agent)
    }
  })

  return roots
}
