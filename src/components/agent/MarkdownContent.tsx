"use client"

import { memo } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import type { BundledLanguage } from "shiki"
import { CodeBlock } from "@/components/ai-elements/code-block"

interface MarkdownContentProps {
  content: string
  className?: string
}

// Custom code renderer that uses Shiki CodeBlock for fenced code blocks
const markdownComponents: Components = {
  // Handle fenced code blocks (```lang ... ```)
  pre({ children }) {
    // react-markdown wraps code blocks in <pre><code>...</code></pre>
    // We intercept <pre> and let <code> handle rendering
    return <>{children}</>
  },
  code({ className, children, ...props }) {
    // Detect fenced code blocks: they have className="language-xxx"
    const match = /language-(\w+)/.exec(className || "")

    if (match) {
      const language = match[1] as BundledLanguage
      const codeString = String(children).replace(/\n$/, "")

      return (
        <CodeBlock
          code={codeString}
          language={language}
        />
      )
    }

    // Inline code: render as styled <code>
    return (
      <code
        className="rounded bg-muted/50 px-1 py-0.5 font-mono text-xs before:content-none after:content-none"
        {...props}
      >
        {children}
      </code>
    )
  },
}

function MarkdownContentImpl({ content, className }: MarkdownContentProps) {
  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none",
        "prose-p:my-1 prose-headings:my-2 prose-pre:my-2",
        "prose-ul:my-1 prose-ol:my-1 prose-li:my-0",
        "[&_ul]:list-inside [&_ol]:list-inside",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export const MarkdownContent = memo(
  MarkdownContentImpl,
  (prev, next) => prev.content === next.content && prev.className === next.className
)

MarkdownContent.displayName = "MarkdownContent"

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ")
}
