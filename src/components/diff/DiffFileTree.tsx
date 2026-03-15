"use client"

import { useEffect, useMemo, useState } from "react"
import type { DiffFile } from "@/lib/types"
import { cn } from "@/lib/utils"
import {
  ChevronRight,
  FileCode,
  FilePlus,
  FileMinus,
  FileEdit,
  Folder,
  FolderOpen,
} from "lucide-react"

interface DiffFileTreeProps {
  files: DiffFile[]
  selectedFile: string | null
  onSelect: (filePath: string) => void
  commentCounts?: Record<string, number>
  commentOnlyPaths?: string[]
}

const EMPTY_COMMENT_PATHS: string[] = []

type TreeNode = {
  name: string
  path: string
  type: "folder" | "file"
  children?: TreeNode[]
  file?: DiffFile
  commentOnly?: boolean
}

const KIND_ICON: Record<string, React.ElementType> = {
  added: FilePlus,
  modified: FileEdit,
  deleted: FileMinus,
  renamed: FileCode,
}

const KIND_COLOR: Record<string, string> = {
  added: "text-green-400",
  modified: "text-yellow-400",
  deleted: "text-red-400",
  renamed: "text-blue-400",
}

function buildTree(
  files: DiffFile[],
  commentOnlyPaths: string[] = []
): TreeNode[] {
  const root: TreeNode[] = []

  const getOrCreateFolder = (
    nodes: TreeNode[],
    name: string,
    path: string
  ): TreeNode => {
    let folder = nodes.find(
      (node) => node.type === "folder" && node.name === name
    )
    if (!folder) {
      folder = {
        name,
        path,
        type: "folder",
        children: [],
      }
      nodes.push(folder)
    }
    return folder
  }

  const insertFileNode = ({
    fullPath,
    file,
    commentOnly = false,
  }: {
    fullPath: string
    file?: DiffFile
    commentOnly?: boolean
  }) => {
    const parts = fullPath.split("/").filter(Boolean)

    if (parts.length === 0) {
      root.push({
        name: fullPath,
        path: fullPath,
        type: "file",
        file,
        commentOnly,
      })
      return
    }

    let currentLevel = root
    let currentPath = ""

    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const isFile = index === parts.length - 1

      if (!isFile) {
        const folder = getOrCreateFolder(currentLevel, part, currentPath)
        currentLevel = folder.children ?? []
        folder.children = currentLevel
        return
      }

      currentLevel.push({
        name: part,
        path: currentPath,
        type: "file",
        file,
        commentOnly,
      })
    })
  }

  const seenPaths = new Set<string>()

  for (const file of files) {
    const fullPath = file.newPath ?? file.oldPath ?? "unknown"
    seenPaths.add(fullPath)
    insertFileNode({ fullPath, file })
  }

  for (const fullPath of commentOnlyPaths) {
    if (!fullPath || seenPaths.has(fullPath)) continue
    insertFileNode({ fullPath, commentOnly: true })
  }

  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    return [...nodes]
      .sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === "folder" ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })
      .map((node) => ({
        ...node,
        children: node.children ? sortNodes(node.children) : undefined,
      }))
  }

  return sortNodes(root)
}

function collectFolderPaths(nodes: TreeNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.type !== "folder") return []
    return [node.path, ...collectFolderPaths(node.children ?? [])]
  })
}

export function DiffFileTree({
  files,
  selectedFile,
  onSelect,
  commentCounts,
  commentOnlyPaths,
}: DiffFileTreeProps) {
  const stableCommentOnlyPaths = commentOnlyPaths ?? EMPTY_COMMENT_PATHS
  const tree = useMemo(
    () => buildTree(files, stableCommentOnlyPaths),
    [files, stableCommentOnlyPaths]
  )
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(collectFolderPaths(buildTree(files, stableCommentOnlyPaths)))
  )

  useEffect(() => {
    setExpandedFolders(new Set(collectFolderPaths(tree)))
  }, [tree])

  if (files.length === 0 && stableCommentOnlyPaths.length === 0) {
    return <div className="p-3 text-xs text-muted-foreground">暂无文件变更</div>
  }

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const renderNode = (node: TreeNode, depth = 0) => {
    if (node.type === "folder") {
      const expanded = expandedFolders.has(node.path)
      return (
        <div key={node.path}>
          <button
            onClick={() => toggleFolder(node.path)}
            className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent/50"
            style={{ paddingLeft: `${8 + depth * 14}px` }}
          >
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 shrink-0 transition-transform",
                expanded && "rotate-90"
              )}
            />
            {expanded ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{node.name}</span>
          </button>
          {expanded &&
            node.children?.map((child) => renderNode(child, depth + 1))}
        </div>
      )
    }

    const file = node.file
    const path = file?.newPath ?? file?.oldPath ?? node.path
    const Icon = file ? (KIND_ICON[file.changeKind] ?? FileCode) : FileCode
    const commentCount = commentCounts?.[path] ?? 0

    return (
      <button
        key={path}
        onClick={() => onSelect(path)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
          selectedFile === path
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50"
        )}
        style={{ paddingLeft: `${22 + depth * 14}px` }}
      >
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            file ? KIND_COLOR[file.changeKind] : "text-blue-400"
          )}
        />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {node.name}
        </span>
        <div className="flex shrink-0 items-center gap-1 text-[10px]">
          {node.commentOnly && (
            <span className="rounded-full bg-blue-500/15 px-1.5 py-0.5 font-medium text-blue-500">
              仅评论
            </span>
          )}
          {commentCount > 0 && (
            <span className="rounded-full bg-yellow-500/20 px-1.5 py-0.5 font-medium text-yellow-500">
              {commentCount}
            </span>
          )}
          {file && file.additions > 0 && (
            <span className="text-green-500">+{file.additions}</span>
          )}
          {file && file.deletions > 0 && (
            <span className="text-red-500">-{file.deletions}</span>
          )}
        </div>
      </button>
    )
  }

  return (
    <div className="h-full overflow-y-auto space-y-0.5 p-2">
      {tree.map((node) => renderNode(node))}
    </div>
  )
}
