"use client"

import { useEffect, useMemo, useState } from "react"
import { Command, FileCode, FolderOpen, Terminal, Zap } from "lucide-react"
import { promptApi } from "@/lib/tauri"
import type { SlashCommand } from "@/lib/types"
import { cn } from "@/lib/utils"

interface AgentSlashCommandPickerProps {
  projectPath?: string
  agentType?: string
  query: string
  onSelect: (command: SlashCommand) => void
  onClose: () => void
}

function getCommandIcon(command: SlashCommand) {
  if (command.has_bash_commands) return Terminal
  if (command.has_file_references) return FileCode
  if (command.accepts_arguments) return Zap
  if (command.scope === "project") return FolderOpen
  return Command
}

export function AgentSlashCommandPicker({
  projectPath,
  agentType,
  query,
  onSelect,
  onClose,
}: AgentSlashCommandPickerProps) {
  const [commands, setCommands] = useState<SlashCommand[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    promptApi
      .listSlashCommands(projectPath, agentType)
      .then((items) => {
        if (!cancelled) {
          setCommands(items)
          setSelectedIndex(0)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setCommands([])
          setError(err instanceof Error ? err.message : "Failed to load commands")
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [projectPath, agentType])

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      return commands
    }
    return commands
      .filter((command) => {
        return (
          command.name.toLowerCase().includes(normalized) ||
          command.full_command.toLowerCase().includes(normalized) ||
          command.description?.toLowerCase().includes(normalized) ||
          command.namespace?.toLowerCase().includes(normalized)
        )
      })
      .sort((a, b) => {
        const aStarts = a.full_command.toLowerCase().startsWith(`/${normalized}`)
        const bStarts = b.full_command.toLowerCase().startsWith(`/${normalized}`)
        if (aStarts && !bStarts) return -1
        if (!aStarts && bStarts) return 1
        return a.full_command.localeCompare(b.full_command)
      })
  }, [commands, query])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setSelectedIndex((index) =>
          Math.min(index + 1, Math.max(filteredCommands.length - 1, 0))
        )
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setSelectedIndex((index) => Math.max(index - 1, 0))
        return
      }
      if (event.key === "Enter" && filteredCommands[selectedIndex]) {
        event.preventDefault()
        onSelect(filteredCommands[selectedIndex])
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [filteredCommands, onClose, onSelect, selectedIndex])

  return (
    <div className="absolute bottom-full left-0 right-0 z-40 mb-3 overflow-hidden rounded-2xl border border-border bg-popover shadow-[0_24px_80px_-36px_rgba(15,23,42,0.65)]">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div>
          <p className="text-sm font-medium">Slash Commands</p>
          <p className="text-xs text-muted-foreground">输入 `/` 后快速插入命令</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          Esc
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto p-2">
        {loading ? (
          <div className="px-3 py-6 text-sm text-muted-foreground">加载中...</div>
        ) : error ? (
          <div className="px-3 py-6 text-sm text-destructive">{error}</div>
        ) : filteredCommands.length === 0 ? (
          <div className="px-3 py-6 text-sm text-muted-foreground">没有匹配的命令</div>
        ) : (
          <div className="space-y-1">
            {filteredCommands.map((command, index) => {
              const Icon = getCommandIcon(command)
              return (
                <button
                  key={command.id}
                  type="button"
                  onClick={() => onSelect(command)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition",
                    index === selectedIndex
                      ? "bg-accent text-foreground"
                      : "hover:bg-accent/70"
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{command.full_command}</div>
                    <div className="line-clamp-2 text-xs text-muted-foreground">
                      {command.description || command.content}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
