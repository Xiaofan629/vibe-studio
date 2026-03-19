"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type {
  CommitHistoryEntry,
  DiffFile,
  PrInfo,
} from "@/lib/types"
import { useReview } from "@/hooks/useReview"
import { useGit } from "@/hooks/useGit"
import { invoke } from "@/lib/tauri"
import { DiffViewer } from "@/components/diff/DiffViewer"
import { DiffFileTree } from "@/components/diff/DiffFileTree"
import { DiffToolbar } from "@/components/diff/DiffToolbar"
import { ImportRemoteCommentsDialog } from "@/components/review/ImportRemoteCommentsDialog"
import { cn } from "@/lib/utils"
import {
  GitBranch,
  History,
  Loader2,
  MessageSquare,
  Minus,
  Plus,
  RefreshCw,
  Files,
  ChevronDown,
  Check,
  Download,
} from "lucide-react"

interface ReviewPanelProps {
  files: DiffFile[]
  rawPatch: string
  sessionId: string
  repoPath: string
  baseBranch?: string | null
  headBranch?: string | null
  prInfo?: PrInfo | null
  refreshKey?: number
}

type DiffMode = "branch" | "working_tree"
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

// Git 路径解码函数，用于处理中文等非 ASCII 字符
function unescapeGitFilename(filename: string | null | undefined): string {
  if (!filename) return ""
  let cleaned = filename
  // 去除两端可能由于转义而带上的双引号
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1)
  }
  try {
    // 将八进制转义序列 \xxx 转换为 %XX，供 decodeURIComponent 还原为中文字符
    const uriEncoded = cleaned.replace(/\\([0-7]{3})/g, (_, octal) => {
      return '%' + parseInt(octal, 8).toString(16).padStart(2, '0')
    })
    // 顺便处理其他常见转义
    return decodeURIComponent(
      uriEncoded
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\')
    )
  } catch (e) {
    // 如果解码失败，降级返回原样
    return cleaned
  }
}

const COMMITTED_HEAD = "__branch_head__"
const WORKSPACE_SNAPSHOT = "__workspace_snapshot__"

function normalizeBranchName(branch: string) {
  return branch.replace(/^origin\//, "")
}

function resolvePreferredCompareBranch(
  baseBranch: string | null | undefined,
  branches: { name: string; isRemote: boolean }[]
) {
  if (!baseBranch) {
    return null
  }

  const exactMatch = branches.find((branch) => branch.name === baseBranch)
  if (exactMatch) {
    return exactMatch.name
  }

  const normalizedBase = normalizeBranchName(baseBranch)
  const remoteMatch = branches.find(
    (branch) =>
      branch.isRemote && normalizeBranchName(branch.name) === normalizedBase
  )
  if (remoteMatch) {
    return remoteMatch.name
  }

  const localMatch = branches.find(
    (branch) => normalizeBranchName(branch.name) === normalizedBase
  )
  if (localMatch) {
    return localMatch.name
  }

  return baseBranch
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

export function ReviewPanel({
  files: initialFiles,
  rawPatch: initialRawPatch,
  sessionId,
  repoPath,
  baseBranch,
  headBranch,
  prInfo,
  refreshKey = 0,
}: ReviewPanelProps) {
  const { loadComments, addComment, updateComment, resolveComment, comments } =
    useReview()
  const { branches, fetchBranches } = useGit(repoPath)

  const [diffMode, setDiffMode] = useState<DiffMode>("working_tree")
  const [compareBranch, setCompareBranch] = useState<string | null>(
    baseBranch ?? null
  )
  const [selectedCommit, setSelectedCommit] = useState<string>(COMMITTED_HEAD)
  const [commitHistory, setCommitHistory] = useState<CommitHistoryEntry[]>([])
  const [files, setFiles] = useState<DiffFile[]>(initialFiles)
  const [rawPatch, setRawPatch] = useState(initialRawPatch)
  const [selectedFile, setSelectedFile] = useState<string | null>(() => {
    const initialPath = initialFiles[0]?.newPath ?? initialFiles[0]?.oldPath ?? null
    return initialPath ? unescapeGitFilename(initialPath) : null
  })
  const [selectedCommentOnlyFile, setSelectedCommentOnlyFile] = useState<
    string | null
  >(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeDialog, setActiveDialog] = useState<"branch" | "commit" | null>(
    null
  )
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [commentingAt, setCommentingAt] = useState<{
    filePath: string
    lineNumber: number
    side: "old" | "new"
  } | null>(null)
  const [unresolvedJumpIndex, setUnresolvedJumpIndex] = useState(0)

  useEffect(() => {
    fetchBranches()
  }, [fetchBranches])

  useEffect(() => {
    if (sessionId) {
      void loadComments(sessionId)
    }
  }, [loadComments, sessionId, refreshKey])

  useEffect(() => {
    setDiffMode("working_tree")
    setCompareBranch(baseBranch ?? null)
    setSelectedCommit(COMMITTED_HEAD)
    setCommentingAt(null)
    setSelectedCommentOnlyFile(null)
    setError(null)
  }, [baseBranch, repoPath])

  useEffect(() => {
    if (initialFiles.length === 0 && !initialRawPatch) {
      return
    }

    setFiles(initialFiles)
    setRawPatch(initialRawPatch)
    setSelectedFile(
      unescapeGitFilename(initialFiles[0]?.newPath ?? initialFiles[0]?.oldPath ?? null)
    )
    setCommentingAt(null)
    setSelectedCommentOnlyFile(null)
  }, [initialFiles, initialRawPatch])

  useEffect(() => {
    const preferredBranch =
      resolvePreferredCompareBranch(baseBranch, branches) ??
      branches.find((branch) => branch.isRemote && branch.name !== headBranch)
        ?.name ??
      branches.find((branch) => branch.name !== headBranch)?.name ??
      branches[0]?.name ??
      null

    if (
      preferredBranch &&
      (!compareBranch ||
        compareBranch === baseBranch ||
        !branches.some((branch) => branch.name === compareBranch))
    ) {
      setCompareBranch(preferredBranch)
    }
  }, [baseBranch, branches, compareBranch, headBranch])

  useEffect(() => {
    if (!repoPath || !compareBranch) {
      setCommitHistory([])
      return
    }

    invoke<CommitHistoryEntry[]>("git_list_branch_commits", {
      repoPath,
      baseBranch: compareBranch,
    })
      .then((result) => setCommitHistory(result))
      .catch(() => setCommitHistory([]))
  }, [compareBranch, repoPath, refreshKey])

  useEffect(() => {
    if (!repoPath) {
      return
    }

    const loadDiff = async () => {
      setLoading(true)
      setError(null)

      try {
        if (diffMode === "working_tree" || selectedCommit === WORKSPACE_SNAPSHOT) {
          const [diffResult, patchResult] = await Promise.all([
            invoke<RawDiffFile[]>("git_diff_full", {
              repoPath,
              baseBranch: null,
            }),
            invoke<string>("git_diff_raw_patch", {
              repoPath,
              baseBranch: null,
            }),
          ])

          setFiles(diffResult.map(normalizeDiffFile))
          setRawPatch(patchResult)
          return
        }

        if (!compareBranch) {
          setFiles([])
          setRawPatch("")
          return
        }

        const toRevision =
          selectedCommit === COMMITTED_HEAD ? "HEAD" : selectedCommit

        const [diffResult, patchResult] = await Promise.all([
          invoke<RawDiffFile[]>("git_diff_full_between_revisions", {
            repoPath,
            fromRevision: compareBranch,
            toRevision,
          }),
          invoke<string>("git_diff_raw_patch_between_revisions", {
            repoPath,
            fromRevision: compareBranch,
            toRevision,
          }),
        ])

        setFiles(diffResult.map(normalizeDiffFile))
        setRawPatch(patchResult)
      } catch (err) {
        setFiles([])
        setRawPatch("")
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    }

    void loadDiff()
  }, [compareBranch, diffMode, repoPath, selectedCommit, refreshKey])

  const handleLineClick = (
    filePath: string,
    lineNumber: number,
    side: "old" | "new"
  ) => {
    setCommentingAt({ filePath, lineNumber, side })
  }

  const handleSubmitComment = async (
    content: string,
    existingCommentId?: string
  ) => {
    if (!commentingAt) {
      return
    }

    if (existingCommentId) {
      const existingComment = comments.find(
        (comment) => comment.id === existingCommentId
      )
      if (existingComment) {
        await updateComment({
          ...existingComment,
          content,
        })
      }
      setCommentingAt(null)
      return
    }

    await addComment({
      sessionId,
      filePath: commentingAt.filePath,
      lineNumber: commentingAt.lineNumber,
      side: commentingAt.side,
      content,
      codeLine: null,
      sentToAgent: true,
    })
    setCommentingAt(null)
  }

  const commentCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const comment of comments) {
      if (!comment.isResolved) {
        const decodedPath = unescapeGitFilename(comment.filePath)
        counts[decodedPath] = (counts[decodedPath] ?? 0) + 1
      }
    }
    return counts
  }, [comments])

  const diffFilePaths = useMemo(() => {
    return new Set(
      files.map((file) => unescapeGitFilename(file.newPath ?? file.oldPath ?? "unknown"))
    )
  }, [files])

  const commentOnlyPaths = useMemo(() => {
    return Array.from(
      new Set(
        comments
          .filter((comment) => !comment.isResolved)
          .map((comment) => unescapeGitFilename(comment.filePath))
          .filter((filePath) => filePath && !diffFilePaths.has(filePath))
      )
    ).sort((left, right) => left.localeCompare(right))
  }, [comments, diffFilePaths])

  const unresolvedComments = useMemo(() => {
    return [...comments]
      .filter((comment) => !comment.isResolved)
      .sort((left, right) => {
        const pathCompare = unescapeGitFilename(left.filePath).localeCompare(unescapeGitFilename(right.filePath))
        if (pathCompare !== 0) return pathCompare
        if (left.lineNumber !== right.lineNumber) {
          return left.lineNumber - right.lineNumber
        }
        return left.createdAt.localeCompare(right.createdAt)
      })
  }, [comments])

  useEffect(() => {
    const firstFile = unescapeGitFilename(files[0]?.newPath ?? files[0]?.oldPath ?? null)
    if (!selectedFile) {
      setSelectedFile(firstFile)
      return
    }

    const stillExists = files.some(
      (file) => unescapeGitFilename(file.newPath ?? file.oldPath ?? "unknown") === selectedFile
    )
    if (!stillExists) {
      setSelectedFile(firstFile)
    }
  }, [files, selectedFile])

  useEffect(() => {
    if (
      selectedCommentOnlyFile &&
      !commentOnlyPaths.includes(selectedCommentOnlyFile)
    ) {
      setSelectedCommentOnlyFile(null)
    }
  }, [commentOnlyPaths, selectedCommentOnlyFile])

  useEffect(() => {
    if (unresolvedComments.length === 0) {
      if (unresolvedJumpIndex !== 0) {
        setUnresolvedJumpIndex(0)
      }
      return
    }

    if (unresolvedJumpIndex >= unresolvedComments.length) {
      setUnresolvedJumpIndex(0)
    }
  }, [unresolvedComments, unresolvedJumpIndex])

  const diffStats = useMemo(() => {
    return files.reduce(
      (acc, file) => {
        acc.files += 1
        acc.additions += file.additions
        acc.deletions += file.deletions
        return acc
      },
      { files: 0, additions: 0, deletions: 0 }
    )
  }, [files])

  const branchOptions = useMemo(() => {
    return [...branches].sort((left, right) => {
      if (left.isRemote !== right.isRemote) {
        return left.isRemote ? -1 : 1
      }
      return left.name.localeCompare(right.name)
    })
  }, [branches])

  const selectedCommitMeta = commitHistory.find(
    (commit) => commit.sha === selectedCommit
  )
  const selectedBranchLabel = compareBranch ?? "选择对比分支"
  const selectedCommitLabel =
    selectedCommit === WORKSPACE_SNAPSHOT
      ? "当前工作区全部改动"
      : selectedCommitMeta
        ? `#${selectedCommitMeta.index} ${selectedCommitMeta.shortSha} ${selectedCommitMeta.summary}`
        : "当前分支最新提交"
  const compareSummary =
    diffMode === "working_tree" || selectedCommit === WORKSPACE_SNAPSHOT
      ? `${headBranch ?? "HEAD"} vs 未提交改动`
      : `${compareBranch ?? "请选择基线"} vs ${
          selectedCommitMeta
            ? `${selectedCommitMeta.shortSha} ${selectedCommitMeta.summary}`
            : (headBranch ?? "HEAD")
        }`

  const oldRevision =
    diffMode === "branch" &&
    selectedCommit !== WORKSPACE_SNAPSHOT &&
    compareBranch
      ? compareBranch
      : null
  const newRevision =
    diffMode === "branch" && selectedCommit !== WORKSPACE_SNAPSHOT
      ? selectedCommit === COMMITTED_HEAD
        ? "HEAD"
        : selectedCommit
      : null
  const branchDialogItems = branchOptions.map((branch) => ({
    value: branch.name,
    label: branch.name,
    meta: branch.isRemote ? "Remote branch" : "Local branch",
  }))
  const commitDialogItems = [
    {
      value: WORKSPACE_SNAPSHOT,
      label: "当前工作区全部改动",
      meta: "包含未提交、未暂存和未跟踪文件，适合看整体概览",
    },
    {
      value: COMMITTED_HEAD,
      label: "当前分支最新提交",
      meta: headBranch ?? "HEAD",
    },
    ...commitHistory.map((commit) => ({
      value: commit.sha,
      label: `#${commit.index} ${commit.shortSha} ${commit.summary}`,
      meta: commit.committedAt,
    })),
  ]
  const selectedCommentOnlyFileComments = selectedCommentOnlyFile
    ? comments.filter((comment) => !comment.isResolved && unescapeGitFilename(comment.filePath) === selectedCommentOnlyFile)
    : []
  const totalUnresolvedCount = unresolvedComments.length

  const jumpToNextComment = () => {
    if (unresolvedComments.length === 0) {
      return
    }

    const targetComment =
      unresolvedComments[unresolvedJumpIndex % unresolvedComments.length]

    const targetIsDiffFile = files.some(
      (file) =>
        unescapeGitFilename(file.newPath ?? file.oldPath ?? "unknown") === unescapeGitFilename(targetComment.filePath)
    )

    if (targetIsDiffFile) {
      setSelectedCommentOnlyFile(null)
      setSelectedFile(unescapeGitFilename(targetComment.filePath))
    } else {
      setSelectedCommentOnlyFile(unescapeGitFilename(targetComment.filePath))
    }
    setCommentingAt(null)
    setUnresolvedJumpIndex(
      (current) => (current + 1) % unresolvedComments.length
    )

    setTimeout(() => {
      document
        .getElementById(`review-comment-${targetComment.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" })
    }, 120)
  }

  return (
    <div className="relative flex h-full flex-col">
      <div className="border-b border-border bg-background/85">
        <div className="flex flex-col gap-3 px-4 py-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/10 p-3">
            <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <CompactActionButton
                  icon={<GitBranch className="h-3.5 w-3.5" />}
                  label="对比分支"
                  value={selectedBranchLabel}
                  onClick={() => setActiveDialog("branch")}
                  disabled={loading}
                />

                <CompactActionButton
                  icon={<History className="h-3.5 w-3.5" />}
                  label="查看范围"
                  value={selectedCommitLabel}
                  onClick={() => setActiveDialog("commit")}
                  disabled={loading}
                />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <DiffToolbar />
                <button
                  onClick={jumpToNextComment}
                  disabled={totalUnresolvedCount === 0}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-60"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>{totalUnresolvedCount} 条未解决评论</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    setDiffMode((current) => {
                      const next =
                        current === "working_tree" ? "branch" : "working_tree"
                      setSelectedCommit(
                        next === "working_tree"
                          ? WORKSPACE_SNAPSHOT
                          : COMMITTED_HEAD
                      )
                      return next
                    })
                    setCommentingAt(null)
                  }}
                  className={[
                    "inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-xs transition-colors",
                    diffMode === "working_tree"
                      ? "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300"
                      : "border-border bg-background hover:bg-accent",
                  ].join(" ")}
                >
                  <RefreshCw className="h-4 w-4" />
                  查看最新改动
                </button>
                <div className="inline-flex h-9 max-w-full items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground">
                  <GitBranch className="h-3.5 w-3.5" />
                  <span className="truncate">{compareSummary}</span>
                </div>
                {loading && (
                  <div className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>加载中</span>
                  </div>
                )}
                {error && (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                    {error}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                <button
                  onClick={() => setShowImportDialog(true)}
                  disabled={!sessionId || !prInfo}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs transition-colors hover:bg-accent disabled:opacity-60"
                  title={
                    prInfo
                      ? "导入远程 Git 评论"
                      : "当前分支还没有关联的 PR，无法导入评论"
                  }
                >
                  <Download className="h-3.5 w-3.5" />
                  导入 Git 评论
                </button>
                <div className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-background px-3 text-xs">
                  <Files className="h-3 w-3" />
                  {diffStats.files}
                </div>
                <div className="inline-flex h-9 items-center gap-1 rounded-lg border border-green-500/20 bg-green-500/10 px-3 text-xs text-green-600 dark:text-green-400">
                  <Plus className="h-3 w-3" />+{diffStats.additions}
                </div>
                <div className="inline-flex h-9 items-center gap-1 rounded-lg border border-red-500/20 bg-red-500/10 px-3 text-xs text-red-600 dark:text-red-400">
                  <Minus className="h-3 w-3" />-{diffStats.deletions}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-72 shrink-0 overflow-hidden border-r border-border bg-muted/10">
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1 overflow-hidden border-b border-border">
              <div className="border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                当前 Diff
              </div>
              <DiffFileTree
                files={files}
                selectedFile={selectedCommentOnlyFile ? null : selectedFile}
                onSelect={(filePath) => {
                  setSelectedCommentOnlyFile(null)
                  setSelectedFile(filePath)
                  setCommentingAt(null)
                }}
                commentCounts={commentCounts}
              />
            </div>

            {commentOnlyPaths.length > 0 && (
              <div className="min-h-[180px] max-h-[42%] overflow-hidden">
                <div className="border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  仅评论文件
                </div>
                <DiffFileTree
                  files={[]}
                  commentOnlyPaths={commentOnlyPaths}
                  selectedFile={selectedCommentOnlyFile}
                  onSelect={(filePath) => {
                    setSelectedCommentOnlyFile(filePath)
                    setCommentingAt(null)
                  }}
                  commentCounts={commentCounts}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {selectedCommentOnlyFile &&
          selectedCommentOnlyFileComments.length > 0 ? (
            <DiffViewer
              files={[
                {
                  oldPath: selectedCommentOnlyFile,
                  newPath: selectedCommentOnlyFile,
                  changeKind: "modified",
                  additions: 0,
                  deletions: 0,
                  hunks: [],
                  isBinary: false,
                  contentOmitted: false,
                },
              ]}
              rawPatch=""
              repoPath={repoPath}
              oldRevision={oldRevision}
              newRevision={newRevision}
              selectedFile={selectedCommentOnlyFile}
              comments={selectedCommentOnlyFileComments}
              onResolveComment={resolveComment}
              onUpdateComment={updateComment}
            />
          ) : (
            <DiffViewer
              files={files}
              rawPatch={rawPatch}
              repoPath={repoPath}
              oldRevision={oldRevision}
              newRevision={newRevision}
              selectedFile={selectedFile}
              comments={comments}
              commentingAt={commentingAt}
              onLineClick={handleLineClick}
              onSubmitComment={handleSubmitComment}
              onCancelComment={() => setCommentingAt(null)}
              onResolveComment={resolveComment}
              onUpdateComment={updateComment}
            />
          )}
        </div>
      </div>

      {activeDialog === "branch" && (
        <SelectionDialog
          title="选择对比分支"
          value={compareBranch ?? ""}
          items={branchDialogItems}
          onClose={() => setActiveDialog(null)}
          onSelect={(value) => {
            setCompareBranch(value || null)
            setSelectedCommit(COMMITTED_HEAD)
            setDiffMode("branch")
            setCommentingAt(null)
            setActiveDialog(null)
          }}
        />
      )}

      {activeDialog === "commit" && (
        <SelectionDialog
          title="选择查看范围"
          value={selectedCommit}
          items={commitDialogItems}
          onClose={() => setActiveDialog(null)}
          onSelect={(value) => {
            setSelectedCommit(value)
            setDiffMode(
              value === WORKSPACE_SNAPSHOT ? "working_tree" : "branch"
            )
            setCommentingAt(null)
            setActiveDialog(null)
          }}
        />
      )}

      {showImportDialog && sessionId && (
        <ImportRemoteCommentsDialog
          repoPath={repoPath}
          branch={headBranch}
          sessionId={sessionId}
          existingComments={comments}
          onClose={() => setShowImportDialog(false)}
          onImported={() => {
            void loadComments(sessionId)
          }}
        />
      )}
    </div>
  )
}

function CompactActionButton({
  icon,
  label,
  value,
  onClick,
  disabled,
}: {
  icon: ReactNode
  label: string
  value: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 max-w-full items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-xs transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[180px] truncate">{value}</span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </button>
  )
}

function SelectionDialog({
  title,
  value,
  items,
  onSelect,
  onClose,
}: {
  title: string
  value: string
  items: Array<{ value: string; label: string; meta?: string }>
  onSelect: (value: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        ref={ref}
        className="flex max-h-[72vh] w-full max-w-2xl flex-col overflow-hidden rounded-[24px] border border-border bg-background shadow-[0_32px_100px_-48px_rgba(15,23,42,0.72)]"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="text-base font-semibold">{title}</div>
          <button
            onClick={onClose}
            className="rounded-xl border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            关闭
          </button>
        </div>

        <div className="overflow-y-auto p-3">
          {items.map((item) => (
            <button
              key={item.value}
              onClick={() => onSelect(item.value)}
              className={cn(
                "flex w-full items-start gap-3 rounded-2xl px-4 py-3 text-left transition-colors",
                item.value === value
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              )}
            >
              <div className="pt-0.5">
                <Check
                  className={cn(
                    "h-4 w-4",
                    item.value === value ? "opacity-100" : "opacity-0"
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {item.label}
                </div>
                {item.meta && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.meta}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
