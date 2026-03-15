"use client"

import { useEffect, useMemo, useState } from "react"
import { invoke } from "@/lib/tauri"
import { useReview } from "@/hooks/useReview"
import { DiffViewer } from "@/components/diff/DiffViewer"
import type { DiffFile, ReviewComment } from "@/lib/types"
import {
  AlertCircle,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Loader2,
  Square,
  X,
} from "lucide-react"

interface RemoteReviewFile {
  path: string
  status: string
  additions: number
  deletions: number
  patch: string | null
}

interface RemoteReviewComment {
  id: string
  path: string
  line: number | null
  side: string | null
  body: string
  diffHunk: string | null
  author: string | null
  createdAt: string | null
}

interface RemoteReviewBundle {
  prNumber: number
  prUrl: string
  baseBranch: string
  headBranch: string
  files: RemoteReviewFile[]
  comments: RemoteReviewComment[]
}

interface ImportRemoteCommentsDialogProps {
  repoPath: string
  branch?: string | null
  sessionId: string
  existingComments: ReviewComment[]
  onClose: () => void
  onImported?: () => void
}

type RawDiffLine = {
  content: string
  kind: DiffFile["hunks"][number]["lines"][number]["kind"]
  oldLineNumber?: number | null
  newLineNumber?: number | null
  old_line_number?: number | null
  new_line_number?: number | null
}

type RawDiffHunk = {
  oldStart?: number
  old_start?: number
  oldLines?: number
  old_lines?: number
  newStart?: number
  new_start?: number
  newLines?: number
  new_lines?: number
  header: string
  lines: RawDiffLine[]
}

type RawDiffFile = {
  oldPath?: string | null
  old_path?: string | null
  newPath?: string | null
  new_path?: string | null
  changeKind?: DiffFile["changeKind"]
  change_kind?: DiffFile["changeKind"]
  additions?: number
  deletions?: number
  hunks?: RawDiffHunk[]
  isBinary?: boolean
  is_binary?: boolean
  contentOmitted?: boolean
  content_omitted?: boolean
}

type CommentFileEntry = {
  path: string
  status: string
  additions: number
  deletions: number
  patch: string | null
  comments: RemoteReviewComment[]
}

function normalizeDiffFile(file: RawDiffFile): DiffFile {
  return {
    oldPath: file.oldPath ?? file.old_path ?? null,
    newPath: file.newPath ?? file.new_path ?? null,
    changeKind: file.changeKind ?? file.change_kind ?? "modified",
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
    hunks: (file.hunks ?? []).map((hunk) => ({
      oldStart: hunk.oldStart ?? hunk.old_start ?? 0,
      oldLines: hunk.oldLines ?? hunk.old_lines ?? 0,
      newStart: hunk.newStart ?? hunk.new_start ?? 0,
      newLines: hunk.newLines ?? hunk.new_lines ?? 0,
      header: hunk.header,
      lines: (hunk.lines ?? []).map((line) => ({
        content: line.content,
        kind: line.kind,
        oldLineNumber: line.oldLineNumber ?? line.old_line_number ?? null,
        newLineNumber: line.newLineNumber ?? line.new_line_number ?? null,
      })),
    })),
    isBinary: file.isBinary ?? file.is_binary ?? false,
    contentOmitted: file.contentOmitted ?? file.content_omitted ?? false,
  }
}

function normalizeSide(side: string | null): "old" | "new" {
  return side?.toUpperCase() === "LEFT" ? "old" : "new"
}

function toPreviewComment(
  sessionId: string,
  comment: RemoteReviewComment
): ReviewComment | null {
  if (!comment.line) {
    return null
  }

  return {
    id: `remote-${comment.id}`,
    sessionId,
    filePath: comment.path,
    lineNumber: comment.line,
    side: normalizeSide(comment.side),
    content: comment.body,
    codeLine: null,
    isResolved: false,
    sentToAgent: true,
    createdAt: comment.createdAt ?? new Date().toISOString(),
    updatedAt: comment.createdAt ?? new Date().toISOString(),
  }
}

export function ImportRemoteCommentsDialog({
  repoPath,
  branch,
  sessionId,
  existingComments,
  onClose,
  onImported,
}: ImportRemoteCommentsDialogProps) {
  const { importComments } = useReview()
  const [bundle, setBundle] = useState<RemoteReviewBundle | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>(
    {}
  )
  const [previewFiles, setPreviewFiles] = useState<DiffFile[]>([])
  const [previewPatch, setPreviewPatch] = useState("")
  const [loading, setLoading] = useState(true)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setNotice(null)

    invoke<RemoteReviewBundle>("git_get_remote_review_bundle", {
      repoPath,
      branch: branch ?? null,
    })
      .then((result) => {
        const commentPaths = Array.from(
          new Set(
            result.comments.map((comment) => comment.path).filter(Boolean)
          )
        )
        setBundle(result)
        setSelectedIds(new Set(result.comments.map((comment) => comment.id)))
        setSelectedFile(commentPaths[0] ?? null)
        setExpandedFiles(
          Object.fromEntries(commentPaths.map((path) => [path, true]))
        )
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setLoading(false))
  }, [branch, repoPath])

  const comparisonBaseRevision = useMemo(() => {
    if (!bundle?.baseBranch) return null
    return bundle.baseBranch.startsWith("origin/")
      ? bundle.baseBranch
      : `origin/${bundle.baseBranch}`
  }, [bundle?.baseBranch])

  const comparisonHeadRevision = useMemo(() => {
    return branch ?? bundle?.headBranch ?? "HEAD"
  }, [branch, bundle?.headBranch])

  useEffect(() => {
    if (!comparisonBaseRevision || !comparisonHeadRevision) {
      setPreviewFiles([])
      setPreviewPatch("")
      return
    }

    setLoadingPreview(true)

    Promise.all([
      invoke<RawDiffFile[]>("git_diff_full_between_revisions", {
        repoPath,
        fromRevision: comparisonBaseRevision,
        toRevision: comparisonHeadRevision,
      }),
      invoke<string>("git_diff_raw_patch_between_revisions", {
        repoPath,
        fromRevision: comparisonBaseRevision,
        toRevision: comparisonHeadRevision,
      }),
    ])
      .then(([files, patch]) => {
        setPreviewFiles(files.map(normalizeDiffFile))
        setPreviewPatch(patch)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setLoadingPreview(false))
  }, [comparisonBaseRevision, comparisonHeadRevision, repoPath])

  const fileEntries = useMemo<CommentFileEntry[]>(() => {
    if (!bundle) return []

    const metadataByPath = new Map(
      bundle.files.map((file) => [
        file.path,
        {
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          patch: file.patch,
        },
      ])
    )

    const grouped = new Map<string, RemoteReviewComment[]>()
    for (const comment of bundle.comments) {
      if (!comment.path) continue
      const list = grouped.get(comment.path) ?? []
      list.push(comment)
      grouped.set(comment.path, list)
    }

    return Array.from(grouped.entries())
      .map(([path, comments]) => {
        const metadata = metadataByPath.get(path)
        return {
          path,
          status: metadata?.status ?? "comment-only",
          additions: metadata?.additions ?? 0,
          deletions: metadata?.deletions ?? 0,
          patch: metadata?.patch ?? null,
          comments,
        }
      })
      .sort((left, right) => left.path.localeCompare(right.path))
  }, [bundle])

  const selectedEntry = useMemo(() => {
    if (!selectedFile) return null
    return fileEntries.find((file) => file.path === selectedFile) ?? null
  }, [fileEntries, selectedFile])

  const selectedPreviewFiles = useMemo(() => {
    if (!selectedFile) return []

    const matchedFiles = previewFiles.filter(
      (file) => (file.newPath ?? file.oldPath ?? "unknown") === selectedFile
    )

    if (matchedFiles.length > 0 || !(selectedEntry?.comments.length)) {
      return matchedFiles
    }

    return [
      {
        oldPath: selectedFile,
        newPath: selectedFile,
        changeKind: "modified" as const,
        additions: selectedEntry?.additions ?? 0,
        deletions: selectedEntry?.deletions ?? 0,
        hunks: [],
        isBinary: false,
        contentOmitted: false,
      },
    ]
  }, [previewFiles, selectedEntry, selectedFile])

  const selectedPreviewComments = useMemo(() => {
    return (selectedEntry?.comments ?? [])
      .map((comment) => toPreviewComment(sessionId, comment))
      .filter((comment): comment is ReviewComment => comment !== null)
  }, [selectedEntry?.comments, sessionId])

  const handleToggle = (commentId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(commentId)) {
        next.delete(commentId)
      } else {
        next.add(commentId)
      }
      return next
    })
  }

  const handleToggleFile = (comments: RemoteReviewComment[]) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      const allSelected =
        comments.length > 0 && comments.every((comment) => next.has(comment.id))

      comments.forEach((comment) => {
        if (allSelected) {
          next.delete(comment.id)
        } else {
          next.add(comment.id)
        }
      })

      return next
    })
  }

  const handleImport = async () => {
    if (!bundle) {
      return
    }

    const selectedComments = bundle.comments.filter((comment) =>
      selectedIds.has(comment.id)
    )

    if (selectedComments.length === 0) {
      setError("先选择至少一条要导入的评论。")
      setNotice(null)
      return
    }

    const commentsToCreate = selectedComments.filter((comment) => {
      const existing = existingComments.find(
        (item) =>
          item.filePath === comment.path &&
          item.lineNumber === (comment.line ?? 1) &&
          item.side === normalizeSide(comment.side) &&
          item.content === comment.body
      )

      return !existing
    })
    const skippedDuplicates = selectedComments.length - commentsToCreate.length

    if (commentsToCreate.length === 0) {
      setError(null)
      setNotice(
        skippedDuplicates > 0
          ? `检测到 ${skippedDuplicates} 条重复评论，已跳过。`
          : "没有可导入的评论。"
      )
      return
    }

    setSubmitting(true)
    setError(null)
    setNotice(null)

    try {
      await importComments(
        commentsToCreate.map((comment) => ({
          sessionId,
          filePath: comment.path,
          lineNumber: comment.line ?? 1,
          side: normalizeSide(comment.side),
          content: comment.body,
          codeLine: null,
          sentToAgent: true,
        }))
      )

      onImported?.()

      if (skippedDuplicates > 0) {
        setNotice(
          `已导入 ${commentsToCreate.length} 条评论，${skippedDuplicates} 条重复评论已跳过。`
        )
        return
      }

      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setNotice(null)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-border bg-background shadow-[0_32px_100px_-48px_rgba(15,23,42,0.72)]">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">导入远程 Git 评论</h2>
            {bundle && (
              <p className="text-sm text-muted-foreground">
                PR #{bundle.prNumber} · {bundle.comments.length} 条评论
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[320px_1fr]">
          <div className="min-h-0 overflow-y-auto border-r border-border bg-muted/15 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium">导入范围</span>
              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={() =>
                    setSelectedIds(
                      new Set(
                        bundle?.comments.map((comment) => comment.id) ?? []
                      )
                    )
                  }
                  disabled={loading || !bundle}
                  className="rounded-md border border-border px-2 py-1 hover:bg-accent disabled:opacity-60"
                >
                  全选
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  disabled={loading || !bundle}
                  className="rounded-md border border-border px-2 py-1 hover:bg-accent disabled:opacity-60"
                >
                  清空
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在拉取远程评论...
              </div>
            ) : !bundle || fileEntries.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                当前没有可导入的远程评论。
              </div>
            ) : (
              <div className="space-y-2">
                {fileEntries.map((file) => {
                  const expanded = expandedFiles[file.path] ?? true
                  const allSelected =
                    file.comments.length > 0 &&
                    file.comments.every((comment) =>
                      selectedIds.has(comment.id)
                    )
                  const partiallySelected =
                    !allSelected &&
                    file.comments.some((comment) => selectedIds.has(comment.id))

                  return (
                    <div
                      key={file.path}
                      className="rounded-xl border border-border bg-background"
                    >
                      <div className="flex items-center gap-2 px-3 py-2">
                        <button
                          onClick={() =>
                            setExpandedFiles((current) => ({
                              ...current,
                              [file.path]: !expanded,
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
                          onClick={() => handleToggleFile(file.comments)}
                          className="text-muted-foreground"
                        >
                          {allSelected ? (
                            <CheckSquare className="h-4 w-4 text-blue-600" />
                          ) : partiallySelected ? (
                            <div className="flex h-4 w-4 items-center justify-center rounded-sm border border-border bg-accent text-[10px] text-foreground">
                              -
                            </div>
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => setSelectedFile(file.path)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="truncate text-sm font-medium">
                            {file.path}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            <span>{file.status}</span>
                            <span>+{file.additions}</span>
                            <span>-{file.deletions}</span>
                            <span>{file.comments.length} 条评论</span>
                          </div>
                        </button>
                      </div>

                      {expanded && (
                        <div className="border-t border-border px-3 py-2">
                          <div className="space-y-1">
                            {file.comments.map((comment) => (
                              <button
                                key={comment.id}
                                onClick={() => {
                                  handleToggle(comment.id)
                                  setSelectedFile(file.path)
                                }}
                                className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent"
                              >
                                {selectedIds.has(comment.id) ? (
                                  <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                                ) : (
                                  <Square className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-xs text-muted-foreground">
                                    {comment.line
                                      ? `line ${comment.line}`
                                      : "unmatched"}{" "}
                                    · {comment.author ?? "unknown"}
                                  </div>
                                  <div className="mt-1 line-clamp-2 text-xs text-foreground">
                                    {comment.body}
                                  </div>
                                </div>
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
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1">
                  <GitBranch className="h-3.5 w-3.5" />
                  {comparisonBaseRevision ?? "base"} vs{" "}
                  {comparisonHeadRevision ?? "head"}
                </span>
                {selectedEntry && (
                  <>
                    <span className="rounded-md border border-border bg-background px-2.5 py-1">
                      {selectedEntry.path}
                    </span>
                    <span className="rounded-md border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-green-600 dark:text-green-400">
                      +{selectedEntry.additions}
                    </span>
                    <span className="rounded-md border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-red-600 dark:text-red-400">
                      -{selectedEntry.deletions}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="h-[calc(88vh-141px)]">
              {error ? (
                <div className="p-5">
                  <div className="flex items-start gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    {error}
                  </div>
                </div>
              ) : loadingPreview ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在加载 diff 预览...
                </div>
              ) : !selectedFile ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  选择左侧文件查看远程 diff 与评论。
                </div>
              ) : selectedPreviewFiles.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  当前文件没有可预览的 diff，但可以继续导入左侧勾选的评论。
                </div>
              ) : (
                <DiffViewer
                  files={selectedPreviewFiles}
                  rawPatch={selectedEntry?.patch ?? previewPatch}
                  repoPath={repoPath}
                  oldRevision={comparisonBaseRevision}
                  newRevision={comparisonHeadRevision}
                  selectedFile={selectedFile}
                  comments={selectedPreviewComments}
                  commentVariant="compact"
                />
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-border px-6 py-4">
          {(error || notice) && (
            <div
              className={[
                "mb-3 flex items-start gap-2 rounded-2xl px-4 py-3 text-sm",
                error
                  ? "border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              ].join(" ")}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error ?? notice}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-accent"
            >
              取消
            </button>
            <button
              onClick={() => void handleImport()}
              disabled={loading || submitting}
              className="rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              {submitting ? "导入中..." : "一键导入"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
