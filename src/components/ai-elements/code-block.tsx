"use client"

import { useState, useRef, useEffect, useCallback, memo, type CSSProperties } from "react"
import type { BundledLanguage, ThemedToken } from "shiki"
import { createHighlighter } from "shiki"
import { Button } from "@/components/ui/button"

interface TokenizedCode {
  tokens: ThemedToken[][]
  fg: string
  bg: string
}

const highlighterCache = new Map<string, Promise<unknown>>()
const tokensCache = new Map<string, TokenizedCode>()

const getTokensCacheKey = (code: string, language: BundledLanguage) => {
  const start = code.slice(0, 100)
  const end = code.length > 100 ? code.slice(-100) : ""
  return `${language}:${code.length}:${start}:${end}`
}

const createRawTokens = (code: string): TokenizedCode => ({
  bg: "transparent",
  fg: "inherit",
  tokens: code.split("\n").map((line) =>
    line === ""
      ? []
      : [
          {
            color: "inherit",
            content: line,
          } as ThemedToken,
        ]
  ),
})

const getHighlighter = async (language: BundledLanguage) => {
  const cached = highlighterCache.get(language)
  if (cached) {
    return cached
  }

  const highlighterPromise = createHighlighter({
    langs: [language],
    themes: ["github-light", "github-dark"],
  })

  highlighterCache.set(language, highlighterPromise)
  return highlighterPromise
}

const highlightCode = (
  code: string,
  language: BundledLanguage,
  callback?: (result: TokenizedCode) => void
): TokenizedCode | null => {
  const tokensCacheKey = getTokensCacheKey(code, language)

  const cached = tokensCache.get(tokensCacheKey)
  if (cached) {
    return cached
  }

  getHighlighter(language)
    .then((highlighter) => {
      const h = highlighter as {
        getLoadedLanguages: () => string[]
        codeToTokens: (
          code: string,
          options: { lang: string; themes: { dark: string; light: string } }
        ) => { bg?: string; fg?: string; tokens: ThemedToken[][] }
      }
      const availableLangs = h.getLoadedLanguages()
      const langToUse = availableLangs.includes(language) ? language : "text"

      const result = h.codeToTokens(code, {
        lang: langToUse,
        themes: {
          dark: "github-dark",
          light: "github-light",
        },
      })

      const tokenized: TokenizedCode = {
        bg: result.bg ?? "transparent",
        fg: result.fg ?? "inherit",
        tokens: result.tokens,
      }

      tokensCache.set(tokensCacheKey, tokenized)
      callback?.(tokenized)
    })
    .catch((error) => {
      console.error("Failed to highlight code:", error)
    })

  return null
}

type CodeBlockProps = React.HTMLAttributes<HTMLDivElement> & {
  code: string
  language: BundledLanguage
}

const CodeBlockBody = memo(
  ({
    tokenized,
    className,
  }: {
    tokenized: TokenizedCode
    className?: string
  }) => {
    const preStyle: CSSProperties = {
      backgroundColor: tokenized.bg,
      color: tokenized.fg,
    }

    return (
      <pre
        className={cn(
          "dark:!bg-[var(--shiki-dark-bg)] dark:!text-[var(--shiki-dark)] m-0 p-4 text-sm overflow-x-auto",
          className
        )}
        style={preStyle}
      >
        <code className="font-mono text-sm">
          {tokenized.tokens.map((line, lineIdx) => (
            <span key={lineIdx} className="block">
              {line.length === 0 ? (
                "\n"
              ) : (
                line.map((token, tokenIdx) => (
                  <span
                    key={tokenIdx}
                    style={{
                      color: token.color,
                      backgroundColor: token.bgColor,
                    }}
                  >
                    {token.content}
                  </span>
                ))
              )}
            </span>
          ))}
        </code>
      </pre>
    )
  }
)

CodeBlockBody.displayName = "CodeBlockBody"

export function CodeBlock({
  code,
  language,
  className,
  ...props
}: CodeBlockProps) {
  const rawTokens = createRawTokens(code)
  const [tokenized, setTokenized] = useState<TokenizedCode>(
    () => highlightCode(code, language) ?? rawTokens
  )

  useEffect(() => {
    let cancelled = false

    highlightCode(code, language, (result) => {
      if (!cancelled) {
        setTokenized(result)
      }
    })

    return () => {
      cancelled = true
    }
  }, [code, language])

  const [isCopied, setIsCopied] = useState(false)
  const timeoutRef = useRef<number>(0)

  const copyToClipboard = useCallback(async () => {
    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
      return
    }

    try {
      await navigator.clipboard.writeText(code)
      setIsCopied(true)
      timeoutRef.current = window.setTimeout(() => setIsCopied(false), 2000)
    } catch (error) {
      console.error("Failed to copy:", error)
    }
  }, [code])

  useEffect(
    () => () => {
      window.clearTimeout(timeoutRef.current)
    },
    []
  )

  const Icon = isCopied ? CheckIcon : CopyIcon

  return (
    <div
      className={cn(
        "group relative w-full overflow-hidden rounded-md border bg-background text-foreground",
        className
      )}
      data-language={language}
      {...props}
    >
      <div className="flex items-center justify-between border-b bg-muted/80 px-3 py-2 text-muted-foreground text-xs">
        <span className="font-mono">{language}</span>
        <Button
          className="shrink-0 size-7"
          onClick={copyToClipboard}
          size="icon"
          variant="ghost"
        >
          <Icon size={14} />
        </Button>
      </div>
      <CodeBlockBody tokenized={tokenized} />
    </div>
  )
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ")
}

function CheckIcon({ size }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function CopyIcon({ size }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  )
}
