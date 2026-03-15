"use client"

import { useState, useEffect, useCallback } from "react"
import { invoke } from "@/lib/tauri"
import { Folder, FolderGit2, Home, ChevronUp, X } from "lucide-react"

interface DirEntry {
  name: string
  path: string
  is_dir: boolean
  is_git_repo: boolean
}

interface FileBrowserProps {
  open: boolean
  onClose: () => void
  onSelect: (path: string) => void
}

export function FileBrowser({ open, onClose, onSelect }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState("")
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [pathInput, setPathInput] = useState("")
  const [filter, setFilter] = useState("")
  const [loading, setLoading] = useState(false)

  // Load home dir on first open
  useEffect(() => {
    if (open && !currentPath) {
      invoke<string>("get_home_dir").then((home) => {
        setCurrentPath(home)
        setPathInput(home)
      }).catch(() => {
        setCurrentPath("/")
        setPathInput("/")
      })
    }
  }, [open, currentPath])

  // Load directory entries
  useEffect(() => {
    if (!currentPath) return
    setLoading(true)
    invoke<DirEntry[]>("list_directory", { path: currentPath })
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }, [currentPath])

  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path)
    setPathInput(path)
    setFilter("")
  }, [])

  const goUp = useCallback(() => {
    const parent = currentPath.replace(/\/[^/]+\/?$/, "") || "/"
    navigateTo(parent)
  }, [currentPath, navigateTo])

  const goHome = useCallback(() => {
    invoke<string>("get_home_dir").then(navigateTo).catch(() => navigateTo("/"))
  }, [navigateTo])

  const handlePathSubmit = useCallback(() => {
    if (pathInput.trim()) {
      navigateTo(pathInput.trim())
    }
  }, [pathInput, navigateTo])

  const filteredEntries = filter
    ? entries.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()))
    : entries

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex w-[600px] max-h-[80vh] flex-col rounded-xl border border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold">选择 Git 仓库</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              从文件系统中选择现有仓库
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col px-5 py-4 gap-3">
          {/* Path input */}
          <div>
            <p className="text-sm font-medium mb-1.5">手动输入路径:</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handlePathSubmit()}
                className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                placeholder="/path/to/your/project"
              />
              <button
                onClick={handlePathSubmit}
                className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent"
              >
                前往
              </button>
            </div>
          </div>

          {/* Search filter */}
          <div>
            <p className="text-sm font-medium mb-1.5">搜索当前目录:</p>
            <div className="relative">
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-1.5 text-sm"
                placeholder="Filter folders and files..."
              />
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          {/* Navigation bar */}
          <div className="flex items-center gap-2">
            <button onClick={goHome} className="rounded-md border border-input p-1.5 hover:bg-accent" title="Home">
              <Home className="h-3.5 w-3.5" />
            </button>
            <button onClick={goUp} className="rounded-md border border-input p-1.5 hover:bg-accent" title="Up">
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <span className="flex-1 truncate text-sm text-muted-foreground">
              {currentPath}
            </span>
            <button
              onClick={() => onSelect(currentPath)}
              className="rounded-md border border-input px-3 py-1 text-sm hover:bg-accent"
            >
              选择当前
            </button>
          </div>

          {/* Directory listing */}
          <div className="flex-1 min-h-0 overflow-y-auto rounded-md border border-border">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                加载中...
              </div>
            ) : filteredEntries.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                没有找到文件夹
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filteredEntries.map((entry) => (
                  <button
                    key={entry.path}
                    onClick={() => {
                      if (entry.is_git_repo) {
                        onSelect(entry.path)
                      } else {
                        navigateTo(entry.path)
                      }
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent transition-colors"
                  >
                    {entry.is_git_repo ? (
                      <FolderGit2 className="h-4 w-4 shrink-0 text-blue-500" />
                    ) : (
                      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex-1 text-sm truncate">{entry.name}</span>
                    {entry.is_git_repo && (
                      <span className="shrink-0 rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                        git 仓库
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-input px-4 py-1.5 text-sm hover:bg-accent"
          >
            取消
          </button>
          <button
            onClick={() => onSelect(currentPath)}
            className="rounded-md border border-input px-4 py-1.5 text-sm hover:bg-accent"
          >
            选择路径
          </button>
        </div>
      </div>
    </div>
  )
}
