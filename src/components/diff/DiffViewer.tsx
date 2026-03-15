"use client"

import { useMemo, useCallback, useEffect, useRef, useState } from "react"
import { useTheme } from "next-themes"
import { FileDiff } from "@pierre/diffs/react"
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
import { invoke } from "@/lib/tauri"

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

function toAnnotationSide(side: "old" | "new"): AnnotationSide {
  return side === "old" ? "deletions" : "additions"
}

function fromAnnotationSide(side: AnnotationSide): "old" | "new" {
  return side === "deletions" ? "old" : "new"
}

function getFilePath(file: DiffFile): string {
  return file.newPath ?? file.oldPath ?? "unknown"
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
  contextRadius = 3
): FileDiffMetadata | null {
  const oldLines = splitLinesPreserveNewline(contents.oldFile.contents)
  const newLines = splitLinesPreserveNewline(contents.newFile.contents)
  const { rows, hunkRanges } = buildExpandedRows(file, oldLines, newLines)

  const annotationRanges = annotations
    .map((annotation) => findAnnotatedRowIndex(rows, annotation))
    .filter((index): index is number => index >= 0)
    .map((index) => ({
      start: Math.max(0, index - contextRadius),
      end: Math.min(rows.length - 1, index + contextRadius),
    }))

  const visibleRanges = mergeRanges([...hunkRanges, ...annotationRanges])

  if (visibleRanges.length === 0) {
    return null
  }

  const oldName = file.oldPath ?? file.newPath ?? contents.oldFile.name
  const newName = file.newPath ?? file.oldPath ?? contents.newFile.name
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
  metadata.lang = contents.newFile.lang ?? contents.oldFile.lang
  metadata.type = toChangeType(file)
  metadata.oldLines = oldLines
  metadata.newLines = newLines

  return metadata
}

export function DiffViewer({
  files,
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
  const [contentsByPath, setContentsByPath] = useState<
    Record<string, FileContentPair>
  >({})
  const [visibleFiles, setVisibleFiles] = useState<Set<string>>(new Set())

  useEffect(() => {
    const observers = new Map<string, IntersectionObserver>()

    files.forEach((file) => {
      const filePath = getFilePath(file)
      const element = fileRefs.current[filePath]

      if (!element) return

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              setVisibleFiles((prev) => new Set(prev).add(filePath))
            }
          })
        },
        { rootMargin: "200px" }
      )

      observer.observe(element)
      observers.set(filePath, observer)
    })

    return () => {
      observers.forEach((observer) => observer.disconnect())
    }
  }, [files])

  useEffect(() => {
    let cancelled = false

    async function loadContents() {
      const visibleFilePaths = Array.from(visibleFiles)
      if (visibleFilePaths.length === 0) return

      const entries = await Promise.all(
        visibleFilePaths
          .filter((filePath) => !contentsByPath[filePath])
          .map(async (filePath) => {
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
                  contents: response.old_contents,
                  lang,
                },
                newFile: {
                  name: file.newPath ?? filePath,
                  contents: response.new_contents,
                  lang,
                },
              },
            ] as const
          })
      )

      if (!cancelled) {
        const validEntries = entries.filter((e) => e !== null) as [
          string,
          FileContentPair,
        ][]
        if (validEntries.length > 0) {
          setContentsByPath((prev) => ({
            ...prev,
            ...Object.fromEntries(validEntries),
          }))
        }
      }
    }

    if (visibleFiles.size > 0 && repoPath) {
      void loadContents()
    }

    return () => {
      cancelled = true
    }
  }, [
    visibleFiles,
    files,
    repoPath,
    baseBranch,
    oldRevision,
    newRevision,
    contentsByPath,
  ])

  useEffect(() => {
    if (!selectedFile) return
    const target = fileRefs.current[selectedFile]
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [selectedFile])

  const diffOptions = useMemo<FileDiffOptions<ViewerAnnotation>>(() => {
    return {
      theme: {
        dark: "github-dark",
        light: "github-light",
      },
      themeType: resolvedTheme === "dark" ? "dark" : "light",
      diffStyle: viewMode,
      overflow: wrapText ? "wrap" : "scroll",
      lineDiffType: "word",
      diffIndicators: "bars",
      disableFileHeader: true,
      expandUnchanged: false,
      hunkSeparators: "line-info",
      expansionLineCount: 20,
    }
  }, [resolvedTheme, viewMode, wrapText])

  const getLineAnnotations = useCallback(
    (filePath: string): DiffLineAnnotation<ViewerAnnotation>[] => {
      const annotations: DiffLineAnnotation<ViewerAnnotation>[] = comments
        .filter(
          (comment) => !comment.isResolved && comment.filePath === filePath
        )
        .map((comment) => ({
          side: toAnnotationSide(comment.side),
          lineNumber: comment.lineNumber,
          metadata: {
            type: "comment" as const,
            comment,
          },
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
    (
      filePath: string,
      props: { lineNumber: number; annotationSide: AnnotationSide }
    ) => {
      if (!onLineClick) return
      onLineClick(
        filePath,
        props.lineNumber,
        fromAnnotationSide(props.annotationSide)
      )
    },
    [onLineClick]
  )

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>选择文件查看变更</p>
      </div>
    )
  }

  return (
    <div className="review-diff-viewer h-full overflow-y-auto overflow-x-hidden">
      <div className="space-y-4 p-4">
        {files.map((file) => {
          const filePath = getFilePath(file)
          const contentPair = contentsByPath[filePath]
          const isSelected = selectedFile === filePath
          const isVisible = visibleFiles.has(filePath)
          const lineAnnotations = getLineAnnotations(filePath)
          const fileDiff =
            contentPair && !file.isBinary && !file.contentOmitted
              ? buildDisplayMetadata(file, contentPair, lineAnnotations)
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
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2 backdrop-blur">
                <span className="text-sm font-mono">{filePath}</span>
              </div>

              {!isVisible ? (
                <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
                  滚动到此处加载...
                </div>
              ) : file.isBinary ? (
                <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
                  二进制文件暂不支持行内评审。
                </div>
              ) : file.contentOmitted ? (
                <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
                  文件内容过大，当前已省略预览。
                </div>
              ) : !contentPair ? (
                <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
                  正在加载...
                </div>
              ) : !fileDiff ? (
                <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
                  当前没有可展示的 diff 内容。
                </div>
              ) : (
                <FileDiff<ViewerAnnotation>
                  fileDiff={fileDiff}
                  style={{ cursor: "pointer" }}
                  options={{
                    ...diffOptions,
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
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
