"use client"

import { useMultiAgentStore } from "@/stores/multiAgentStore"
import { useTranslations } from "next-intl"
import { TreesIcon, LayoutGrid, GanttChart } from "lucide-react"

const VIEWS = [
  { key: "tree" as const, icon: TreesIcon, labelKey: "multiAgent.treeView" },
  { key: "panel" as const, icon: LayoutGrid, labelKey: "multiAgent.panelView" },
  { key: "timeline" as const, icon: GanttChart, labelKey: "multiAgent.timelineView" },
]

export function ViewSwitcher() {
  const t = useTranslations()
  const { activeView, setActiveView } = useMultiAgentStore()

  return (
    <div className="flex gap-1 rounded-lg border border-border bg-muted p-1">
      {VIEWS.map(({ key, icon: Icon, labelKey }) => (
        <button
          key={key}
          onClick={() => setActiveView(key)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
            activeView === key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
          {t(labelKey)}
        </button>
      ))}
    </div>
  )
}
