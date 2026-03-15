"use client"

import { useState, useMemo } from "react"
import {
  ChevronDown,
  ChevronRight,
  FileSearch,
  FolderSearch,
  Pencil,
  FilePlus,
  Terminal,
  Search,
  Globe,
  Wrench,
  ListTree,
  type LucideIcon,
} from "lucide-react"
import type { AgentLogEntry } from "@/lib/types"

interface ToolCallCardProps {
  entry: AgentLogEntry
}

const TOOL_CONFIG: Record<string, { icon: LucideIcon; color: string; label: string }> = {
  Read: { icon: FileSearch, color: "text-blue-400", label: "Read" },
  Write: { icon: FilePlus, color: "text-green-400", label: "Write" },
  Edit: { icon: Pencil, color: "text-yellow-400", label: "Edit" },
  Bash: { icon: Terminal, color: "text-orange-400", label: "Bash" },
  Glob: { icon: FolderSearch, color: "text-cyan-400", label: "Glob" },
  Grep: { icon: Search, color: "text-purple-400", label: "Grep" },
  WebFetch: { icon: Globe, color: "text-pink-400", label: "WebFetch" },
  WebSearch: { icon: Globe, color: "text-pink-400", label: "WebSearch" },
  Task: { icon: ListTree, color: "text-indigo-400", label: "Task" },
  TodoWrite: { icon: ListTree, color: "text-teal-400", label: "TodoWrite" },
}

function getToolConfig(toolName: string | null) {
  if (!toolName) return { icon: Wrench, color: "text-muted-foreground", label: "Tool Call" }
  return TOOL_CONFIG[toolName] ?? { icon: Wrench, color: "text-blue-400", label: toolName }
}

function formatToolInput(content: string, toolName: string | null): { summary: string; details: string } {
  try {
    const parsed = JSON.parse(content)

    switch (toolName) {
      case "Read": {
        const path = parsed.file_path ?? parsed.path ?? ""
        return { summary: path, details: content }
      }
      case "Write": {
        const path = parsed.file_path ?? parsed.path ?? ""
        return { summary: path, details: content }
      }
      case "Edit": {
        const path = parsed.file_path ?? parsed.path ?? ""
        return { summary: path, details: content }
      }
      case "Bash": {
        const cmd = parsed.command ?? ""
        return { summary: cmd, details: content }
      }
      case "Glob": {
        const pattern = parsed.pattern ?? ""
        const path = parsed.path ?? ""
        return { summary: `${pattern}${path ? ` in ${path}` : ""}`, details: content }
      }
      case "Grep": {
        const pattern = parsed.pattern ?? ""
        const path = parsed.path ?? ""
        return { summary: `"${pattern}"${path ? ` in ${path}` : ""}`, details: content }
      }
      case "Task": {
        const desc = parsed.description ?? parsed.prompt?.slice(0, 80) ?? ""
        return { summary: desc, details: content }
      }
      default: {
        const keys = Object.keys(parsed)
        if (keys.length === 0) return { summary: "", details: content }
        const mainKey = keys[0]
        const mainVal = typeof parsed[mainKey] === "string"
          ? parsed[mainKey].slice(0, 100)
          : JSON.stringify(parsed[mainKey]).slice(0, 100)
        return { summary: mainVal, details: content }
      }
    }
  } catch {
    return { summary: content.slice(0, 100), details: content }
  }
}

export function ToolCallCard({ entry }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const config = getToolConfig(entry.toolName)
  const Icon = config.icon

  const { summary, details } = useMemo(
    () => formatToolInput(entry.content, entry.toolName),
    [entry.content, entry.toolName]
  )

  const formattedDetails = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(details), null, 2)
    } catch {
      return details
    }
  }, [details])

  return (
    <div className="rounded-lg border border-border bg-card/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <Icon className={`h-3.5 w-3.5 shrink-0 ${config.color}`} />
        <span className={`font-medium text-xs ${config.color}`}>
          {config.label}
        </span>
        {summary && (
          <span className="ml-1 truncate font-mono text-xs text-muted-foreground">
            {summary}
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-t border-border px-3 py-2">
          <pre className="max-h-64 overflow-auto rounded bg-muted/50 p-2 text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">
            {formattedDetails}
          </pre>
        </div>
      )}
    </div>
  )
}
