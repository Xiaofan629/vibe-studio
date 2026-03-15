"use client"

import { openUrl } from "@tauri-apps/plugin-opener"
import { ExternalLink, GitPullRequest, GitMerge, XCircle } from "lucide-react"
import type { PrInfo } from "@/lib/types"

interface PRBadgeProps {
  prInfo: PrInfo
  onClick?: () => void
}

export function PRBadge({ prInfo, onClick }: PRBadgeProps) {
  const handleClick = () => {
    if (onClick) {
      onClick()
    } else {
      void openUrl(prInfo.url).catch(() => {
        window.open(prInfo.url, "_blank", "noopener,noreferrer")
      })
    }
  }

  const getStatusColor = () => {
    switch (prInfo.status) {
      case "open":
        return "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20"
      case "merged":
        return "bg-purple-500/10 text-purple-500 hover:bg-purple-500/20"
      case "closed":
        return "bg-red-500/10 text-red-500 hover:bg-red-500/20"
      default:
        return "bg-muted text-muted-foreground hover:bg-muted/80"
    }
  }

  const getIcon = () => {
    switch (prInfo.status) {
      case "merged":
        return <GitMerge className="h-3 w-3" />
      case "closed":
        return <XCircle className="h-3 w-3" />
      default:
        return <GitPullRequest className="h-3 w-3" />
    }
  }

  const getLabel = () => {
    switch (prInfo.status) {
      case "merged":
        return `已合并 PR #${prInfo.number}`
      case "closed":
        return `已关闭 PR #${prInfo.number}`
      default:
        return `打开 PR #${prInfo.number}`
    }
  }

  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${getStatusColor()}`}
    >
      {getIcon()}
      <span>{getLabel()}</span>
      <ExternalLink className="h-3 w-3" />
    </button>
  )
}
