"use client"

import { useDiffViewStore } from "@/stores/diffViewStore"
import { useTranslations } from "next-intl"
import { AlignLeft, Columns2, WrapText } from "lucide-react"
import { cn } from "@/lib/utils"

export function DiffToolbar() {
  const t = useTranslations()
  const { viewMode, wrapText, setViewMode, setWrapText } = useDiffViewStore()

  return (
    <div className="flex items-center gap-1">
      {/* View mode toggle */}
      <button
        onClick={() => setViewMode("unified")}
        className={cn(
          "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
          viewMode === "unified"
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <AlignLeft className="h-3 w-3" />
        {t("diff.unified")}
      </button>
      <button
        onClick={() => setViewMode("split")}
        className={cn(
          "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
          viewMode === "split"
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Columns2 className="h-3 w-3" />
        {t("diff.split")}
      </button>

      <div className="mx-1 h-4 w-px bg-border" />

      {/* Options */}
      <button
        onClick={() => setWrapText(!wrapText)}
        className={cn(
          "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
          wrapText
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <WrapText className="h-3 w-3" />
        {t("diff.wrapText")}
      </button>
    </div>
  )
}
