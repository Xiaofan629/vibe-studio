"use client"

import { useCallback, useState } from "react"
import { invoke } from "@/lib/tauri"
import type { AgentType, DiffFile } from "@/lib/types"

interface UseCommitOptions {
  agentType?: AgentType
  workspaceTitle?: string | null
  workspacePrompt?: string | null
}

export function useCommit(repoPath: string | null, options: UseCommitOptions = {}) {
  const [commitTitle, setCommitTitle] = useState("")
  const [commitBody, setCommitBody] = useState("")
  const [loading, setLoading] = useState(false)

  const generateCommitMessage = useCallback(
    async (files: DiffFile[]) => {
      if (!repoPath) throw new Error("No repo path")
      const totalAdditions = files.reduce((s, f) => s + f.additions, 0)
      const totalDeletions = files.reduce((s, f) => s + f.deletions, 0)
      if (files.length === 0 || totalAdditions + totalDeletions === 0) {
        throw new Error("No uncommitted changes to summarize")
      }

      setLoading(true)
      try {
        const result = await invoke<{ title: string; body: string }>(
          "git_generate_commit_content",
          {
            repoPath,
            agentType: options.agentType ?? "claude_code",
            workspaceTitle: options.workspaceTitle ?? null,
            workspacePrompt: options.workspacePrompt ?? null,
            currentTitle: commitTitle.trim() || null,
            currentBody: commitBody.trim() || null,
          }
        )

        setCommitTitle(result.title)
        setCommitBody(result.body)
        return result
      } finally {
        setLoading(false)
      }
    },
    [
      repoPath,
      options.agentType,
      options.workspacePrompt,
      options.workspaceTitle,
      commitTitle,
      commitBody,
    ]
  )

  const generateCommitMessageFromPatch = useCallback(
    async (patch: string) => {
      if (!repoPath) throw new Error("No repo path")
      if (!patch.trim()) {
        throw new Error("No selected changes to summarize")
      }

      setLoading(true)
      try {
        const result = await invoke<{ title: string; body: string }>(
          "git_generate_commit_content_from_patch",
          {
            repoPath,
            agentType: options.agentType ?? "claude_code",
            workspaceTitle: options.workspaceTitle ?? null,
            workspacePrompt: options.workspacePrompt ?? null,
            currentTitle: commitTitle.trim() || null,
            currentBody: commitBody.trim() || null,
            patch,
          }
        )

        setCommitTitle(result.title)
        setCommitBody(result.body)
        return result
      } finally {
        setLoading(false)
      }
    },
    [
      repoPath,
      options.agentType,
      options.workspacePrompt,
      options.workspaceTitle,
      commitTitle,
      commitBody,
    ]
  )

  const commit = useCallback(
    async (message: string) => {
      if (!repoPath) throw new Error("No repo path")
      setLoading(true)
      try {
        // git add -A && git commit -m "message"
        const result = await invoke<{ sha: string; branch: string; message: string }>(
          "git_commit",
          { repoPath, message }
        )
        return result
      } finally {
        setLoading(false)
      }
    },
    [repoPath]
  )

  const commitSelected = useCallback(
    async (message: string, patch: string) => {
      if (!repoPath) throw new Error("No repo path")
      setLoading(true)
      try {
        return await invoke<{ sha: string; branch: string; message: string }>(
          "git_commit_selected",
          { repoPath, message, patch }
        )
      } finally {
        setLoading(false)
      }
    },
    [repoPath]
  )

  const push = useCallback(async (targetBranch?: string | null) => {
    if (!repoPath) throw new Error("No repo path")
    setLoading(true)
    try {
      await invoke("git_push", {
        repoPath,
        targetBranch: targetBranch ?? null,
      })
    } finally {
      setLoading(false)
    }
  }, [repoPath])

  const commitSelectedAndPush = useCallback(
    async (message: string, patch: string, targetBranch?: string | null) => {
      if (!repoPath) throw new Error("No repo path")
      setLoading(true)
      try {
        const result = await invoke<{ sha: string; branch: string; message: string }>(
          "git_commit_selected",
          { repoPath, message, patch }
        )
        // Commit 成功后 push
        await invoke("git_push", {
          repoPath,
          targetBranch: targetBranch ?? null,
        })
        return result
      } finally {
        setLoading(false)
      }
    },
    [repoPath]
  )

  return {
    commitTitle,
    setCommitTitle,
    commitBody,
    setCommitBody,
    loading,
    generateCommitMessage,
    generateCommitMessageFromPatch,
    commit,
    commitSelected,
    push,
    commitSelectedAndPush,
  }
}
