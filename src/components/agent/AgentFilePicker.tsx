"use client"

import { useEffect, useMemo, useState } from "react"
import {
  ChevronRight,
  File,
  FileCode,
  FileImage,
  FileText,
  Folder,
} from "lucide-react"
import { promptApi } from "@/lib/tauri"
import type { FileEntry } from "@/lib/types"
import { cn } from "@/lib/utils"

interface AgentFilePickerProps {
  basePath: string
  query: string
  onSelect: (entry: FileEntry) => void
  onClose: () => void
}

function getFileIcon(entry: FileEntry) {
  if (entry.is_directory) return Folder
  const ext = entry.extension?.toLowerCase()
  if (!ext) return File
  if (["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "cpp", "c", "h"].includes(ext)) {
    return FileCode
  }
  if (["md", "txt", "json", "yaml", "yml", "toml", "xml", "html", "css"].includes(ext)) {
    return FileText
  }
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"].includes(ext)) {
    return FileImage
  }
  return File
}

export function AgentFilePicker({
  basePath,
  query,
  onSelect,
  onClose,
}: AgentFilePickerProps) {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const loader = query.trim()
      ? promptApi.searchFiles(basePath, query.trim())
      : promptApi.listDirectoryContents(basePath)

    loader
      .then((items) => {
        if (!cancelled) {
          setEntries(items)
          setSelectedIndex(0)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setEntries([])
          setError(err instanceof Error ? err.message : "Failed to load files")
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
  }, [basePath, query])

  const hint = useMemo(() => {
    if (query.trim()) {
      return `匹配 "${query.trim()}"`
    }
    return "当前目录"
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
        setSelectedIndex((index) => Math.min(index + 1, Math.max(entries.length - 1, 0)))
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setSelectedIndex((index) => Math.max(index - 1, 0))
        return
      }
      if (event.key === "Enter" && entries[selectedIndex]) {
        event.preventDefault()
        onSelect(entries[selectedIndex])
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [entries, onClose, onSelect, selectedIndex])

  return (
    <div className="absolute bottom-full left-0 right-0 z-40 mb-3 overflow-hidden rounded-2xl border border-border bg-popover shadow-[0_24px_80px_-36px_rgba(15,23,42,0.65)]">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div>
          <p className="text-sm font-medium">引用文件</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
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
        ) : entries.length === 0 ? (
          <div className="px-3 py-6 text-sm text-muted-foreground">没有匹配的文件</div>
        ) : (
          <div className="space-y-1">
            {entries.map((entry, index) => {
              const Icon = getFileIcon(entry)
              return (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => onSelect(entry)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition",
                    index === selectedIndex
                      ? "bg-accent text-foreground"
                      : "hover:bg-accent/70"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{entry.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {entry.path}
                    </div>
                  </div>
                  {entry.is_directory && (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
