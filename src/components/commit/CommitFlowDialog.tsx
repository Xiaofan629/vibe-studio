"use client"

import { useEffect, useMemo, useState } from "react"
import { invoke } from "@/lib/tauri"
import { useCommit } from "@/hooks/useCommit"
import { DiffViewer } from "@/components/diff/DiffViewer"
import { DiffStats } from "@/components/diff/DiffStats"
import type { AgentType, DiffFile, PrInfo } from "@/lib/types"
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
  Upload,
  Copy,
} from "lucide-react"

interface CommitFlowDialogProps {
  repoPath: string
  headBranch?: string | null
  prInfo?: PrInfo | null
  prBranch?: string | null
  agentType?: AgentType
  workspaceTitle?: string | null
  workspacePrompt?: string | null
  refreshKey?: number
  onClose: () => void
  onCommitted?: () => void
  onRequestCreatePr?: () => void
}

type FileSelection = {
  checked: boolean
  hunkChecks: boolean[]
}

type RawPatchFile = {
  oldPath: string | null
  newPath: string | null
  headerLines: string[]
  hunkBlocks: string[][]
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

function splitGitHeaderTokens(input: string) {
  const tokens: string[] = []
  let current = ""
  let inQuotes = false
  let escaping = false

  for (const char of input) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === "\\" && inQuotes) {
      escaping = true
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === " " && !inQuotes) {
      if (current) {
        tokens.push(current)
        current = ""
      }
      continue
    }

    current += char
  }

  if (current) {
    tokens.push(current)
  }

  return tokens
}

function unquoteGitPath(path: string) {
  const trimmed = path.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed
      .slice(1, -1)
      .replace(/\\\\/g, "\\")
      .replace(/\\"/g, '"')
  }
  return trimmed
}

function stripDiffPrefix(path: string, prefix: "a" | "b") {
  const normalized = unquoteGitPath(path)
  const expected = `${prefix}/`
  return normalized.startsWith(expected)
    ? normalized.slice(expected.length)
    : normalized
}

function parsePatchPathLine(line: string, prefix: "--- " | "+++ ") {
  const path = line.slice(prefix.length).trim()
  if (path === "/dev/null") {
    return null
  }

  const normalized = unquoteGitPath(path)
  if (normalized.startsWith("a/") || normalized.startsWith("b/")) {
    return normalized.slice(2)
  }
  return normalized
}

function parseDiffHeaderPaths(line: string) {
  const stripped = line.replace(/^diff --git\s+/, "")
  const tokens = splitGitHeaderTokens(stripped)
  return {
    oldPath: tokens[0] ? stripDiffPrefix(tokens[0], "a") : null,
    newPath: tokens[1] ? stripDiffPrefix(tokens[1], "b") : null,
  }
}

function parseRawPatchFiles(rawPatch: string): RawPatchFile[] {
  if (!rawPatch.trim()) {
    return []
  }

  const lines = rawPatch.split("\n")
  if (lines[lines.length - 1] === "") {
    lines.pop()
  }

  const files: RawPatchFile[] = []
  let currentFile: RawPatchFile | null = null
  let currentHunk: string[] | null = null

  const flushHunk = () => {
    if (currentFile && currentHunk) {
      currentFile.hunkBlocks.push(currentHunk)
      currentHunk = null
    }
  }

  const flushFile = () => {
    if (!currentFile) return
    flushHunk()
    files.push(currentFile)
    currentFile = null
  }

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flushFile()
      const { oldPath, newPath } = parseDiffHeaderPaths(line)
      currentFile = {
        oldPath,
        newPath,
        headerLines: [line],
        hunkBlocks: [],
      }
      continue
    }

    if (!currentFile) {
      continue
    }

    if (line.startsWith("@@")) {
      flushHunk()
      currentHunk = [line]
      continue
    }

    if (currentHunk) {
      currentHunk.push(line)
      continue
    }

    currentFile.headerLines.push(line)

    if (line.startsWith("--- ")) {
      currentFile.oldPath = parsePatchPathLine(line, "--- ")
    } else if (line.startsWith("+++ ")) {
      currentFile.newPath = parsePatchPathLine(line, "+++ ")
    } else if (line.startsWith("rename from ")) {
      currentFile.oldPath = unquoteGitPath(line.slice("rename from ".length))
    } else if (line.startsWith("rename to ")) {
      currentFile.newPath = unquoteGitPath(line.slice("rename to ".length))
    }
  }

  flushFile()
  return files
}

function buildPatch(
  files: DiffFile[],
  selections: Record<string, FileSelection>,
  rawPatchFiles: RawPatchFile[]
) {
  const fileChunks: string[] = []

  files.forEach((file, fileIndex) => {
    const filePath = getFilePath(file, fileIndex)
    const selection = selections[filePath]
    if (!selection?.checked) return

    const selectedHunks = file.hunks.filter(
      (_, hunkIndex) => selection.hunkChecks[hunkIndex]
    )
    if (selectedHunks.length === 0) return

    const rawPatchFile = rawPatchFiles[fileIndex]
    if (
      rawPatchFile &&
      (rawPatchFile.newPath ?? rawPatchFile.oldPath) === filePath &&
      rawPatchFile.hunkBlocks.length >= file.hunks.length
    ) {
      const chunks: string[] = []
      chunks.push(...rawPatchFile.headerLines)
      rawPatchFile.hunkBlocks.forEach((hunkLines, hunkIndex) => {
        if (selection.hunkChecks[hunkIndex]) {
          // 保留原始的 hunk 内容，包括空行和元数据
          chunks.push(...hunkLines)
        }
      })
      // 保持原始换行符格式
      fileChunks.push(chunks.join("\n"))
      return
    }

    const chunks: string[] = []
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
    fileChunks.push(chunks.join("\n"))
  })

  // 确保文件之间有正确的分隔，整个 patch 以换行符结尾
  const patch = fileChunks.join("\n")
  return patch.endsWith("\n") ? patch : patch + "\n"
}

export function CommitFlowDialog({
  repoPath,
  headBranch,
  prInfo,
  prBranch,
  agentType,
  workspaceTitle,
  workspacePrompt,
  refreshKey = 0,
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
    commitSelectedAndPush,
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
  const [copied, setCopied] = useState(false)
  const [rawPatch, setRawPatch] = useState("")
  const pushTargetBranch = prBranch ?? null

  useEffect(() => {
    setLoadingDiff(true)
    setError(null)
    Promise.all([
      invoke<any[]>("git_diff_full", { repoPath, baseBranch: null }),
      invoke<string>("git_diff_raw_patch", { repoPath, baseBranch: null }),
    ])
      .then(([rawDiffFiles, rawPatchText]) => {
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

        setRawPatch(rawPatchText)
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
  }, [repoPath, refreshKey])

  const rawPatchFiles = useMemo(() => parseRawPatchFiles(rawPatch), [rawPatch])

  const selectedPatch = useMemo(
    () => buildPatch(files, selections, rawPatchFiles),
    [files, selections, rawPatchFiles]
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

  const handleCommitAndPush = async () => {
    if (!selectedPatch.trim()) {
      setError("还没有选择任何提交内容，请先勾选文件或代码块。")
      return
    }

    try {
      setError(null)
      const message = commitBody.trim()
        ? `${commitTitle.trim()}\n\n${commitBody.trim()}`
        : commitTitle.trim()
      await commitSelectedAndPush(message, selectedPatch, pushTargetBranch)
      onCommitted?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

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
              <div className="text-sm font-medium">当前提交范围预览</div>
              <div className="mt-1 text-xs text-muted-foreground">
                这里展示的是当前勾选范围内的全部变更。点击左侧文件会滚动定位，但不会缩小提交范围。
              </div>
            </div>
            <div className="h-[calc(88vh-73px)]">
              <DiffViewer
                files={selectedFiles}
                rawPatch={selectedPatch}
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
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-700 dark:text-amber-300">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1 line-clamp-2">
                      {error}
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(error)
                        setCopied(true)
                        setTimeout(() => setCopied(false), 2000)
                      }}
                      className="shrink-0 rounded px-2 py-1 text-xs opacity-70 hover:opacity-100"
                      title="复制错误信息"
                    >
                      {copied ? "已复制" : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
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
                {prInfo && pushTargetBranch && (
                  <button
                    onClick={() => void handleCommitAndPush()}
                    disabled={
                      loading || !commitTitle.trim() || !selectedPatch.trim()
                    }
                    className="flex items-center gap-2 rounded-md border border-input px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
                    title={
                      headBranch && pushTargetBranch !== headBranch
                        ? `推送到远端分支 ${pushTargetBranch}`
                        : undefined
                    }
                  >
                    {loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    提交并推送
                  </button>
                )}
                {prInfo === null && (
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
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
