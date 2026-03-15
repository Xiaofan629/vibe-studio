"use client"

import { useEffect, useMemo, useState } from "react"
import { invoke } from "@/lib/tauri"
import { useCommit } from "@/hooks/useCommit"
import { DiffViewer } from "@/components/diff/DiffViewer"
import { DiffStats } from "@/components/diff/DiffStats"
import type { AgentType, DiffFile } from "@/lib/types"
import {
  AlertCircle,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  GitCommit,
  Loader2,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react"

interface CommitFlowDialogProps {
  repoPath: string
  agentType?: AgentType
  workspaceTitle?: string | null
  workspacePrompt?: string | null
  onClose: () => void
  onCommitted?: () => void
  onRequestCreatePr?: () => void
}

type FileSelection = {
  checked: boolean
  hunkChecks: boolean[]
}

function getFilePath(file: DiffFile, index: number) {
  return file.newPath ?? file.oldPath ?? `unknown-${index}`
}

function patchPath(path: string | null | undefined, prefix: "a" | "b") {
  return path ? `${prefix}/${path}` : "/dev/null"
}

function linePrefix(kind: DiffFile["hunks"][number]["lines"][number]["kind"]) {
  switch (kind) {
    case "addition":
      return "+"
    case "deletion":
      return "-"
    default:
      return " "
  }
}

function buildPatch(
  files: DiffFile[],
  selections: Record<string, FileSelection>
) {
  const chunks: string[] = []

  files.forEach((file, fileIndex) => {
    const filePath = getFilePath(file, fileIndex)
    const selection = selections[filePath]
    if (!selection?.checked) return

    const selectedHunks = file.hunks.filter(
      (_, hunkIndex) => selection.hunkChecks[hunkIndex]
    )
    if (selectedHunks.length === 0) return

    chunks.push(
      `diff --git ${patchPath(file.oldPath ?? file.newPath, "a")} ${patchPath(file.newPath ?? file.oldPath, "b")}`
    )

    if (file.changeKind === "added") {
      chunks.push("new file mode 100644")
    }
    if (file.changeKind === "deleted") {
      chunks.push("deleted file mode 100644")
    }

    chunks.push(`--- ${patchPath(file.oldPath, "a")}`)
    chunks.push(`+++ ${patchPath(file.newPath, "b")}`)

    selectedHunks.forEach((hunk) => {
      chunks.push(hunk.header)
      hunk.lines.forEach((line) => {
        chunks.push(`${linePrefix(line.kind)}${line.content}`)
      })
    })
  })

  return chunks.length > 0 ? `${chunks.join("\n")}\n` : ""
}

export function CommitFlowDialog({
  repoPath,
  agentType,
  workspaceTitle,
  workspacePrompt,
  onClose,
  onCommitted,
  onRequestCreatePr,
}: CommitFlowDialogProps) {
  const {
    commitTitle,
    setCommitTitle,
    commitBody,
    setCommitBody,
    loading,
    generateCommitMessageFromPatch,
    commitSelected,
  } = useCommit(repoPath, {
    agentType,
    workspaceTitle,
    workspacePrompt,
  })

  const [files, setFiles] = useState<DiffFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [selections, setSelections] = useState<Record<string, FileSelection>>(
    {}
  )
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>(
    {}
  )
  const [loadingDiff, setLoadingDiff] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoadingDiff(true)
    setError(null)
    invoke<any[]>("git_diff_full", { repoPath, baseBranch: null })
      .then((rawDiffFiles) => {
        const normalizedFiles: DiffFile[] = rawDiffFiles.map((f) => ({
          oldPath: f.old_path ?? f.oldPath ?? null,
          newPath: f.new_path ?? f.newPath ?? null,
          changeKind: f.change_kind ?? f.changeKind ?? "modified",
          additions: f.additions ?? 0,
          deletions: f.deletions ?? 0,
          hunks: (f.hunks ?? []).map((h: any) => ({
            oldStart: h.old_start ?? h.oldStart ?? 0,
            oldLines: h.old_lines ?? h.oldLines ?? 0,
            newStart: h.new_start ?? h.newStart ?? 0,
            newLines: h.new_lines ?? h.newLines ?? 0,
            header: h.header ?? "",
            lines: (h.lines ?? []).map((l: any) => ({
              content: l.content ?? "",
              kind: l.kind ?? "context",
              oldLineNumber: l.old_line_number ?? l.oldLineNumber ?? null,
              newLineNumber: l.new_line_number ?? l.newLineNumber ?? null,
            })),
          })),
          isBinary: f.is_binary ?? f.isBinary ?? false,
          contentOmitted: f.content_omitted ?? f.contentOmitted ?? false,
        }))

        setFiles(normalizedFiles)
        setSelectedFile(
          normalizedFiles[0] ? getFilePath(normalizedFiles[0], 0) : null
        )

        setSelections(
          Object.fromEntries(
            normalizedFiles.map((file, index) => [
              getFilePath(file, index),
              {
                checked: true,
                hunkChecks: file.hunks.map(() => true),
              },
            ])
          )
        )

        setExpandedFiles(
          Object.fromEntries(
            normalizedFiles.map((file, index) => [
              getFilePath(file, index),
              true,
            ])
          )
        )
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setLoadingDiff(false))
  }, [repoPath])

  const selectedPatch = useMemo(
    () => buildPatch(files, selections),
    [files, selections]
  )

  const selectedFiles = useMemo(() => {
    return files.filter((file, index) => {
      const selection = selections[getFilePath(file, index)]
      return selection?.checked && selection.hunkChecks.some(Boolean)
    })
  }, [files, selections])

  useEffect(() => {
    const firstSelectedFile =
      selectedFiles[0]?.newPath ?? selectedFiles[0]?.oldPath ?? null

    if (!selectedFile) {
      setSelectedFile(firstSelectedFile)
      return
    }

    const stillSelected = selectedFiles.some(
      (file) => (file.newPath ?? file.oldPath) === selectedFile
    )

    if (!stillSelected) {
      setSelectedFile(firstSelectedFile)
    }
  }, [selectedFile, selectedFiles])

  const handleToggleFile = (filePath: string, checked: boolean) => {
    setSelections((current) => {
      const next = { ...current }
      const entry = next[filePath]
      if (!entry) return current
      next[filePath] = {
        checked,
        hunkChecks: entry.hunkChecks.map(() => checked),
      }
      return next
    })
  }

  const handleToggleHunk = (
    filePath: string,
    hunkIndex: number,
    checked: boolean
  ) => {
    setSelections((current) => {
      const next = { ...current }
      const entry = next[filePath]
      if (!entry) return current
      const hunkChecks = [...entry.hunkChecks]
      hunkChecks[hunkIndex] = checked
      next[filePath] = {
        checked: hunkChecks.some(Boolean),
        hunkChecks,
      }
      return next
    })
  }

  const handleGenerate = async () => {
    if (!selectedPatch.trim()) {
      setError("先选择至少一段要提交的改动。")
      return
    }

    try {
      setError(null)
      await generateCommitMessageFromPatch(selectedPatch)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleCommit = async (requestPr: boolean) => {
    if (!selectedPatch.trim()) {
      setError("还没有选择任何提交内容，请先勾选文件或代码块。")
      return
    }

    try {
      setError(null)
      const message = commitBody.trim()
        ? `${commitTitle.trim()}\n\n${commitBody.trim()}`
        : commitTitle.trim()
      await commitSelected(message, selectedPatch)
      onCommitted?.()
      onClose()
      if (requestPr) {
        onRequestCreatePr?.()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const currentPreviewFiles = useMemo(() => {
    if (!selectedFile) return []
    return files.filter(
      (file, index) => getFilePath(file, index) === selectedFile
    )
  }, [files, selectedFile])

  const currentPreviewPatch = useMemo(() => {
    if (!selectedFile) return ""
    return buildPatch(
      files.filter((file, index) => getFilePath(file, index) === selectedFile),
      selections
    )
  }, [files, selectedFile, selections])

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="flex h-[88vh] w-full max-w-7xl flex-col overflow-hidden rounded-[28px] border border-border bg-background shadow-[0_32px_100px_-48px_rgba(15,23,42,0.72)]">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">提交改动</h2>
            <p className="text-sm text-muted-foreground">
              先勾选要提交的代码块，再生成提交信息。
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[320px_1fr_420px]">
          <div className="min-h-0 overflow-y-auto border-r border-border bg-muted/15 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium">提交范围</span>
              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={() => {
                    setSelections(
                      Object.fromEntries(
                        files.map((file, index) => [
                          getFilePath(file, index),
                          {
                            checked: true,
                            hunkChecks: file.hunks.map(() => true),
                          },
                        ])
                      )
                    )
                  }}
                  className="rounded-md border border-border px-2 py-1 hover:bg-accent"
                >
                  全选
                </button>
                <button
                  onClick={() => {
                    setSelections(
                      Object.fromEntries(
                        files.map((file, index) => [
                          getFilePath(file, index),
                          {
                            checked: false,
                            hunkChecks: file.hunks.map(() => false),
                          },
                        ])
                      )
                    )
                  }}
                  className="rounded-md border border-border px-2 py-1 hover:bg-accent"
                >
                  清空
                </button>
              </div>
            </div>

            {loadingDiff ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载改动中...
              </div>
            ) : files.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                当前没有可提交的未提交改动。
              </div>
            ) : (
              <div className="space-y-2">
                {files.map((file, fileIndex) => {
                  const filePath = getFilePath(file, fileIndex)
                  const selection = selections[filePath]
                  const expanded = expandedFiles[filePath] ?? true

                  return (
                    <div
                      key={filePath}
                      className="rounded-xl border border-border bg-background"
                    >
                      <div className="flex items-center gap-2 px-3 py-2">
                        <button
                          onClick={() =>
                            setExpandedFiles((current) => ({
                              ...current,
                              [filePath]: !expanded,
                            }))
                          }
                          className="text-muted-foreground"
                        >
                          {expanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() =>
                            handleToggleFile(filePath, !selection?.checked)
                          }
                          className="text-muted-foreground"
                        >
                          {selection?.checked ? (
                            <CheckSquare className="h-4 w-4 text-blue-600" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => setSelectedFile(filePath)}
                          className="min-w-0 flex-1 truncate text-left text-sm font-medium"
                        >
                          {filePath}
                        </button>
                      </div>

                      {expanded && (
                        <div className="border-t border-border px-3 py-2">
                          <div className="space-y-1">
                            {file.hunks.map((hunk, hunkIndex) => (
                              <button
                                key={`${filePath}-${hunkIndex}`}
                                onClick={() => {
                                  handleToggleHunk(
                                    filePath,
                                    hunkIndex,
                                    !selection?.hunkChecks[hunkIndex]
                                  )
                                  setSelectedFile(filePath)
                                }}
                                className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent"
                              >
                                {selection?.hunkChecks[hunkIndex] ? (
                                  <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                                ) : (
                                  <Square className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                )}
                                <span className="truncate text-xs text-muted-foreground">
                                  {hunk.header}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="min-h-0 overflow-hidden border-r border-border">
            <div className="border-b border-border px-4 py-3">
              <div className="text-sm font-medium">改动预览</div>
              <div className="mt-1 text-xs text-muted-foreground">
                当前预览的是选中的文件，右侧提交信息只会基于勾选的 patch 生成。
              </div>
            </div>
            <div className="h-[calc(88vh-73px)]">
              <DiffViewer
                files={currentPreviewFiles}
                rawPatch={currentPreviewPatch}
                repoPath={repoPath}
                selectedFile={selectedFile}
              />
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto p-5">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-lg font-semibold">
                <GitCommit className="h-5 w-5" />
                AI 提交信息
              </div>

              <DiffStats files={selectedFiles} />

              <button
                onClick={() => void handleGenerate()}
                disabled={loading || !selectedPatch.trim()}
                className="flex items-center gap-2 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                生成 AI 提交信息
              </button>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  提交标题
                </label>
                <input
                  type="text"
                  value={commitTitle}
                  onChange={(e) => setCommitTitle(e.target.value)}
                  placeholder="feat: update selected changes"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  提交描述
                </label>
                <textarea
                  value={commitBody}
                  onChange={(e) => setCommitBody(e.target.value)}
                  rows={8}
                  className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-700 dark:text-amber-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => void handleCommit(false)}
                  disabled={
                    loading || !commitTitle.trim() || !selectedPatch.trim()
                  }
                  className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <GitCommit className="h-3.5 w-3.5" />
                  )}
                  提交
                </button>
                <button
                  onClick={() => void handleCommit(true)}
                  disabled={
                    loading || !commitTitle.trim() || !selectedPatch.trim()
                  }
                  className="flex items-center gap-2 rounded-md border border-input px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  提交并创建 PR
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
