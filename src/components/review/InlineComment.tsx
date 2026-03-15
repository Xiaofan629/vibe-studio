"use client"

import { useState } from "react"
import type { ReviewComment } from "@/lib/types"
import { useTranslations } from "next-intl"
import {
  Check,
  MessageSquare,
  Pencil,
  Send,
  SendHorizontal,
} from "lucide-react"
import { CommentEditor } from "./CommentEditor"

interface InlineCommentProps {
  comment: ReviewComment
  onResolve?: (id: string, resolved?: boolean) => void | Promise<unknown>
  onUpdate?: (comment: ReviewComment) => void | Promise<unknown>
  variant?: "default" | "compact"
}

export function InlineComment({
  comment,
  onResolve,
  onUpdate,
  variant = "default",
}: InlineCommentProps) {
  const t = useTranslations()
  const [editing, setEditing] = useState(false)
  const isCompact = variant === "compact"

  return (
    <div
      id={`review-comment-${comment.id}`}
      onClick={(e) => e.stopPropagation()}
      className={[
        "my-1 rounded-md border border-yellow-500/30 bg-yellow-500/5",
        isCompact ? "p-2" : "p-2",
      ].join(" ")}
      style={{ cursor: "auto" }}
    >
      <div className="flex items-start gap-2">
        <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-yellow-500" />
        <div className="min-w-0 flex-1">
          {!isCompact && (
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                {comment.filePath}:{comment.lineNumber}
              </span>
              {!comment.isResolved && (
                <div className="flex items-center gap-1">
                  {onUpdate && (
                    <button
                      onClick={() =>
                        void onUpdate({
                          ...comment,
                          sentToAgent: !comment.sentToAgent,
                        })
                      }
                      className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      {comment.sentToAgent ? (
                        <Send className="h-2.5 w-2.5" />
                      ) : (
                        <SendHorizontal className="h-2.5 w-2.5" />
                      )}
                      {comment.sentToAgent ? "发给 Agent" : "仅本地"}
                    </button>
                  )}
                  {onUpdate && (
                    <button
                      onClick={() => setEditing((current) => !current)}
                      className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Pencil className="h-2.5 w-2.5" />
                      编辑
                    </button>
                  )}
                  {onResolve && (
                    <button
                      onClick={() => onResolve(comment.id)}
                      className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Check className="h-2.5 w-2.5" />
                      {t("review.resolve")}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {!isCompact && comment.codeLine && (
            <pre className="mt-1 rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {comment.codeLine}
            </pre>
          )}
          {editing ? (
            <div className="mt-2">
              <CommentEditor
                initialContent={comment.content}
                submitLabel="保存评论"
                onSubmit={async (content) => {
                  await onUpdate?.({
                    ...comment,
                    content,
                  })
                  setEditing(false)
                }}
                onCancel={() => setEditing(false)}
              />
            </div>
          ) : (
            <>
              <p className={isCompact ? "text-xs leading-5" : "mt-1 text-xs"}>
                {comment.content}
              </p>
              {!isCompact && (
                <span
                  className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] ${
                    comment.sentToAgent
                      ? "bg-blue-500/10 text-blue-500"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {comment.sentToAgent ? "会发给 Agent" : "仅本地评论"}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
