"use client"

import { useState, useEffect } from "react"
import { invoke } from "@/lib/tauri"
import { AlertCircle, Loader2 } from "lucide-react"
import type { PrInfo, GitBranch, AgentType } from "@/lib/types"

interface CreatePRDialogProps {
  repoPath: string
  headBranch: string
  preferredBaseBranch?: string | null
  agentType: AgentType
  defaultTitle?: string
  workspaceTitle?: string
  workspacePrompt?: string
  onClose: () => void
  onSuccess: (prInfo: PrInfo) => void
}

type RawGitBranch = GitBranch & {
  is_remote?: boolean
  is_current?: boolean
  last_commit_sha?: string | null
  last_commit_message?: string | null
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

interface BranchOption {
  label: string
  value: string
}

interface GeneratedPrContent {
  title: string
  body: string
}

export function CreatePRDialog({
  repoPath,
  headBranch,
  preferredBaseBranch,
  agentType,
  defaultTitle = "",
  workspaceTitle,
  workspacePrompt,
  onClose,
  onSuccess,
}: CreatePRDialogProps) {
  const [title, setTitle] = useState(defaultTitle)
  const [body, setBody] = useState("")
  const [baseBranch, setBaseBranch] = useState("main")
  const [draft, setDraft] = useState(false)
  const [autoGenerate, setAutoGenerate] = useState(true)
  const [branches, setBranches] = useState<BranchOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setTitle(defaultTitle)
  }, [defaultTitle])

  useEffect(() => {
    const loadBranches = async () => {
      try {
        const result = await invoke<RawGitBranch[]>("git_branches", {
          repoPath,
        })
        const normalizedBranches = result.map(normalizeBranch)
        const normalizedPreferredBaseBranch = preferredBaseBranch
          ?.replace(/^origin\//, "")
          .trim()

        const remoteBranchOptions = Array.from(
          new Map(
            normalizedBranches
              .filter(
                (branch) =>
                  branch.isRemote &&
                  !branch.name.includes("HEAD ->") &&
                  branch.name !== "origin/HEAD"
              )
              .map((branch) => [
                branch.name.replace(/^origin\//, ""),
                {
                  label: branch.name,
                  value: branch.name.replace(/^origin\//, ""),
                },
              ])
          ).values()
        )

        const localBranchOptions = normalizedBranches
          .filter(
            (branch) =>
              !branch.isRemote &&
              branch.name &&
              branch.name !== "HEAD" &&
              !branch.name.includes("HEAD ->")
          )
          .map((branch) => ({
            label: branch.name,
            value: branch.name,
          }))

        const baseBranchOptions =
          remoteBranchOptions.length > 0
            ? remoteBranchOptions
            : localBranchOptions

        setBranches(baseBranchOptions)

        const resolvedBaseBranch =
          (normalizedPreferredBaseBranch
            ? baseBranchOptions.find(
                (branch) => branch.value === normalizedPreferredBaseBranch
              )?.value
            : null) ??
          baseBranchOptions.find(
            (branch) => branch.value === "main" || branch.value === "master"
          )?.value ??
          baseBranchOptions[0]?.value ??
          ""

        if (resolvedBaseBranch) {
          setBaseBranch(resolvedBaseBranch)
        }
      } catch (err) {
        console.error("Failed to load branches:", err)
      }
    }
    loadBranches()
  }, [repoPath, preferredBaseBranch])

  const handleCreate = async () => {
    if (!autoGenerate && !title.trim()) return

    setLoading(true)
    setError(null)

    try {
      const branchCommits = await invoke<
        {
          sha: string
          shortSha: string
          summary: string
          committedAt: string
          index: number
        }[]
      >("git_list_branch_commits", {
        repoPath,
        baseBranch,
      })

      if (branchCommits.length === 0) {
        throw new Error("当前分支还没有可用于创建 PR 的提交，请先提交改动。")
      }

      let finalTitle = title.trim()
      let finalBody = body.trim()

      if (autoGenerate) {
        const generated = await invoke<GeneratedPrContent>(
          "git_generate_pr_content",
          {
            repoPath,
            agentType,
            baseBranch,
            workspaceTitle: workspaceTitle ?? null,
            workspacePrompt: workspacePrompt ?? null,
            currentTitle: finalTitle || null,
            currentBody: finalBody || null,
          }
        )

        finalTitle = generated.title.trim()
        finalBody = generated.body.trim()
        setTitle(finalTitle)
        setBody(finalBody)
      }

      if (!finalTitle) {
        throw new Error("PR 标题为空，无法创建。")
      }

      const result = await invoke<PrInfo>("git_create_pr", {
        repoPath,
        title: finalTitle,
        body: finalBody || null,
        baseBranch,
        draft,
      })

      onSuccess(result)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg bg-background p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">创建 Pull Request</h2>

        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            当前提交分支:{" "}
            <span className="font-mono text-foreground">{headBranch}</span>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">标题</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="PR 标题"
              disabled={autoGenerate}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">描述</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="PR 描述（可选）"
              disabled={autoGenerate}
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">目标分支</label>
            <select
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              disabled={loading || branches.length === 0}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {branches.length === 0 && <option value="">暂无可选分支</option>}
              {branches.map((branch) => (
                <option
                  key={`${branch.label}:${branch.value}`}
                  value={branch.value}
                >
                  {branch.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="draft"
              checked={draft}
              onChange={(e) => setDraft(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="draft" className="text-sm">
              创建为草稿 PR
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="auto-generate"
              checked={autoGenerate}
              onChange={(e) => setAutoGenerate(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="auto-generate" className="text-sm">
              自动生成描述（AI）
            </label>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={
              loading || (!autoGenerate && !title.trim()) || !baseBranch
            }
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "创建中..." : "创建 PR"}
          </button>
        </div>
      </div>
    </div>
  )
}
