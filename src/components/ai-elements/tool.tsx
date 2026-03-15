"use client"

import type { ReactNode, ComponentProps } from "react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Badge } from "@/components/ui/badge"
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react"
import { CodeBlock } from "./code-block"
import { MarkdownContent } from "@/components/agent/MarkdownContent"

export type ToolState =
  | "input-available"
  | "input-streaming"
  | "output-available"
  | "output-error"
  | "output-denied"

export type ToolProps = ComponentProps<typeof Collapsible>

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn(
      "group mb-3 w-full overflow-hidden rounded-2xl border border-border/80 bg-card/70 shadow-[0_14px_38px_-30px_rgba(15,23,42,0.45)] backdrop-blur",
      className
    )}
    {...props}
  />
)

export type ToolHeaderProps = {
  title?: ReactNode
  titleSuffix?: ReactNode
  icon?: ReactNode
  className?: string
  toolName: string
  state: ToolState
}

const statusIcons: Record<ToolState, ReactNode> = {
  "input-available": <ClockIcon className="size-4 animate-pulse" />,
  "input-streaming": <CircleIcon className="size-4" />,
  "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
  "output-denied": <XCircleIcon className="size-4 text-orange-600" />,
  "output-error": <XCircleIcon className="size-4 text-red-600" />,
}

const statusLabels: Record<ToolState, string> = {
  "input-available": "Running",
  "input-streaming": "Streaming",
  "output-available": "Done",
  "output-denied": "Denied",
  "output-error": "Error",
}

export const ToolHeader = ({
  className,
  title,
  titleSuffix,
  icon,
  toolName,
  state,
  ...props
}: ToolHeaderProps) => {
  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full min-w-0 items-center justify-between gap-4 bg-muted/25 px-4 py-3 text-left transition-colors hover:bg-muted/40",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0">
          {icon ?? <WrenchIcon className="size-4 text-muted-foreground" />}
        </span>
        <span className="min-w-0 flex-1 truncate whitespace-nowrap font-medium text-sm">
          {title ?? toolName}
        </span>
        {titleSuffix ? <span className="shrink-0">{titleSuffix}</span> : null}
        <Badge
          className="gap-1.5 rounded-full border border-border bg-background/80 text-[11px] font-medium shadow-none"
          variant="secondary"
        >
          {statusIcons[state]}
          {statusLabels[state]}
        </Badge>
      </div>
      <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  )
}

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 space-y-4 border-t border-border/70 bg-background/55 p-4 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
)

// ── Output Language Detection ─────────────────────────────────────────

function detectOutputLanguage(text: string): "json" | "diff" | "xml" | "log" {
  const trimmed = text.trimStart()
  if (
    (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
    (() => {
      try {
        JSON.parse(trimmed)
        return true
      } catch {
        return false
      }
    })()
  ) {
    return "json"
  }
  if (trimmed.includes("diff --git") || trimmed.includes("@@")) {
    return "diff"
  }
  if (trimmed.startsWith("<")) {
    return "xml"
  }
  return "log"
}

// ── Markdown Detection ────────────────────────────────────────────────

const MD_INDICATORS = [
  /^#{1,6}\s/m,
  /^\s*[-*+]\s/m,
  /^\s*\d+\.\s/m,
  /\*\*[^*]+\*\*/,
  /\[.+\]\(.+\)/,
  /```[\s\S]*?```/,
  /^\s*>/m,
  /^\|.+\|$/m,
]

function looksLikeMarkdown(text: string): boolean {
  let count = 0
  for (const re of MD_INDICATORS) {
    if (re.test(text)) count++
    if (count >= 2) return true
  }
  return false
}

// ── Structured Error Rendering ────────────────────────────────────────

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function formatErrorFieldValue(value: unknown): string {
  if (typeof value === "string") {
    return value
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function renderErrorText(errorText: string): ReactNode {
  const parsed = parseJson(errorText.trim())

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const entries = Object.entries(parsed as Record<string, unknown>)
    if (entries.length > 0) {
      return (
        <div className="space-y-2 p-3">
          {entries.map(([key, value]) => (
            <div key={key} className="space-y-1">
              <div className="text-[11px] font-medium uppercase tracking-wide text-destructive/80">
                {key}
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">
                {formatErrorFieldValue(value)}
              </pre>
            </div>
          ))}
        </div>
      )
    }
  }

  return (
    <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs text-destructive">
      {errorText}
    </pre>
  )
}

// ── ToolOutput ────────────────────────────────────────────────────────

export type ToolOutputProps = React.HTMLAttributes<HTMLDivElement> & {
  output?: string | null
  errorText?: string | null
  renderAsMarkdown?: boolean
}

export const ToolOutput = ({
  className,
  output,
  errorText,
  renderAsMarkdown,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null
  }

  // Determine how to render the output
  let OutputContent: ReactNode = null
  if (output) {
    const lang = detectOutputLanguage(output)
    const shouldRenderMd =
      renderAsMarkdown ?? (lang === "log" && looksLikeMarkdown(output))

    if (shouldRenderMd) {
      OutputContent = (
        <div className="prose prose-sm dark:prose-invert max-w-none p-3 text-sm [&_ul]:list-inside [&_ol]:list-inside">
          <MarkdownContent content={output} />
        </div>
      )
    } else {
      OutputContent = <CodeBlock code={output} language={lang} />
    }
  }

  return (
    <div className={cn("space-y-2", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "Error" : "Result"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-xl border text-xs [&_table]:w-full",
          errorText
            ? "border-destructive/20 bg-destructive/10 text-destructive"
            : "border-border/70 bg-muted/35 text-foreground"
        )}
      >
        {errorText && renderErrorText(errorText)}
        {!errorText && OutputContent}
      </div>
    </div>
  )
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ")
}
