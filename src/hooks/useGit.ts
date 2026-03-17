"use client"

import { useCallback, useState } from "react"
import { invoke } from "@/lib/tauri"
import type { GitBranch, DiffFile } from "@/lib/types"

type RawGitBranch = GitBranch & {
  is_remote?: boolean
  is_current?: boolean
  last_commit_sha?: string | null
  last_commit_message?: string | null
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
  additions: number
  deletions: number
  hunks: RawDiffHunk[]
  isBinary?: boolean
  is_binary?: boolean
  contentOmitted?: boolean
  content_omitted?: boolean
}

function normalizeDiffFile(file: RawDiffFile): DiffFile {
  return {
    oldPath: file.oldPath ?? file.old_path ?? null,
    newPath: file.newPath ?? file.new_path ?? null,
    changeKind: file.changeKind ?? file.change_kind ?? "modified",
    additions: file.additions,
    deletions: file.deletions,
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

function normalizeBranch(branch: RawGitBranch): GitBranch {
  return {
    name: branch.name,
    isRemote: branch.isRemote ?? branch.is_remote ?? false,
    isCurrent: branch.isCurrent ?? branch.is_current ?? false,
    lastCommitSha: branch.lastCommitSha ?? branch.last_commit_sha ?? null,
    lastCommitMessage:
      branch.lastCommitMessage ?? branch.last_commit_message ?? null,
  }
}

export function useGit(repoPath: string | null) {
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [currentBranch, setCurrentBranch] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchBranches = useCallback(async () => {
    if (!repoPath) return
    setLoading(true)
    try {
      const [branchList, current] = await Promise.all([
        invoke<RawGitBranch[]>("git_branches", { repoPath }),
        invoke<string>("git_current_branch", { repoPath }),
      ])
      setBranches(branchList.map(normalizeBranch))
      setCurrentBranch(current)
    } catch (err) {
      console.error("Failed to fetch branches:", err)
    } finally {
      setLoading(false)
    }
  }, [repoPath])

  const checkout = useCallback(
    async (branch: string) => {
      if (!repoPath) return
      try {
        await invoke("git_checkout", { repoPath, branch })
        setCurrentBranch(branch)
      } catch (err) {
        console.error("Failed to checkout:", err)
        throw err
      }
    },
    [repoPath]
  )

  const cloneRepo = useCallback(
    async (url: string, target: string, token?: string) => {
      try {
        await invoke("git_clone", { url, target, token: token ?? null })
      } catch (err) {
        console.error("Failed to clone:", err)
        throw err
      }
    },
    []
  )

  const getDiffSummary = useCallback(async (baseBranch?: string | null): Promise<DiffFile[]> => {
    if (!repoPath) return []
    try {
      const result = await invoke<RawDiffFile[]>("git_diff_summary", { repoPath, baseBranch: baseBranch ?? null })
      return result.map(normalizeDiffFile)
    } catch (err) {
      console.error("Failed to get diff summary:", err)
      return []
    }
  }, [repoPath])

  const getFullDiff = useCallback(async (baseBranch?: string | null): Promise<DiffFile[]> => {
    if (!repoPath) return []
    try {
      const result = await invoke<RawDiffFile[]>("git_diff_full", { repoPath, baseBranch: baseBranch ?? null })
      return result.map(normalizeDiffFile)
    } catch (err) {
      console.error("Failed to get full diff:", err)
      return []
    }
  }, [repoPath])

  return {
    branches,
    currentBranch,
    loading,
    fetchBranches,
    checkout,
    cloneRepo,
    getDiffSummary,
    getFullDiff,
  }
}
