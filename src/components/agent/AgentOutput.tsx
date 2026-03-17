"use client"

import { memo, useMemo, useState, type ReactNode } from "react"
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  FileCode2,
  FilePenLine,
  FilePlus2,
  FileSearch,
  FileText,
  FolderSearch,
  Globe,
  Loader2,
  NotebookPen,
  PlaySquare,
  Search,
  Sparkles,
  Terminal,
  Wrench,
  XCircle,
  Copy,
} from "lucide-react"
import { CodeBlock } from "@/components/ai-elements/code-block"
import { MarkdownContent } from "./MarkdownContent"
import type { AgentLogEntry } from "@/lib/types"
import { cn } from "@/lib/utils"

interface AgentOutputProps {
  entry: AgentLogEntry
  isLatest?: boolean
}

type ParsedJson = Record<string, unknown>
type TodoStatus = "pending" | "in_progress" | "completed"

interface TodoItem {
  id?: string
  content: string
  status?: TodoStatus
  priority?: "high" | "medium" | "low"
}

const TOOL_ALIASES: Record<string, string> = {
  read_file: "read",
  exec_command: "bash",
  apply_patch: "edit",
  write_to_file: "write",
  list_files: "glob",
  search_files: "grep",
  web_search: "websearch",
  web_fetch: "webfetch",
  todo_write: "todowrite",
}

function tryParseJson(text: string): ParsedJson | null {
  try {
    const parsed = JSON.parse(text)
    return typeof parsed === "object" && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

function normalizeToolName(toolName: string | null): string {
  if (!toolName) return ""
  const lower = toolName.toLowerCase()
  return TOOL_ALIASES[lower] ?? lower
}

function shortenPath(path: string) {
  const parts = path.split("/")
  return parts.length > 3 ? parts.slice(-3).join("/") : path
}

function truncateCommand(command: string) {
  const firstLine = command.split("\n")[0]?.trim() ?? command.trim()
  return firstLine.length > 88 ? `${firstLine.slice(0, 85)}...` : firstLine
}

function getToolMeta(toolName: string | null): {
  icon: ReactNode
  label: string
  tint: string
} {
  const name = normalizeToolName(toolName)

  switch (name) {
    case "read":
      return {
        icon: <FileText className="h-4 w-4" />,
        label: "Read",
        tint: "text-sky-700 dark:text-sky-300 bg-sky-500/10 border-sky-500/20",
      }
    case "edit":
      return {
        icon: <FilePenLine className="h-4 w-4" />,
        label: "Edit",
        tint: "text-orange-700 dark:text-orange-300 bg-orange-500/10 border-orange-500/20",
      }
    case "write":
      return {
        icon: <FilePlus2 className="h-4 w-4" />,
        label: "Write",
        tint: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/20",
      }
    case "bash":
      return {
        icon: <Terminal className="h-4 w-4" />,
        label: "Bash",
        tint: "text-violet-700 dark:text-violet-300 bg-violet-500/10 border-violet-500/20",
      }
    case "glob":
      return {
        icon: <FolderSearch className="h-4 w-4" />,
        label: "Glob",
        tint: "text-cyan-700 dark:text-cyan-300 bg-cyan-500/10 border-cyan-500/20",
      }
    case "grep":
      return {
        icon: <Search className="h-4 w-4" />,
        label: "Search",
        tint: "text-pink-700 dark:text-pink-300 bg-pink-500/10 border-pink-500/20",
      }
    case "websearch":
    case "webfetch":
      return {
        icon: <Globe className="h-4 w-4" />,
        label: "Web",
        tint: "text-blue-700 dark:text-blue-300 bg-blue-500/10 border-blue-500/20",
      }
    case "todowrite":
      return {
        icon: <NotebookPen className="h-4 w-4" />,
        label: "Todos",
        tint: "text-teal-700 dark:text-teal-300 bg-teal-500/10 border-teal-500/20",
      }
    case "task":
      return {
        icon: <PlaySquare className="h-4 w-4" />,
        label: "Task",
        tint: "text-indigo-700 dark:text-indigo-300 bg-indigo-500/10 border-indigo-500/20",
      }
    case "skill":
      return {
        icon: <Sparkles className="h-4 w-4" />,
        label: "Skill",
        tint: "text-fuchsia-700 dark:text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/20",
      }
    case "notebookedit":
      return {
        icon: <FileCode2 className="h-4 w-4" />,
        label: "Notebook",
        tint: "text-amber-700 dark:text-amber-300 bg-amber-500/10 border-amber-500/20",
      }
    default:
      return {
        icon: <Wrench className="h-4 w-4" />,
        label: toolName || "Tool",
        tint: "text-muted-foreground bg-muted/60 border-border",
      }
  }
}

function getToolTitle(toolName: string | null, content: string) {
  const name = normalizeToolName(toolName)
  const parsed = tryParseJson(content)
  if (!parsed) {
    return toolName || "Tool"
  }

  const filePath = (parsed.file_path ??
    parsed.filePath ??
    parsed.path ??
    parsed.target_file ??
    parsed.notebook_path) as string | undefined
  const command = (parsed.command ?? parsed.cmd) as string | undefined
  const pattern = (parsed.pattern ?? parsed.query) as string | undefined
  const description = parsed.description as string | undefined
  const url = parsed.url as string | undefined

  if (name === "bash" && command) return truncateCommand(command)
  if (filePath && ["read", "edit", "write", "notebookedit"].includes(name)) {
    return shortenPath(filePath)
  }
  if ((name === "glob" || name === "grep") && pattern) return pattern
  if (name === "task" && description) return description
  if (name === "webfetch" && url) return url
  if (name === "todowrite") return "Todo list update"

  return toolName || "Tool"
}

function parseTodos(content: string): TodoItem[] {
  const parsed = tryParseJson(content)
  const todos = parsed?.todos
  if (!Array.isArray(todos)) return []

  const items: TodoItem[] = []
  for (const todo of todos) {
    if (!todo || typeof todo !== "object") continue
    const item = todo as Record<string, unknown>
    const text = typeof item.content === "string" ? item.content : null
    if (!text) continue

    items.push({
      id: typeof item.id === "string" ? item.id : undefined,
      content: text,
      status: typeof item.status === "string" ? (item.status as TodoStatus) : "pending",
      priority:
        typeof item.priority === "string"
          ? (item.priority as "high" | "medium" | "low")
          : undefined,
    })
  }
  return items
}

function CardShell({
  header,
  eyebrow,
  tone,
  action,
  children,
}: {
  header: ReactNode
  eyebrow?: ReactNode
  tone?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[22px] border bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,250,252,0.88))] shadow-[0_16px_38px_-30px_rgba(15,23,42,0.18)] dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(15,23,42,0.8))]",
        tone ?? "border-border/70"
      )}
    >
      <div className="border-b border-border/60 px-4 py-3">
        {eyebrow}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">{header}</div>
          {action}
        </div>
      </div>
      <div className="px-4 py-4">{children}</div>
    </div>
  )
}

function CopyButton({
  value,
  className,
}: {
  value: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        } catch (error) {
          console.error("Failed to copy:", error)
        }
      }}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background/80 text-muted-foreground transition hover:text-foreground",
        className
      )}
      title="复制"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

function TodoWidget({ todos }: { todos: TodoItem[] }) {
  const statusIcons: Record<TodoStatus, ReactNode> = {
    completed: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
    in_progress: <Clock3 className="h-4 w-4 text-blue-500" />,
    pending: <Circle className="h-4 w-4 text-muted-foreground" />,
  }

  const priorityStyles = {
    high: "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300",
    medium:
      "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    low: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  }

  const completedCount = todos.filter((todo) => todo.status === "completed").length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-2xl border border-teal-500/20 bg-teal-500/10 px-3 py-2 text-xs text-teal-700 dark:text-teal-300">
        <div className="flex items-center gap-2">
          <NotebookPen className="h-4 w-4" />
          <span className="font-medium">Todo List</span>
        </div>
        <span>
          {completedCount}/{todos.length} done
        </span>
      </div>

      <div className="space-y-2">
        {todos.map((todo, index) => (
          <div
            key={todo.id ?? `${todo.content}-${index}`}
            className={cn(
              "rounded-2xl border px-3 py-3 shadow-[0_12px_40px_-34px_rgba(15,23,42,0.75)]",
              todo.status === "completed"
                ? "border-emerald-500/15 bg-emerald-500/5 opacity-75"
                : "border-border/70 bg-background/80"
            )}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5">{statusIcons[todo.status ?? "pending"]}</div>
              <div className="min-w-0 flex-1 space-y-2">
                <div
                  className={cn(
                    "text-sm leading-6",
                    todo.status === "completed" && "line-through text-muted-foreground"
                  )}
                >
                  {todo.content}
                </div>
                {todo.priority && (
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2 py-1 text-[11px] font-medium",
                      priorityStyles[todo.priority]
                    )}
                  >
                    {todo.priority}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BashWidget({ parsed, raw }: { parsed: ParsedJson | null; raw: string }) {
  const command = (parsed?.command ?? parsed?.cmd) as string | undefined
  const description = parsed?.description as string | undefined
  const timeout = parsed?.timeout as number | undefined

  return (
    <div className="space-y-3">
      {description && (
        <div className="rounded-2xl border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-xs text-violet-700 dark:text-violet-300">
          {description}
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(241,245,249,0.88))] text-slate-800 dark:bg-[linear-gradient(180deg,rgba(30,41,59,0.74),rgba(15,23,42,0.7))] dark:text-slate-100">
        <div className="flex items-center gap-1 border-b border-border/60 px-3 py-2">
          <span className="h-2 w-2 rounded-full bg-red-400/80" />
          <span className="h-2 w-2 rounded-full bg-amber-400/80" />
          <span className="h-2 w-2 rounded-full bg-emerald-400/80" />
          <span className="ml-2 text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            terminal
          </span>
          <div className="ml-auto">
            <CopyButton value={command ?? raw} className="h-6 w-6 border-transparent bg-transparent" />
          </div>
        </div>
        <pre className="overflow-x-auto px-4 py-4 text-xs leading-6">
          <code>{`$ ${command ?? raw}`}</code>
        </pre>
      </div>
      {timeout && (
        <div className="text-xs text-muted-foreground">
          Timeout: {Math.round(timeout / 1000)}s
        </div>
      )}
    </div>
  )
}

function FileWidget({
  parsed,
  raw,
  mode,
}: {
  parsed: ParsedJson | null
  raw: string
  mode: "read" | "edit" | "write"
}) {
  const filePath = (parsed?.file_path ??
    parsed?.filePath ??
    parsed?.path ??
    parsed?.target_file) as string | undefined
  const oldString = parsed?.old_string as string | undefined
  const newString = parsed?.new_string as string | undefined
  const fileContent = parsed?.content as string | undefined
  const offset = parsed?.offset as number | undefined
  const limit = parsed?.limit as number | undefined

  return (
    <div className="space-y-3">
      {filePath && (
        <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
          {mode === "read" ? (
            <FileText className="h-4 w-4" />
          ) : mode === "edit" ? (
            <FilePenLine className="h-4 w-4" />
          ) : (
            <FilePlus2 className="h-4 w-4" />
          )}
          <span className="font-mono">{filePath}</span>
          <div className="ml-auto">
            <CopyButton value={filePath} className="h-6 w-6 border-transparent bg-transparent" />
          </div>
        </div>
      )}

      {mode === "read" && (offset !== undefined || limit !== undefined) && (
        <div className="text-xs text-muted-foreground">
          {offset !== undefined && `Line ${offset}`}
          {offset !== undefined && limit !== undefined && " · "}
          {limit !== undefined && `${limit} lines`}
        </div>
      )}

      {mode === "edit" && oldString !== undefined && newString !== undefined && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="overflow-hidden rounded-2xl border border-red-500/15 bg-red-500/5">
            <div className="border-b border-red-500/10 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-300">
              Old
            </div>
            <div className="max-h-64 overflow-auto p-3">
              <CodeBlock code={oldString || "(empty)"} language="log" />
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-emerald-500/15 bg-emerald-500/5">
            <div className="border-b border-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              New
            </div>
            <div className="max-h-64 overflow-auto p-3">
              <CodeBlock code={newString || "(empty)"} language="log" />
            </div>
          </div>
        </div>
      )}

      {mode === "write" && fileContent && (
        <div className="max-h-72 overflow-auto rounded-2xl border border-border/70">
          <CodeBlock code={fileContent.slice(0, 4000)} language="log" />
        </div>
      )}

      {mode === "read" && !filePath && (
        <CodeBlock code={raw} language="json" />
      )}
    </div>
  )
}

function SearchWidget({ parsed, raw }: { parsed: ParsedJson | null; raw: string }) {
  const pattern = (parsed?.pattern ?? parsed?.query) as string | undefined
  const path = parsed?.path as string | undefined
  const glob = parsed?.glob as string | undefined

  return (
    <div className="space-y-3">
      {pattern && (
        <div className="inline-flex items-center gap-2 rounded-full border border-pink-500/20 bg-pink-500/10 px-3 py-1.5 text-xs text-pink-700 dark:text-pink-300">
          <FileSearch className="h-3.5 w-3.5" />
          <code>{pattern}</code>
        </div>
      )}
      {(path || glob) && (
        <div className="rounded-2xl border border-border/70 bg-muted/35 px-3 py-3 text-xs text-muted-foreground">
          {path && <div>Path: <span className="font-mono">{path}</span></div>}
          {glob && <div>Glob: <span className="font-mono">{glob}</span></div>}
        </div>
      )}
      {!pattern && <CodeBlock code={raw} language="json" />}
    </div>
  )
}

function GenericWidget({ raw }: { raw: string }) {
  const parsed = tryParseJson(raw)
  return <CodeBlock code={parsed ? JSON.stringify(parsed, null, 2) : raw} language="json" />
}

const ToolCallOutput = memo(function ToolCallOutput({
  entry,
}: {
  entry: AgentLogEntry
}) {
  const parsed = useMemo(() => tryParseJson(entry.content), [entry.content])
  const toolMeta = getToolMeta(entry.toolName)
  const normalized = normalizeToolName(entry.toolName)
  const title = getToolTitle(entry.toolName, entry.content)
  const todos = normalized === "todowrite" ? parseTodos(entry.content) : []

  let body: ReactNode = <GenericWidget raw={entry.content} />

  if (normalized === "todowrite" && todos.length > 0) {
    body = <TodoWidget todos={todos} />
  } else if (normalized === "bash") {
    body = <BashWidget parsed={parsed} raw={entry.content} />
  } else if (normalized === "read") {
    body = <FileWidget parsed={parsed} raw={entry.content} mode="read" />
  } else if (normalized === "edit") {
    body = <FileWidget parsed={parsed} raw={entry.content} mode="edit" />
  } else if (normalized === "write") {
    body = <FileWidget parsed={parsed} raw={entry.content} mode="write" />
  } else if (normalized === "glob" || normalized === "grep") {
    body = <SearchWidget parsed={parsed} raw={entry.content} />
  }

  return (
    <CardShell
      tone="border-border/70"
      eyebrow={
        <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <div
            className={cn(
              "flex items-center gap-2 rounded-full border px-2.5 py-1",
              toolMeta.tint
            )}
          >
            {toolMeta.icon}
            <span>{toolMeta.label}</span>
          </div>
        </div>
      }
      header={
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 text-sm font-medium text-foreground">{title}</div>
          <div className="text-[11px] text-muted-foreground">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </div>
        </div>
      }
      action={<CopyButton value={entry.content} />}
    >
      {body}
    </CardShell>
  )
})

const ToolResultOutput = memo(function ToolResultOutput({
  entry,
}: {
  entry: AgentLogEntry
}) {
  const isError = entry.entryType === "error"

  return (
    <CardShell
      tone={isError ? "border-red-500/20" : "border-emerald-500/20"}
      eyebrow={
        <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <div
            className={cn(
              "flex items-center gap-2 rounded-full border px-2.5 py-1",
              isError
                ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300"
                : "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            )}
          >
            {isError ? (
              <XCircle className="h-4 w-4" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            <span>{isError ? "Error" : "Result"}</span>
          </div>
        </div>
      }
      header={
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium text-foreground">
            {isError ? "Tool execution failed" : "Tool execution completed"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </div>
        </div>
      }
      action={<CopyButton value={entry.content} />}
    >
      <div
        className={cn(
          "rounded-2xl border px-4 py-3 text-sm",
          isError ? "border-red-500/15 bg-red-500/5" : "border-border/60 bg-muted/25"
        )}
      >
        <MarkdownContent content={entry.content} />
      </div>
    </CardShell>
  )
})

const TextOutput = memo(function TextOutput({
  entry,
  isLatest,
}: {
  entry: AgentLogEntry
  isLatest: boolean
}) {
  return (
    <div className="rounded-[22px] border border-border/60 bg-background/65 px-4 py-3 text-sm leading-7 shadow-[0_14px_32px_-26px_rgba(15,23,42,0.14)]">
      <div className="mb-2 flex justify-end">
        <CopyButton value={entry.content} />
      </div>
      <MarkdownContent content={entry.content} />
      {isLatest && (
        <span className="ml-1 inline-flex h-4 w-2 animate-pulse rounded-sm bg-foreground/80" />
      )}
    </div>
  )
})

const ThinkingOutput = memo(function ThinkingOutput({
  entry,
  isLatest,
}: {
  entry: AgentLogEntry
  isLatest: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="overflow-hidden rounded-[22px] border border-amber-500/15 bg-amber-500/5 shadow-[0_14px_32px_-24px_rgba(245,158,11,0.18)]">
      <div className="flex items-center gap-2 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left transition hover:text-amber-800 dark:hover:text-amber-200"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          <Sparkles className="h-3.5 w-3.5" />
          <span className="font-medium uppercase tracking-[0.18em]">Thinking</span>
          {isLatest && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        </button>
        <CopyButton value={entry.content} className="h-6 w-6 border-transparent bg-transparent" />
      </div>
      {expanded && (
        <div className="border-t border-amber-500/10 px-4 py-4 text-sm">
          <MarkdownContent content={entry.content} />
        </div>
      )}
    </div>
  )
})

export function AgentOutput({ entry, isLatest = false }: AgentOutputProps) {
  switch (entry.entryType) {
    case "tool_call":
      return <ToolCallOutput entry={entry} />
    case "tool_result":
      return <ToolResultOutput entry={entry} />
    case "thinking":
      return <ThinkingOutput entry={entry} isLatest={isLatest} />
    case "error":
      return <ToolResultOutput entry={entry} />
    case "text":
    default:
      return <TextOutput entry={entry} isLatest={isLatest} />
  }
}
