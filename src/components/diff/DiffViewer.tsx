"use client"

import { useMemo, useCallback, useEffect, useRef, useState, startTransition } from "react"
import { useTheme } from "next-themes"
import { FileDiff } from "@pierre/diffs/react"
import { Copy, Check, Highlighter } from "lucide-react"
import type {
  DiffLineAnnotation,
  AnnotationSide,
  FileContents,
} from "@pierre/diffs/react"
import { getSingularPatch, type FileDiffMetadata, type FileDiffOptions } from "@pierre/diffs"
import type { DiffFile, ReviewComment } from "@/lib/types"
import { useDiffViewStore } from "@/stores/diffViewStore"
import { InlineComment } from "@/components/review/InlineComment"
import { CommentEditor } from "@/components/review/CommentEditor"
import { DiffErrorBoundary } from "@/components/diff/DiffErrorBoundary"
import { invoke } from "@/lib/tauri"
import { toast } from "sonner"

interface DiffViewerProps {
  files: DiffFile[]
  rawPatch: string
  repoPath: string
  baseBranch?: string | null
  oldRevision?: string | null
  newRevision?: string | null
  selectedFile: string | null
  comments?: ReviewComment[]
  commentingAt?: {
    filePath: string
    lineNumber: number
    side: "old" | "new"
  } | null
  onLineClick?: (
    filePath: string,
    lineNumber: number,
    side: "old" | "new"
  ) => void
  onSubmitComment?: (
    content: string,
    existingCommentId?: string
  ) => void | Promise<unknown>
  onCancelComment?: () => void
  onResolveComment?: (id: string, resolved?: boolean) => void | Promise<unknown>
  onUpdateComment?: (comment: ReviewComment) => void | Promise<unknown>
  commentVariant?: "default" | "compact"
}

type FileContentPair = {
  oldFile: FileContents
  newFile: FileContents
}

type ExpandedDiffRow = {
  kind: "context" | "addition" | "deletion"
  content: string
  oldLineNumber: number | null
  newLineNumber: number | null
}

type RowRange = {
  start: number
  end: number
}

type ViewerAnnotation =
  | {
      type: "comment"
      comment: ReviewComment
    }
  | {
      type: "draft"
      filePath: string
      lineNumber: number
      side: "old" | "new"
    }

interface DiffFileContentsResponse {
  old_contents: string
  new_contents: string
}

// ====================== Git 路径解码函数 ======================
function unescapeGitFilename(filename: string | null | undefined): string {
  if (!filename) return ""
  let cleaned = filename
  // 去除两端可能由于转义而带上的双引号
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1)
  }
  try {
    // 将八进制转义序列 \xxx 转换为 %XX，供 decodeURIComponent 还原为中文字符
    const uriEncoded = cleaned.replace(/\\([0-7]{3})/g, (_, octal) => {
      return '%' + parseInt(octal, 8).toString(16).padStart(2, '0')
    })
    // 顺便处理其他常见转义
    return decodeURIComponent(
      uriEncoded
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\')
    )
  } catch (e) {
    // 如果解码失败，降级返回原样
    return cleaned
  }
}

function normalizeText(text: string | null | undefined): string {
  if (!text) return ""
  return text.replace(/\r\n/g, "\n")
}

function toAnnotationSide(side: "old" | "new"): AnnotationSide {
  return side === "old" ? "deletions" : "additions"
}

function fromAnnotationSide(side: AnnotationSide): "old" | "new" {
  return side === "deletions" ? "old" : "new"
}

// ====================== 应用解码函数 ======================
function getFilePath(file: DiffFile): string {
  const rawPath = file.newPath ?? file.oldPath ?? "unknown"
  return unescapeGitFilename(rawPath)
}

function getFileLanguage(path: string): FileContents["lang"] {
  const ext = path.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "ts":
      return "ts"
    case "tsx":
      return "tsx"
    case "js":
      return "js"
    case "jsx":
      return "jsx"
    case "json":
      return "json"
    case "rs":
      return "rust"
    case "go":
      return "go"
    case "md":
      return "md"
    case "css":
      return "css"
    case "html":
      return "html"
    case "yml":
    case "yaml":
      return "yaml"
    default:
      return "text"
  }
}

/**
 * 修复点 1：使用全量检测替代百分比检测
 * 只要文件包含中文字符，就返回 true。
 * 避免 Markdown 表格等文件中，因为英文占比较高而漏判。
 */
function shouldDisableHighlight(
  filePath: string,
  oldContent: string,
  newContent: string
): boolean {
  const chineseRegex = /[\u4e00-\u9fff]/
  return (
    chineseRegex.test(filePath) ||
    chineseRegex.test(oldContent) ||
    chineseRegex.test(newContent)
  )
}

function splitLinesPreserveNewline(contents: string): string[] {
  return contents.match(/[^\n]*\n|[^\n]+/g) ?? []
}

function getLineContent(
  oldLines: string[],
  newLines: string[],
  row: Pick<ExpandedDiffRow, "kind" | "oldLineNumber" | "newLineNumber">,
  fallback: string
) {
  if (row.kind === "deletion" && row.oldLineNumber) {
    return oldLines[row.oldLineNumber - 1] ?? fallback
  }

  if (row.kind === "addition" && row.newLineNumber) {
    return newLines[row.newLineNumber - 1] ?? fallback
  }

  if (row.newLineNumber) {
    return newLines[row.newLineNumber - 1] ?? fallback
  }

  if (row.oldLineNumber) {
    return oldLines[row.oldLineNumber - 1] ?? fallback
  }

  return fallback
}

function buildExpandedRows(
  file: DiffFile,
  oldLines: string[],
  newLines: string[]
): {
  rows: ExpandedDiffRow[]
  hunkRanges: RowRange[]
} {
  const rows: ExpandedDiffRow[] = []
  const hunkRanges: RowRange[] = []
  let oldPointer = 1
  let newPointer = 1

  const pushContextUntil = (oldEnd: number, newEnd: number) => {
    const lineCount = Math.max(0, Math.min(oldEnd - oldPointer + 1, newEnd - newPointer + 1))

    for (let index = 0; index < lineCount; index += 1) {
      rows.push({
        kind: "context",
        content: newLines[newPointer - 1] ?? oldLines[oldPointer - 1] ?? "",
        oldLineNumber: oldPointer,
        newLineNumber: newPointer,
      })
      oldPointer += 1
      newPointer += 1
    }
  }

  for (const hunk of file.hunks) {
    pushContextUntil(hunk.oldStart - 1, hunk.newStart - 1)

    const hunkStartIndex = rows.length

    for (const line of hunk.lines) {
      const row: ExpandedDiffRow = {
        kind: line.kind,
        content: getLineContent(oldLines, newLines, line, line.content),
        oldLineNumber: line.oldLineNumber,
        newLineNumber: line.newLineNumber,
      }

      rows.push(row)

      if (line.kind !== "addition") {
        oldPointer += 1
      }

      if (line.kind !== "deletion") {
        newPointer += 1
      }
    }

    if (rows.length > hunkStartIndex) {
      hunkRanges.push({
        start: hunkStartIndex,
        end: rows.length - 1,
      })
    }
  }

  pushContextUntil(oldLines.length, newLines.length)

  while (oldPointer <= oldLines.length) {
    rows.push({
      kind: "deletion",
      content: oldLines[oldPointer - 1] ?? "",
      oldLineNumber: oldPointer,
      newLineNumber: null,
    })
    oldPointer += 1
  }

  while (newPointer <= newLines.length) {
    rows.push({
      kind: "addition",
      content: newLines[newPointer - 1] ?? "",
      oldLineNumber: null,
      newLineNumber: newPointer,
    })
    newPointer += 1
  }

  return { rows, hunkRanges }
}

function mergeRanges(ranges: RowRange[]): RowRange[] {
  if (ranges.length === 0) {
    return []
  }

  const sorted = [...ranges].sort((left, right) => left.start - right.start)
  const merged: RowRange[] = [sorted[0]]

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index]
    const previous = merged[merged.length - 1]

    if (current.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, current.end)
      continue
    }

    merged.push({ ...current })
  }

  return merged
}

function findAnnotatedRowIndex(
  rows: ExpandedDiffRow[],
  annotation: DiffLineAnnotation<ViewerAnnotation>
) {
  const useOldSide = annotation.side === "deletions"
  const exactMatch = rows.findIndex((row) =>
    useOldSide
      ? row.oldLineNumber === annotation.lineNumber && row.kind !== "addition"
      : row.newLineNumber === annotation.lineNumber && row.kind !== "deletion"
  )

  if (exactMatch >= 0) {
    return exactMatch
  }

  let nearestIndex = -1
  let nearestDistance = Number.POSITIVE_INFINITY

  rows.forEach((row, index) => {
    const candidateLine = useOldSide ? row.oldLineNumber : row.newLineNumber
    if (!candidateLine) {
      return
    }

    const distance = Math.abs(candidateLine - annotation.lineNumber)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  })

  return nearestIndex
}

function getPatchLine(content: string, prefix: string) {
  if (content.endsWith("\n")) {
    return `${prefix}${content}`
  }

  return `${prefix}${content}\n`
}

function toChangeType(file: DiffFile): FileDiffMetadata["type"] {
  switch (file.changeKind) {
    case "added":
      return "new"
    case "deleted":
      return "deleted"
    case "renamed":
      return file.hunks.length === 0 ? "rename-pure" : "rename-changed"
    default:
      return "change"
  }
}

function buildDisplayMetadata(
  file: DiffFile,
  contents: FileContentPair,
  annotations: DiffLineAnnotation<ViewerAnnotation>[],
  contextRadius = 3,
  enableHighlight = true
): FileDiffMetadata | null {
  const oldLines = splitLinesPreserveNewline(contents.oldFile.contents)
  const newLines = splitLinesPreserveNewline(contents.newFile.contents)

  // 对于没有 hunks 的文件（"仅评论"文件），创建一个虚拟的完整文件 diff
  let fileToProcess = file
  if (file.hunks.length === 0 && newLines.length > 0) {
    fileToProcess = {
      ...file,
      hunks: [
        {
          oldStart: 1,
          oldLines: oldLines.length,
          newStart: 1,
          newLines: newLines.length,
          header: `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
          lines: [],
        },
      ],
    }
  }

  if (fileToProcess.hunks.length === 0 && annotations.length === 0) {
    return null
  }

  const { rows, hunkRanges } = buildExpandedRows(fileToProcess, oldLines, newLines)

  const annotationRanges = annotations
    .map((annotation) => findAnnotatedRowIndex(rows, annotation))
    .filter((index): index is number => index >= 0)
    .map((index) => ({
      start: Math.max(0, index - contextRadius),
      end: Math.min(rows.length - 1, index + contextRadius),
    }))

  let visibleRanges = mergeRanges([...hunkRanges, ...annotationRanges])

  if (visibleRanges.length === 0) {
    return null
  }

  const oldName = unescapeGitFilename(file.oldPath ?? file.newPath ?? contents.oldFile.name)
  const newName = unescapeGitFilename(file.newPath ?? file.oldPath ?? contents.newFile.name)
  let patch = `--- a/${oldName}\n+++ b/${newName}\n`

  for (const range of visibleRanges) {
    const slice = rows.slice(range.start, range.end + 1)
    const oldNumbers = slice.flatMap((row) =>
      row.oldLineNumber ? [row.oldLineNumber] : []
    )
    const newNumbers = slice.flatMap((row) =>
      row.newLineNumber ? [row.newLineNumber] : []
    )

    patch += `@@ -${oldNumbers[0] ?? 0},${oldNumbers.length} +${newNumbers[0] ?? 0},${newNumbers.length} @@\n`

    for (const row of slice) {
      const prefix =
        row.kind === "addition" ? "+" : row.kind === "deletion" ? "-" : " "
      patch += getPatchLine(row.content, prefix)
    }
  }

  const metadata = getSingularPatch(patch)

  metadata.name = newName
  metadata.prevName = oldName !== newName ? oldName : undefined
  metadata.lang = enableHighlight ? (contents.newFile.lang ?? contents.oldFile.lang) : "text"
  metadata.type = toChangeType(file)
  metadata.oldLines = oldLines
  metadata.newLines = newLines

  return metadata
}

function CodeSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-3 p-6 min-h-[120px]">
      <div className="h-4 w-1/3 rounded-md bg-muted/50"></div>
      <div className="h-4 w-1/2 rounded-md bg-muted/50"></div>
      <div className="h-4 w-1/4 rounded-md bg-muted/50"></div>
    </div>
  )
}

export function DiffViewer({
  files: rawFiles,
  rawPatch: _rawPatch,
  repoPath,
  baseBranch,
  oldRevision,
  newRevision,
  selectedFile,
  comments = [],
  commentingAt,
  onLineClick,
  onSubmitComment,
  onCancelComment,
  onResolveComment,
  onUpdateComment,
  commentVariant = "default",
}: DiffViewerProps) {
  void _rawPatch
  const { viewMode, wrapText } = useDiffViewStore()
  const { resolvedTheme } = useTheme()
  const fileRefs = useRef<Record<string, HTMLDivElement | null>>({})
  
  const [contentsByPath, setContentsByPath] = useState<Record<string, FileContentPair>>({})
  
  const files = useMemo(() => {
    return [...rawFiles].sort((a, b) => 
      getFilePath(a).localeCompare(getFilePath(b))
    )
  }, [rawFiles])

  const [visibleFiles, setVisibleFiles] = useState<Set<string>>(() => {
    return new Set(files.slice(0, 5).map(getFilePath))
  })
  
  const [copiedFile, setCopiedFile] = useState<string | null>(null)

  const defaultHighlightEnabled = files.length <= 20
  const [highlightOverrides, setHighlightOverrides] = useState<Record<string, boolean>>({})

  const shouldUseLineDiff = useCallback((filePath: string): boolean => {
    const contentPair = contentsByPath[filePath]
    if (!contentPair) return false

    return shouldDisableHighlight(
      filePath,
      contentPair.oldFile.contents,
      contentPair.newFile.contents
    )
  }, [contentsByPath])

  const isHighlighted = useCallback((filePath: string) => {
    const useLineDiff = shouldUseLineDiff(filePath)
    if (useLineDiff) {
      return false
    }
    return highlightOverrides[filePath] ?? defaultHighlightEnabled
  }, [highlightOverrides, defaultHighlightEnabled, shouldUseLineDiff])

  const toggleHighlight = useCallback((filePath: string) => {
    setHighlightOverrides((prev) => ({
      ...prev,
      [filePath]: !(prev[filePath] ?? defaultHighlightEnabled)
    }))
  }, [defaultHighlightEnabled])

  const handleScroll = useCallback(() => {
    window.dispatchEvent(new Event("scroll"))
  }, [])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const newlyVisible: string[] = []
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const filePath = entry.target.getAttribute("data-filepath")
            if (filePath) newlyVisible.push(filePath)
          }
        })

        if (newlyVisible.length > 0) {
          startTransition(() => {
            setVisibleFiles((prev) => {
              const next = new Set(prev)
              let changed = false
              newlyVisible.forEach((fp) => {
                if (!next.has(fp)) {
                  next.add(fp)
                  changed = true
                }
              })
              return changed ? next : prev
            })
          })
        }
      },
      { rootMargin: "4000px" }
    )

    files.forEach((file) => {
      const filePath = getFilePath(file)
      const element = fileRefs.current[filePath]
      if (element) {
        element.setAttribute("data-filepath", filePath)
        observer.observe(element)
      }
    })

    return () => {
      observer.disconnect()
    }
  }, [files])

  useEffect(() => {
    let cancelled = false
    let timer: NodeJS.Timeout

    async function loadContentsQueue() {
      const allPaths = files.map(getFilePath)
      const missingPaths = allPaths.filter(fp => !contentsByPath[fp])
      
      if (missingPaths.length === 0) return

      missingPaths.sort((a, b) => {
        const aVis = visibleFiles.has(a) ? -1 : 1
        const bVis = visibleFiles.has(b) ? -1 : 1
        return aVis - bVis
      })

      const batch = missingPaths.slice(0, 3)

      const entries = await Promise.all(
        batch.map(async (filePath) => {
          const file = files.find((f) => getFilePath(f) === filePath)
          if (!file) return null

          const response = await invoke<DiffFileContentsResponse>(
            "git_diff_file_contents",
            {
              repoPath,
              oldPath: file.oldPath,
              newPath: file.newPath,
              baseBranch: baseBranch ?? null,
              oldRevision: oldRevision ?? null,
              newRevision: newRevision ?? null,
            }
          ).catch(() => ({ old_contents: "", new_contents: "" }))

          const lang = getFileLanguage(filePath)
          return [
            filePath,
            {
              oldFile: {
                name: file.oldPath ?? filePath,
                contents: normalizeText(response.old_contents),
                lang,
              },
              newFile: {
                name: file.newPath ?? filePath,
                contents: normalizeText(response.new_contents),
                lang,
              },
            },
          ] as const
        })
      )

      if (!cancelled) {
        const validEntries = entries.filter((e) => e !== null) as [string, FileContentPair][]
        if (validEntries.length > 0) {
          setContentsByPath((prev) => ({
            ...prev,
            ...Object.fromEntries(validEntries),
          }))
        }
      }
    }

    timer = setTimeout(() => {
      if (!cancelled) loadContentsQueue()
    }, 100)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [files, repoPath, baseBranch, oldRevision, newRevision, visibleFiles, contentsByPath])

  useEffect(() => {
    if (!selectedFile) return
    const target = fileRefs.current[selectedFile]
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [selectedFile])

  /**
   * 修复点 2：为包含中文的文件彻底禁用词级 Diff (word diff)
   */
  const getDiffOptionsForFile = useCallback((filePath: string): FileDiffOptions<ViewerAnnotation> => {
    const useLineDiff = shouldUseLineDiff(filePath)

    return {
      theme: {
        dark: "github-dark",
        light: "github-light",
      },
      themeType: resolvedTheme === "dark" ? "dark" : "light",
      diffStyle: viewMode,
      overflow: wrapText ? "wrap" : "scroll",
      // 关键修复：直接使用 "none" 彻底关闭字符级差异计算。
      // 之前使用的 "word-alt" 仍会计算内联差异并传递给 Shiki，从而引发 Token 越界。
      lineDiffType: useLineDiff ? ("none" as any) : ("word" as const),
      diffIndicators: "bars",
      disableFileHeader: true,
      expandUnchanged: false,
      hunkSeparators: "line-info",
      expansionLineCount: 20,
    }
  }, [resolvedTheme, viewMode, wrapText, shouldUseLineDiff])

  const getLineAnnotations = useCallback(
    (filePath: string): DiffLineAnnotation<ViewerAnnotation>[] => {
      const annotations: DiffLineAnnotation<ViewerAnnotation>[] = comments
        .filter((comment) => !comment.isResolved && comment.filePath === filePath)
        .map((comment) => ({
          side: toAnnotationSide(comment.side),
          lineNumber: comment.lineNumber,
          metadata: { type: "comment" as const, comment },
        }))

      if (commentingAt && commentingAt.filePath === filePath) {
        annotations.push({
          side: toAnnotationSide(commentingAt.side),
          lineNumber: commentingAt.lineNumber,
          metadata: {
            type: "draft",
            filePath,
            lineNumber: commentingAt.lineNumber,
            side: commentingAt.side,
          },
        })
      }
      return annotations
    },
    [comments, commentingAt]
  )

  const handleLineClick = useCallback(
    (filePath: string, props: { lineNumber: number; annotationSide: AnnotationSide }) => {
      if (!onLineClick) return
      onLineClick(filePath, props.lineNumber, fromAnnotationSide(props.annotationSide))
    },
    [onLineClick]
  )

  const handleDiffError = useCallback(
    (errorFilePath: string) => {
      console.log(`检测到 Shiki 渲染错误，自动禁用 ${errorFilePath} 的语法高亮`)
      setHighlightOverrides((prev) => ({
        ...prev,
        [errorFilePath]: false,
      }))
    },
    []
  )

  const handleCopyFile = useCallback(
    async (filePath: string) => {
      const contentPair = contentsByPath[filePath]
      const file = files.find((f) => getFilePath(f) === filePath)

      if (!contentPair || !file) {
        toast.error("无法复制文件内容：文件未加载")
        return
      }

      try {
        const fileContent = contentPair.newFile.contents
        if (!fileContent || fileContent.trim() === "") {
          toast.error("文件内容为空")
          return
        }

        await navigator.clipboard.writeText(fileContent)
        setCopiedFile(filePath)
        toast.success(`已复制 ${filePath} 的完整内容`)

        setTimeout(() => setCopiedFile(null), 2000)
      } catch (err) {
        console.error("Failed to copy:", err)
        toast.error("复制失败，请重试")
      }
    },
    [contentsByPath, files]
  )

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>选择文件查看变更</p>
      </div>
    )
  }

  return (
    <div 
      className="review-diff-viewer h-full overflow-y-auto overflow-x-hidden transform-gpu"
      onScroll={handleScroll}
    >
      <div className="space-y-4 p-4">
        {files.map((file) => {
          const filePath = getFilePath(file)
          const contentPair = contentsByPath[filePath]
          const isSelected = selectedFile === filePath
          const isVisible = visibleFiles.has(filePath)
          const lineAnnotations = getLineAnnotations(filePath)
          const highlightEnabled = isHighlighted(filePath)

          const fileDiff =
            contentPair && !file.isBinary && !file.contentOmitted
              ? buildDisplayMetadata(file, contentPair, lineAnnotations, 3, highlightEnabled)
              : null

          return (
            <div
              key={filePath}
              ref={(node) => {
                fileRefs.current[filePath] = node
              }}
              className={[
                "overflow-hidden rounded-lg border border-border bg-background",
                isSelected ? "ring-1 ring-primary/40" : "",
              ].join(" ")}
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2 backdrop-blur">
                <span className="text-sm font-mono truncate">{filePath}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleHighlight(filePath)}
                    className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-accent hover:text-foreground ${
                      highlightEnabled ? "text-foreground font-medium" : "text-muted-foreground"
                    }`}
                    title={highlightEnabled ? "关闭语法高亮" : "开启语法高亮"}
                  >
                    <Highlighter className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">高亮</span>
                  </button>
                  <button
                    onClick={() => handleCopyFile(filePath)}
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title="复制文件完整内容（修改后）"
                  >
                    {copiedFile === filePath ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-green-500" />
                        <span>已复制</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">复制内容</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {(!isVisible || !contentPair) && !file.isBinary && !file.contentOmitted ? (
                <CodeSkeleton />
              ) : file.isBinary ? (
                <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
                  二进制文件暂不支持行内评审。
                </div>
              ) : file.contentOmitted ? (
                <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
                  文件内容过大，当前已省略预览。
                </div>
              ) : !fileDiff ? (
                <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
                  当前没有可展示的 diff 内容。
                </div>
              ) : (
                <DiffErrorBoundary
                  key={`${filePath}-boundary-${highlightEnabled}`}
                  filePath={filePath}
                  onError={handleDiffError}
                >
                  <FileDiff<ViewerAnnotation>
                    key={`${filePath}-diff-${contentPair.newFile.contents.length}-${highlightEnabled}`}
                    fileDiff={fileDiff}
                    style={{ cursor: "pointer" }}
                    options={{
                      ...getDiffOptionsForFile(filePath),
                      onLineClick: (props) => handleLineClick(filePath, props),
                      onLineNumberClick: (props) =>
                        handleLineClick(filePath, props),
                    }}
                    lineAnnotations={lineAnnotations}
                    renderAnnotation={(annotation) => {
                      if (annotation.metadata.type === "comment") {
                        return (
                          <div className="px-2 py-1">
                            <InlineComment
                              comment={annotation.metadata.comment}
                              onResolve={onResolveComment}
                              onUpdate={onUpdateComment}
                              variant={commentVariant}
                            />
                          </div>
                        )
                      }

                      if (annotation.metadata.type === "draft") {
                        return (
                          <div className="px-2 py-2">
                            <CommentEditor
                              submitLabel="添加评论"
                              onSubmit={async (content) => {
                                await onSubmitComment?.(content)
                              }}
                              onCancel={() => onCancelComment?.()}
                            />
                          </div>
                        )
                      }

                      return null
                    }}
                  />
                </DiffErrorBoundary>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}