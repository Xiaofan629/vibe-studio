"use client"

import type { Project } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Folder, Trash2 } from "lucide-react"
import { useTranslations } from "next-intl"

interface ProjectListProps {
  projects: Project[]
  activeProjectId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}

export function ProjectList({
  projects,
  activeProjectId,
  onSelect,
  onDelete,
}: ProjectListProps) {
  const t = useTranslations()

  if (projects.length === 0) {
    return (
      <div className="px-2 py-4 text-center text-xs text-muted-foreground">
        {t("common.noData")}
      </div>
    )
  }

  return (
    <div className="space-y-0.5">
      {projects.map((project) => (
        <div
          key={project.id}
          onClick={() => onSelect(project.id)}
          className={cn(
            "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
            activeProjectId === project.id
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
          )}
        >
          <Folder className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 truncate">{project.name}</span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete(project.id)
            }}
            className="invisible shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:visible"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )
}
