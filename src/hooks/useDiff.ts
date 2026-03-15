"use client"

import { useCallback, useState } from "react"
import { useGit } from "@/hooks/useGit"
import { invoke } from "@/lib/tauri"
import type { DiffFile } from "@/lib/types"

export function useDiff(repoPath: string | null, baseBranch?: string | null) {
  const { getDiffSummary, getFullDiff } = useGit(repoPath)
  const [files, setFiles] = useState<DiffFile[]>([])
  const [rawPatch, setRawPatch] = useState<string>("")
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchDiff = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch structured diff and raw patch in parallel
      const [result, patch] = await Promise.all([
        getFullDiff(baseBranch),
        repoPath
          ? invoke<string>("git_diff_raw_patch", { repoPath, baseBranch: baseBranch ?? null }).catch(() => "")
          : Promise.resolve(""),
      ])
      setFiles(result)
      setRawPatch(patch)
      if (result.length > 0 && !selectedFile) {
        setSelectedFile(result[0].newPath ?? result[0].oldPath ?? null)
      }
    } catch (err) {
      console.error("Failed to fetch diff:", err)
    } finally {
      setLoading(false)
    }
  }, [getFullDiff, repoPath, selectedFile, baseBranch])

  const fetchSummary = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getDiffSummary(baseBranch)
      setFiles(result)
    } catch (err) {
      console.error("Failed to fetch diff summary:", err)
    } finally {
      setLoading(false)
    }
  }, [getDiffSummary, baseBranch])

  return {
    files,
    rawPatch,
    selectedFile,
    setSelectedFile,
    loading,
    fetchDiff,
    fetchSummary,
  }
}
