"use client"

import { memo, useState, type ReactNode } from "react"
import {
  FileText,
  FilePenLine,
  FilePlus,
  Terminal,
  Search,
  Globe,
  ListTodo,
  Sparkles,
  Wrench,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  XCircle,
  Loader2,
  FolderSearch,
  PlayCircle,
  Notebook,
} from "lucide-react"
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolOutput,
} from "@/components/ai-elements/tool"
import { Terminal as TerminalOutput } from "@/components/ai-elements/terminal"
import { CodeBlock } from "@/components/ai-elements/code-block"
import { MarkdownContent } from "./MarkdownContent"
import type { AgentLogEntry } from "@/lib/types"

interface AgentOutputProps {
  entry: AgentLogEntry
  isLatest?: boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────

function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text)
    return typeof parsed === "object" && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

function shortenPath(filePath: string): string {
  const parts = filePath.split("/")
  return parts.length > 2 ? parts.slice(-2).join("/") : filePath
}

function simplifyShellCommand(command: string): string {
  const firstLine = command.split("\n")[0].trim()
  if (firstLine.length <= 80) return firstLine
  // Show first 77 chars + ellipsis
  return firstLine.slice(0, 77) + "…"
}

// ── Tool Normalization ──────────────────────────────────────────────────

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

function normalizeToolName(toolName: string | null): string {
  if (!toolName) return ""
  const lower = toolName.toLowerCase()
  return TOOL_ALIASES[lower] ?? lower
}

// ── Tool Icon ───────────────────────────────────────────────────────────

function getToolIcon(toolName: string | null): ReactNode {
  const name = normalizeToolName(toolName)

  switch (name) {
    case "read":
      return <FileText className="size-4 text-muted-foreground" />
    case "edit":
      return <FilePenLine className="size-4 text-muted-foreground" />
    case "write":
      return <FilePlus className="size-4 text-muted-foreground" />
    case "bash":
      return <Terminal className="size-4 text-muted-foreground" />
    case "glob":
      return <FolderSearch className="size-4 text-muted-foreground" />
    case "grep":
      return <Search className="size-4 text-muted-foreground" />
    case "webfetch":
      return <Globe className="size-4 text-muted-foreground" />
    case "websearch":
      return <Globe className="size-4 text-muted-foreground" />
    case "todowrite":
      return <ListTodo className="size-4 text-muted-foreground" />
    case "skill":
      return <Sparkles className="size-4 text-muted-foreground" />
    case "task":
      return <PlayCircle className="size-4 text-muted-foreground" />
    case "notebookedit":
      return <Notebook className="size-4 text-muted-foreground" />
    default:
      return <Wrench className="size-4 text-muted-foreground" />
  }
}

// ── Tool State ──────────────────────────────────────────────────────────

function getToolState(
  entry: AgentLogEntry
): "input-available" | "input-streaming" | "output-available" | "output-error" {
  if (entry.entryType === "error") return "output-error"
  if (entry.entryType === "tool_result") return "output-available"
  if (entry.entryType === "tool_call") return "input-available"
  return "output-available"
}

// ── Tool Title Derivation (comprehensive, following codeg) ──────────────

function deriveToolTitle(toolName: string | null, content: string): string {
  if (!toolName) return "Tool"
  const name = normalizeToolName(toolName)
  const parsed = tryParseJson(content)

  if (parsed) {
    // File operations
    const filePath = (parsed.file_path ??
      parsed.filePath ??
      parsed.path ??
      parsed.target_file) as string | undefined
    if (filePath) {
      const short = shortenPath(filePath)
      if (name === "read") return `Read ${short}`
      if (name === "edit") return `Edit ${short}`
      if (name === "write") return `Write ${short}`
    }

    // Bash/command
    const command = (parsed.command ?? parsed.cmd) as string | undefined
    if (command && name === "bash") {
      return simplifyShellCommand(command)
    }

    // Search operations
    const pattern = parsed.pattern as string | undefined
    if (pattern && name === "glob") return `Glob ${pattern}`
    if (pattern && name === "grep") return `Grep "${pattern.slice(0, 40)}"`

    // Web operations
    const url = parsed.url as string | undefined
    if (url && name === "webfetch") {
      try {
        return `Fetch ${new URL(url).hostname}`
      } catch {
        return `Fetch ${url.slice(0, 50)}`
      }
    }

    const query = parsed.query as string | undefined
    if (query && name === "websearch") return `Search: ${query.slice(0, 40)}`

    // Task tool
    const description = parsed.description as string | undefined
    if (description && name === "task")
      return `Task: ${description.slice(0, 50)}`

    // Skill tool
    const skill = parsed.skill as string | undefined
    if (skill && name === "skill") return `Skill: ${skill}`

    // TodoWrite
    if (name === "todowrite") return "Update Todos"

    // NotebookEdit
    const notebookPath = parsed.notebook_path as string | undefined
    if (notebookPath && name === "notebookedit")
      return `Notebook ${shortenPath(notebookPath)}`
  }

  return toolName
}

// ── Command Tool Detection ──────────────────────────────────────────────

function extractCommand(content: string): string | null {
  const parsed = tryParseJson(content)
  if (!parsed) return null
  return (parsed.command ?? parsed.cmd) as string | null
}

// ── Structured Tool Input Renderers ─────────────────────────────────────

function BashToolInput({ content }: { content: string }) {
  const command = extractCommand(content)
  if (!command) return <GenericToolInput content={content} />

  // Build terminal-style command display
  const parsed = tryParseJson(content)
  const description = parsed?.description as string | undefined
  const timeout = parsed?.timeout as number | undefined

  return (
    <div className="space-y-2">
      {description && (
        <div className="text-xs text-muted-foreground italic px-1">
          {description}
        </div>
      )}
      <TerminalOutput output={`$ ${command}`} />
      {timeout && (
        <div className="text-xs text-muted-foreground px-1">
          Timeout: {Math.round(timeout / 1000)}s
        </div>
      )}
    </div>
  )
}

function EditToolInput({ content }: { content: string }) {
  const parsed = tryParseJson(content)
  if (!parsed) return <GenericToolInput content={content} />

  const filePath = (parsed.file_path ?? parsed.filePath ?? parsed.path) as
    | string
    | undefined
  const oldString = parsed.old_string as string | undefined
  const newString = parsed.new_string as string | undefined

  return (
    <div className="space-y-3">
      {filePath && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileText className="size-3" />
          <span className="font-mono">{filePath}</span>
        </div>
      )}
      {oldString !== undefined && newString !== undefined && (
        <div className="space-y-1">
          <div className="rounded-md overflow-hidden border">
            <div className="bg-red-500/10 border-b">
              <div className="px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400">
                − Old
              </div>
              <pre className="px-3 py-2 text-xs font-mono whitespace-pre-wrap break-all text-red-800 dark:text-red-300 bg-red-500/5">
                {oldString || "(empty)"}
              </pre>
            </div>
            <div className="bg-green-500/10">
              <div className="px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-400">
                + New
              </div>
              <pre className="px-3 py-2 text-xs font-mono whitespace-pre-wrap break-all text-green-800 dark:text-green-300 bg-green-500/5">
                {newString || "(empty)"}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function WriteToolInput({ content }: { content: string }) {
  const parsed = tryParseJson(content)
  if (!parsed) return <GenericToolInput content={content} />

  const filePath = (parsed.file_path ?? parsed.filePath ?? parsed.path) as
    | string
    | undefined
  const fileContent = parsed.content as string | undefined

  return (
    <div className="space-y-2">
      {filePath && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FilePlus className="size-3" />
          <span className="font-mono">{filePath}</span>
        </div>
      )}
      {fileContent && (
        <div className="max-h-64 overflow-auto">
          <CodeBlock code={fileContent.slice(0, 2000)} language="log" />
        </div>
      )}
    </div>
  )
}

function ReadToolInput({ content }: { content: string }) {
  const parsed = tryParseJson(content)
  if (!parsed) return <GenericToolInput content={content} />

  const filePath = (parsed.file_path ?? parsed.filePath ?? parsed.path) as
    | string
    | undefined
  const offset = parsed.offset as number | undefined
  const limit = parsed.limit as number | undefined

  return (
    <div className="space-y-1">
      {filePath && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileText className="size-3" />
          <span className="font-mono">{filePath}</span>
        </div>
      )}
      {(offset !== undefined || limit !== undefined) && (
        <div className="text-xs text-muted-foreground px-1">
          {offset !== undefined && `Line ${offset}`}
          {offset !== undefined && limit !== undefined && " — "}
          {limit !== undefined && `${limit} lines`}
        </div>
      )}
    </div>
  )
}

function SearchToolInput({ content }: { content: string }) {
  const parsed = tryParseJson(content)
  if (!parsed) return <GenericToolInput content={content} />

  const pattern = (parsed.pattern ?? parsed.query) as string | undefined
  const path = parsed.path as string | undefined
  const glob = parsed.glob as string | undefined

  return (
    <div className="space-y-1">
      {pattern && (
        <div className="flex items-center gap-2 text-xs">
          <Search className="size-3 text-muted-foreground" />
          <code className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-xs">
            {pattern}
          </code>
        </div>
      )}
      {path && (
        <div className="text-xs text-muted-foreground px-1">
          in <span className="font-mono">{path}</span>
        </div>
      )}
      {glob && (
        <div className="text-xs text-muted-foreground px-1">
          glob: <span className="font-mono">{glob}</span>
        </div>
      )}
    </div>
  )
}

function GenericToolInput({ content }: { content: string }) {
  const formatted = (() => {
    const parsed = tryParseJson(content)
    if (parsed) return JSON.stringify(parsed, null, 2)
    return content
  })()

  return (
    <div className="space-y-2">
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        参数
      </h4>
      <CodeBlock code={formatted} language="json" />
    </div>
  )
}

// ── Tool Input Router ───────────────────────────────────────────────────

function ToolInputContent({ entry }: { entry: AgentLogEntry }) {
  if (!entry.content) return null

  const name = normalizeToolName(entry.toolName)

  switch (name) {
    case "bash":
      return <BashToolInput content={entry.content} />
    case "edit":
      return <EditToolInput content={entry.content} />
    case "write":
      return <WriteToolInput content={entry.content} />
    case "read":
      return <ReadToolInput content={entry.content} />
    case "glob":
    case "grep":
      return <SearchToolInput content={entry.content} />
    default:
      return <GenericToolInput content={entry.content} />
  }
}

// ── Main Output Components ──────────────────────────────────────────────

const ToolCallOutput = memo(function ToolCallOutput({
  entry,
}: {
  entry: AgentLogEntry
}) {
  const toolName = entry.toolName || "Tool"
  const state = getToolState(entry)
  const icon = getToolIcon(entry.toolName)
  const title = deriveToolTitle(entry.toolName, entry.content)

  return (
    <Tool defaultOpen={state === "input-available"}>
      <ToolHeader toolName={toolName} state={state} title={title} icon={icon} />
      <ToolContent>
        <ToolInputContent entry={entry} />
      </ToolContent>
    </Tool>
  )
})

const ToolResultOutput = memo(function ToolResultOutput({
  entry,
}: {
  entry: AgentLogEntry
}) {
  const isError = entry.entryType === "error"

  return (
    <Tool>
      <ToolHeader
        toolName="Result"
        state={isError ? "output-error" : "output-available"}
        icon={
          isError ? (
            <XCircle className="size-4 text-red-500" />
          ) : (
            <CheckCircle className="size-4 text-green-500" />
          )
        }
      />
      <ToolContent>
        <ToolOutput
          output={entry.content}
          errorText={isError ? entry.content : null}
          renderAsMarkdown
        />
      </ToolContent>
    </Tool>
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
    <div className="text-sm">
      <MarkdownContent content={entry.content} />
      {isLatest && (
        <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-foreground" />
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
    <div className="rounded-2xl border border-border/80 bg-muted/25 text-xs shadow-[0_12px_32px_-28px_rgba(15,23,42,0.45)]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <span className="font-medium text-muted-foreground">思考中...</span>
        {isLatest && <Loader2 className="h-3 w-3 animate-spin" />}
      </button>
      {expanded && (
        <div className="border-t border-border/70 px-4 pb-4">
          <div className="mt-3 max-h-64 overflow-auto text-xs text-muted-foreground">
            <MarkdownContent content={entry.content} className="prose-xs" />
          </div>
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
      return (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <MarkdownContent content={entry.content} />
        </div>
      )
    case "text":
    default:
      return <TextOutput entry={entry} isLatest={isLatest} />
  }
}
