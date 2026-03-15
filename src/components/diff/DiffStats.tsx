"use client"

import type { DiffFile } from "@/lib/types"
import { useTranslations } from "next-intl"

interface DiffStatsProps {
  files: DiffFile[]
}

export function DiffStats({ files }: DiffStatsProps) {
  const t = useTranslations()
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0)
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0)

  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span>
        {files.length} {t("diff.filesChanged")}
      </span>
      <span className="text-green-500">
        +{totalAdditions} {t("diff.additions")}
      </span>
      <span className="text-red-500">
        -{totalDeletions} {t("diff.deletions")}
      </span>
    </div>
  )
}
