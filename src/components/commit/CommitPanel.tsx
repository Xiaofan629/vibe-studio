"use client"

import { useTranslations } from "next-intl"
import { Loader2, GitCommit, Send, Sparkles } from "lucide-react"
import type { DiffFile } from "@/lib/types"
import { DiffStats } from "@/components/diff/DiffStats"

interface CommitPanelProps {
  files: DiffFile[]
  commitTitle: string
  commitBody: string
  loading: boolean
  onTitleChange: (v: string) => void
  onBodyChange: (v: string) => void
  onGenerate: () => void
  onCommit: () => void
  onPushAndPr: () => void
}

export function CommitPanel({
  files,
  commitTitle,
  commitBody,
  loading,
  onTitleChange,
  onBodyChange,
  onGenerate,
  onCommit,
  onPushAndPr,
}: CommitPanelProps) {
  const t = useTranslations()

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <GitCommit className="h-5 w-5" />
        {t("commit.oneClick")}
      </h2>

      {/* Stats */}
      <DiffStats files={files} />

      {/* Generate button */}
      <button
        onClick={onGenerate}
        disabled={loading || files.length === 0}
        className="flex items-center gap-2 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
      >
        <Sparkles className="h-3.5 w-3.5" />
        {t("commit.generateMessage")}
      </button>

      {/* Title */}
      <div>
        <label className="mb-1 block text-sm font-medium">{t("commit.commitTitle")}</label>
        <input
          type="text"
          value={commitTitle}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="feat: add new feature"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Body */}
      <div>
        <label className="mb-1 block text-sm font-medium">{t("commit.commitBody")}</label>
        <textarea
          value={commitBody}
          onChange={(e) => onBodyChange(e.target.value)}
          placeholder="Describe changes..."
          rows={6}
          className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={onCommit}
          disabled={loading || !commitTitle.trim()}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <GitCommit className="h-3.5 w-3.5" />
          )}
          {t("commit.commit")}
        </button>
        <button
          onClick={onPushAndPr}
          disabled={loading || !commitTitle.trim()}
          className="flex items-center gap-2 rounded-md border border-input px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          {t("commit.pushAndPr")}
        </button>
      </div>
    </div>
  )
}
