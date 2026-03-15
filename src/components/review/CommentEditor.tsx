"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Send } from "lucide-react"

interface CommentEditorProps {
  initialContent?: string
  submitLabel?: string
  onSubmit: (content: string) => void | Promise<unknown>
  onCancel: () => void
  placeholder?: string
}

export function CommentEditor({
  initialContent = "",
  submitLabel,
  onSubmit,
  onCancel,
  placeholder,
}: CommentEditorProps) {
  const t = useTranslations()
  const [content, setContent] = useState(initialContent)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setContent(initialContent)
  }, [initialContent])

  const handleSubmit = () => {
    if (!content.trim()) return
    void onSubmit(content.trim())
    setContent("")
  }

  return (
    <div
      ref={rootRef}
      onClick={(e) => e.stopPropagation()}
      className="rounded-md border border-border bg-background p-2 shadow-sm"
      style={{ cursor: "auto" }}
    >
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={placeholder ?? t("review.addComment")}
        className="w-full resize-none rounded-sm bg-transparent p-1 text-xs focus:outline-none"
        rows={3}
        autoFocus
        style={{ cursor: "text" }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            handleSubmit()
          }
          if (e.key === "Escape") {
            onCancel()
          }
        }}
      />
      <div className="mt-1 flex justify-end gap-1">
        <button
          onClick={onCancel}
          className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
        >
          {t("common.cancel")}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!content.trim()}
          className="flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground disabled:opacity-50"
        >
          <Send className="h-3 w-3" />
          {submitLabel ?? t("review.addComment")}
        </button>
      </div>
    </div>
  )
}
