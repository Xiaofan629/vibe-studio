"use client"

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react"
import {
  ChevronDown,
  FolderOpen,
  Maximize2,
  MessageSquare,
  Send,
  Slash,
  Sparkles,
  Square,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { promptApi } from "@/lib/tauri"
import { cn } from "@/lib/utils"
import type {
  AgentType,
  ClaudePermissionMode,
  FileEntry,
  SlashCommand,
} from "@/lib/types"
import { AgentFilePicker } from "./AgentFilePicker"
import { AgentImagePreview } from "./AgentImagePreview"
import { AgentSlashCommandPicker } from "./AgentSlashCommandPicker"

interface AgentInputProps {
  disabled?: boolean
  isRunning?: boolean
  onSend?: (message: string) => void
  onStop?: () => void
  placeholder?: string
  hasUnresolvedComments?: boolean
  unresolvedCount?: number
  projectPath?: string | null
  agentLabel?: string
  agentType?: AgentType
  queueCount?: number
  claudePermissionMode?: ClaudePermissionMode
  onClaudePermissionModeChange?: (mode: ClaudePermissionMode) => void
}

export interface AgentInputRef {
  addImage: (imagePath: string) => void
}

interface PreviewImage {
  mentionPath: string
  previewPath: string
}

const CLAUDE_MODE_OPTIONS: Array<{
  value: ClaudePermissionMode
  label: string
  description: string
}> = [
  {
    value: "default",
    label: "Default",
    description: "标准权限模式",
  },
  {
    value: "plan",
    label: "Plan",
    description: "先规划，再请求执行",
  },
  {
    value: "acceptEdits",
    label: "Accept Edits",
    description: "自动接受编辑类操作",
  },
  {
    value: "dontAsk",
    label: "Don't Ask",
    description: "尽量少打断地执行",
  },
]

function isImageFile(path: string) {
  if (path.startsWith("data:image/")) {
    return true
  }

  const ext = path.split(".").pop()?.toLowerCase()
  return ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"].includes(
    ext || ""
  )
}

function extractImagePaths(text: string, projectPath?: string | null) {
  const quotedRegex = /@"([^"]+)"/g
  const unquotedRegex = /@([^@\n\s]+)/g
  const paths = new Set<string>()

  for (const match of text.matchAll(quotedRegex)) {
    const path = match[1]
    const fullPath =
      path.startsWith("data:") || path.startsWith("/") || !projectPath
        ? path
        : `${projectPath}/${path}`

    if (isImageFile(fullPath)) {
      paths.add(fullPath)
    }
  }

  const textWithoutQuoted = text.replace(quotedRegex, "")
  for (const match of textWithoutQuoted.matchAll(unquotedRegex)) {
    const path = match[1].trim()
    const fullPath =
      path.startsWith("/") || !projectPath ? path : `${projectPath}/${path}`

    if (isImageFile(fullPath)) {
      paths.add(fullPath)
    }
  }

  return Array.from(paths)
}

function collectPreviewImages(
  text: string,
  projectPath: string | null | undefined,
  pastedImages: PreviewImage[]
) {
  const extracted = extractImagePaths(text, projectPath)
  const mentionedPastedImages = pastedImages.filter(
    (image) =>
      text.includes(`@${image.mentionPath}`) || text.includes(`@"${image.mentionPath}"`)
  )
  const mapped = mentionedPastedImages
    .map((image) => image.previewPath)
  const mentionedImagePaths = new Set(
    mentionedPastedImages.map((image) =>
      projectPath ? `${projectPath}/${image.mentionPath.replace(/^\.\//, "")}` : image.mentionPath
    )
  )
  const extractedWithoutMapped = extracted.filter(
    (imagePath) => !mentionedImagePaths.has(imagePath)
  )

  return Array.from(new Set([...mapped, ...extractedWithoutMapped]))
}

export const AgentInput = forwardRef<AgentInputRef, AgentInputProps>(
  function AgentInput(
    {
      disabled,
      isRunning,
      onSend,
      onStop,
      placeholder = "给 agent 一条明确的任务，按 Enter 发送，Shift+Enter 换行",
      hasUnresolvedComments = false,
      unresolvedCount = 0,
      projectPath,
      agentType,
      queueCount = 0,
      claudePermissionMode = "default",
      onClaudePermissionModeChange,
    },
    ref
  ) {
    const [prompt, setPrompt] = useState("")
    const [showFilePicker, setShowFilePicker] = useState(false)
    const [showSlashCommandPicker, setShowSlashCommandPicker] = useState(false)
    const [filePickerQuery, setFilePickerQuery] = useState("")
    const [slashCommandQuery, setSlashCommandQuery] = useState("")
    const [cursorPosition, setCursorPosition] = useState(0)
    const [pastedImages, setPastedImages] = useState<PreviewImage[]>([])
    const [isExpanded, setIsExpanded] = useState(false)
    const [modeMenuOpen, setModeMenuOpen] = useState(false)

    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const expandedTextareaRef = useRef<HTMLTextAreaElement>(null)
    const isIMEComposingRef = useRef(false)
    const modeMenuRef = useRef<HTMLDivElement>(null)

    const activeTextareaRef = isExpanded ? expandedTextareaRef : textareaRef
    const hasContent = prompt.trim().length > 0 || hasUnresolvedComments
    const isClaude = agentType === "claude_code"
    const embeddedImages = useMemo(
      () => collectPreviewImages(prompt, projectPath, pastedImages),
      [pastedImages, projectPath, prompt]
    )
    const currentModeLabel = useMemo(
      () =>
        CLAUDE_MODE_OPTIONS.find((mode) => mode.value === claudePermissionMode)?.label ??
        "Default",
      [claudePermissionMode]
    )

    useImperativeHandle(
      ref,
      () => ({
        addImage(imagePath: string) {
          setPrompt((currentPrompt) => {
            const existingPaths = extractImagePaths(currentPrompt, projectPath)
            if (existingPaths.includes(imagePath)) {
              return currentPrompt
            }

            const mention =
              imagePath.includes(" ") ? `@"${imagePath}"` : `@${imagePath}`
            return `${currentPrompt}${
              currentPrompt && !currentPrompt.endsWith(" ") ? " " : ""
            }${mention} `
          })
        },
      }),
      [projectPath]
    )

    useEffect(() => {
      const target = activeTextareaRef.current
      if (!target) return

      target.style.height = "auto"
      const nextHeight = Math.min(Math.max(target.scrollHeight, 58), isExpanded ? 440 : 180)
      target.style.height = `${nextHeight}px`
    }, [activeTextareaRef, isExpanded, prompt])

    useEffect(() => {
      requestAnimationFrame(() => {
        activeTextareaRef.current?.focus()
      })
    }, [activeTextareaRef])

    useEffect(() => {
      if (!modeMenuOpen) return

      const handlePointerDown = (event: MouseEvent) => {
        if (!modeMenuRef.current?.contains(event.target as Node)) {
          setModeMenuOpen(false)
        }
      }

      window.addEventListener("mousedown", handlePointerDown)
      return () => window.removeEventListener("mousedown", handlePointerDown)
    }, [modeMenuOpen])

    const focusActiveTextarea = (nextPrompt?: string, nextCursorPos?: number) => {
      requestAnimationFrame(() => {
        const target = activeTextareaRef.current
        if (!target) return
        target.focus()
        if (nextPrompt !== undefined) {
          const pos = nextCursorPos ?? nextPrompt.length
          target.setSelectionRange(pos, pos)
        }
      })
    }

    const isIMEInteraction = (event?: KeyboardEvent<HTMLTextAreaElement>) => {
      if (isIMEComposingRef.current) return true
      if (!event) return false

      const nativeEvent = event.nativeEvent
      if (nativeEvent.isComposing) return true

      const key = nativeEvent.key
      if (key === "Process" || key === "Unidentified") return true

      const keyboardEvent = nativeEvent as unknown as { keyCode?: number; which?: number }
      return keyboardEvent.keyCode === 229 || keyboardEvent.which === 229
    }

    const resetTransientUi = () => {
      setShowFilePicker(false)
      setShowSlashCommandPicker(false)
      setFilePickerQuery("")
      setSlashCommandQuery("")
    }

    const handleSend = () => {
      if (isIMEInteraction()) return
      if (!prompt.trim() && !hasUnresolvedComments) return

      onSend?.(prompt.trim())
      setPrompt("")
      setPastedImages([])
      resetTransientUi()
    }

    const handleTextChange = (value: string, nextCursorPosition: number) => {
      if (showSlashCommandPicker) {
        let slashPosition = -1
        for (let index = nextCursorPosition - 1; index >= 0; index -= 1) {
          if (value[index] === "/") {
            slashPosition = index
            break
          }
          if (value[index] === " " || value[index] === "\n") break
        }

        if (slashPosition === -1) {
          setShowSlashCommandPicker(false)
          setSlashCommandQuery("")
        } else if (slashPosition < nextCursorPosition - 1) {
          const afterSlash = value.substring(slashPosition + 1, nextCursorPosition)
          if (afterSlash.includes(" ") || afterSlash.includes("\n")) {
            setShowSlashCommandPicker(false)
            setSlashCommandQuery("")
          } else {
            setSlashCommandQuery(afterSlash)
          }
        } else {
          setSlashCommandQuery("")
        }
      }

      if (showFilePicker) {
        let atPosition = -1
        for (let index = nextCursorPosition - 1; index >= 0; index -= 1) {
          if (value[index] === "@") {
            atPosition = index
            break
          }
          if (value[index] === " " || value[index] === "\n") break
        }

        if (atPosition === -1) {
          setShowFilePicker(false)
          setFilePickerQuery("")
        } else if (atPosition < nextCursorPosition - 1) {
          const afterAt = value.substring(atPosition + 1, nextCursorPosition)
          if (afterAt.includes(" ") || afterAt.includes("\n")) {
            setShowFilePicker(false)
            setFilePickerQuery("")
          } else {
            setFilePickerQuery(afterAt)
          }
        } else {
          setFilePickerQuery("")
        }
      }

      if (
        !showSlashCommandPicker &&
        !showFilePicker &&
        value.length > prompt.length &&
        value[nextCursorPosition - 1] === "/" &&
        (nextCursorPosition === 1 || /\s/.test(value[nextCursorPosition - 2]))
      ) {
        setShowSlashCommandPicker(true)
        setSlashCommandQuery("")
      }

      if (
        !showFilePicker &&
        !showSlashCommandPicker &&
        projectPath?.trim() &&
        value.length > prompt.length &&
        value[nextCursorPosition - 1] === "@"
      ) {
        setShowFilePicker(true)
        setFilePickerQuery("")
      }

      setPrompt(value)
      setCursorPosition(nextCursorPosition)
    }

    const handleFileSelect = (entry: FileEntry) => {
      const atPosition = prompt.lastIndexOf("@", cursorPosition - 1)
      if (atPosition === -1) return

      const basePath = projectPath || ""
      const relativePath = entry.path.startsWith(`${basePath}/`)
        ? entry.path.slice(basePath.length + 1)
        : entry.path
      const mention = relativePath.includes(" ")
        ? `@"${relativePath}"`
        : `@${relativePath}`
      const nextPrompt = `${prompt.slice(0, atPosition)}${mention} ${prompt.slice(cursorPosition)}`

      setPrompt(nextPrompt)
      setShowFilePicker(false)
      setFilePickerQuery("")
      focusActiveTextarea(nextPrompt, atPosition + mention.length + 1)
    }

    const handleSlashCommandSelect = (command: SlashCommand) => {
      const slashPosition = prompt.lastIndexOf("/", cursorPosition - 1)
      if (slashPosition === -1) return

      const inserted = `${command.full_command} `
      const nextPrompt = `${prompt.slice(0, slashPosition)}${inserted}${prompt.slice(cursorPosition)}`

      setPrompt(nextPrompt)
      setShowSlashCommandPicker(false)
      setSlashCommandQuery("")
      focusActiveTextarea(nextPrompt, slashPosition + inserted.length)
    }

    const handleRemoveImage = (index: number) => {
      const imagePath = embeddedImages[index]
      const variants = [`@"${imagePath}"`, `@${imagePath}`]
      const previewImage = pastedImages.find((item) => item.previewPath === imagePath)
      if (previewImage) {
        variants.push(`@"${previewImage.mentionPath}"`, `@${previewImage.mentionPath}`)
      }
      const relativePath =
        projectPath && imagePath.startsWith(`${projectPath}/`)
          ? imagePath.slice(projectPath.length + 1)
          : null

      if (relativePath) {
        variants.push(`@"${relativePath}"`, `@${relativePath}`)
      }

      let nextPrompt = prompt
      variants.forEach((variant) => {
        nextPrompt = nextPrompt.replace(variant, "")
      })

      setPrompt(nextPrompt.replace(/\s{2,}/g, " ").trim())
      if (previewImage) {
        setPastedImages((current) =>
          current.filter((item) => item.mentionPath !== previewImage.mentionPath)
        )
      }
    }

    const appendImagePath = (imagePath: string) => {
      setPrompt((currentPrompt) => {
        const mention = imagePath.includes(" ") ? `@"${imagePath}"` : `@${imagePath}`
        const nextPrompt = `${currentPrompt}${
          currentPrompt && !currentPrompt.endsWith(" ") ? " " : ""
        }${mention} `
        focusActiveTextarea(nextPrompt)
        return nextPrompt
      })
    }

    const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = event.clipboardData?.items
      if (!items) return

      for (const item of items) {
        if (!item.type.startsWith("image/")) continue
        event.preventDefault()
        const file = item.getAsFile()
        if (!file) continue

        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result
          if (typeof dataUrl === "string") {
            if (!projectPath) return
            promptApi
              .savePastedImage(projectPath, dataUrl)
              .then((saved) => {
                setPastedImages((current) => [
                  ...current,
                  {
                    mentionPath: saved.relative_path,
                    // Use the clipboard data URL for preview so pasted images
                    // stay visible even if the saved file path is not webview-readable.
                    previewPath: dataUrl,
                  },
                ])
                appendImagePath(saved.relative_path)
              })
              .catch((error) => {
                console.error("Failed to save pasted image:", error)
              })
          }
        }
        reader.readAsDataURL(file)
      }
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (showFilePicker && event.key === "Escape") {
        event.preventDefault()
        setShowFilePicker(false)
        setFilePickerQuery("")
        return
      }

      if (showSlashCommandPicker && event.key === "Escape") {
        event.preventDefault()
        setShowSlashCommandPicker(false)
        setSlashCommandQuery("")
        return
      }

      if (event.key === "e" && (event.metaKey || event.ctrlKey) && event.shiftKey) {
        event.preventDefault()
        setIsExpanded((current) => !current)
        return
      }

      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !isExpanded &&
        !showFilePicker &&
        !showSlashCommandPicker
      ) {
        if (isIMEInteraction(event)) return
        event.preventDefault()
        handleSend()
      }
    }

    const renderTextarea = () => (
      <Textarea
        ref={activeTextareaRef}
        value={prompt}
        onChange={(event) =>
          handleTextChange(event.target.value, event.target.selectionStart || 0)
        }
        onCompositionStart={() => {
          isIMEComposingRef.current = true
        }}
        onCompositionEnd={() => {
          requestAnimationFrame(() => {
            isIMEComposingRef.current = false
          })
        }}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled && !isRunning}
        className={cn(
          "min-h-[58px] resize-none rounded-[18px] border-0 bg-transparent px-1 py-0 text-[14px] leading-6 shadow-none ring-0 placeholder:text-muted-foreground/70 focus-visible:ring-0 focus-visible:ring-offset-0",
          isExpanded && "min-h-[180px]"
        )}
      />
    )

    const renderComposer = (expanded: boolean) => (
      <div className="relative">
        {showFilePicker && projectPath && (
          <AgentFilePicker
            basePath={projectPath}
            query={filePickerQuery}
            onSelect={handleFileSelect}
            onClose={() => {
              setShowFilePicker(false)
              setFilePickerQuery("")
            }}
          />
        )}

        {showSlashCommandPicker && (
          <AgentSlashCommandPicker
            projectPath={projectPath || undefined}
            agentType={agentType}
            query={slashCommandQuery}
            onSelect={handleSlashCommandSelect}
            onClose={() => {
              setShowSlashCommandPicker(false)
              setSlashCommandQuery("")
            }}
          />
        )}

        <div
          className={cn(
            "rounded-[24px] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(248,250,252,0.92))] p-2.5 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.16)] dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.9),rgba(15,23,42,0.84))]",
            expanded && "p-3.5"
          )}
        >
          <div className="space-y-2.5">
            {embeddedImages.length > 0 && (
              <AgentImagePreview
                images={embeddedImages}
                onRemove={handleRemoveImage}
                className="mb-1"
                projectPath={projectPath}
              />
            )}

            <div className="rounded-[18px] border border-border/60 bg-background/72 px-3 py-2.5">
              {renderTextarea()}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
                {hasUnresolvedComments && (
                  <div className="flex items-center gap-1.5 rounded-md bg-yellow-500/10 px-2 py-0.5 text-[11px] text-yellow-600 dark:text-yellow-400">
                    <MessageSquare className="h-2.5 w-2.5" />
                    <span>{unresolvedCount || "多"} 条待发送评论</span>
                  </div>
                )}
                {projectPath && (
                  <span className="flex items-center gap-1">
                    <FolderOpen className="h-3 w-3" />
                    @ 文件
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <Slash className="h-3 w-3" />
                  / 命令
                </span>
                <span className="flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3" />
                  图片粘贴
                </span>
                {queueCount > 0 && (
                  <div className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:text-blue-300">
                    Queue {queueCount}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                {isClaude && (
                  <div className="relative" ref={modeMenuRef}>
                    <button
                      type="button"
                      onClick={() => setModeMenuOpen((current) => !current)}
                      className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.86))] px-3 text-xs text-foreground transition hover:border-foreground/20 dark:bg-[linear-gradient(180deg,rgba(30,41,59,0.72),rgba(15,23,42,0.7))]"
                      title="Claude Code 模式"
                    >
                      <span className="text-muted-foreground">Mode</span>
                      <span className="font-medium">{currentModeLabel}</span>
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 text-muted-foreground transition",
                          modeMenuOpen && "rotate-180"
                        )}
                      />
                    </button>
                    {modeMenuOpen && (
                      <div className="absolute bottom-[calc(100%+0.5rem)] right-0 z-50 min-w-[180px] overflow-hidden rounded-2xl border border-border bg-popover/95 p-1 shadow-[0_18px_44px_-28px_rgba(15,23,42,0.22)] backdrop-blur">
                        {CLAUDE_MODE_OPTIONS.map((mode) => (
                          <button
                            key={mode.value}
                            type="button"
                            onClick={() => {
                              onClaudePermissionModeChange?.(mode.value)
                              setModeMenuOpen(false)
                            }}
                            className={cn(
                              "flex w-full flex-col items-start rounded-xl px-3 py-2 text-left transition",
                              claudePermissionMode === mode.value
                                ? "bg-accent text-foreground"
                                : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
                            )}
                          >
                            <span className="text-xs font-medium">{mode.label}</span>
                            <span className="text-[11px] opacity-80">
                              {mode.description}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {isRunning && onStop && (
                  <Button
                    type="button"
                    onClick={onStop}
                    variant="destructive"
                    size="icon"
                    className="h-9 w-9 rounded-full"
                    title="停止"
                  >
                      <Square className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={handleSend}
                  disabled={disabled ? !isRunning || !hasContent : !hasContent}
                  className={cn(
                    "h-9 rounded-full px-3.5 shadow-none",
                    hasContent
                      ? "bg-orange-500 text-white hover:bg-orange-600"
                      : "bg-muted text-muted-foreground hover:bg-muted"
                  )}
                >
                  <Send className="mr-2 h-4 w-4" />
                  {isRunning ? "加入队列" : "发送"}
                </Button>
                {!expanded && (
                  <Button
                    type="button"
                    onClick={() => setIsExpanded(true)}
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-full"
                    title="展开"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    )

    return (
      <>
        <div className="border-t border-border/70 bg-background/80 p-2.5 backdrop-blur-md">
          {renderComposer(false)}
        </div>

        {isExpanded && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
            onClick={() => setIsExpanded(false)}
          >
            <div
              className="w-full max-w-5xl"
              onClick={(event) => event.stopPropagation()}
            >
              {renderComposer(true)}
            </div>
          </div>
        )}
      </>
    )
  }
)
