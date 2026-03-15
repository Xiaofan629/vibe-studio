"use client"

import { useCallback } from "react"
import { useReviewStore } from "@/stores/reviewStore"
import type { ReviewComment, CreateReviewComment } from "@/lib/types"
import { invoke } from "@/lib/tauri"

type ReviewCommentResponse = {
  id: string
  session_id: string
  file_path: string
  line_number: number
  side: "old" | "new"
  content: string
  code_line: string | null
  is_resolved: boolean
  sent_to_agent: boolean
  created_at: string
  updated_at: string
}

function normalizeComment(comment: ReviewCommentResponse): ReviewComment {
  return {
    id: comment.id,
    sessionId: comment.session_id,
    filePath: comment.file_path,
    lineNumber: comment.line_number,
    side: comment.side,
    content: comment.content,
    codeLine: comment.code_line,
    isResolved: comment.is_resolved,
    sentToAgent: comment.sent_to_agent,
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
  }
}

export function useReview() {
  const comments = useReviewStore((state) => state.comments)
  const draftContent = useReviewStore((state) => state.draftContent)
  const setComments = useReviewStore((state) => state.setComments)
  const addStoredComment = useReviewStore((state) => state.addComment)
  const updateStoredComment = useReviewStore((state) => state.updateComment)
  const setDraftContent = useReviewStore((state) => state.setDraftContent)

  const loadComments = useCallback(
    async (sessionId: string) => {
      if (!sessionId) return
      // Clear stale comments immediately so that effects relying on
      // `comments` do not see data from a previous session/workspace.
      setComments([])
      const result = await invoke<ReviewCommentResponse[]>(
        "list_review_comments",
        {
          sessionId,
        }
      )
      setComments(result.map(normalizeComment))
    },
    [setComments]
  )

  const addComment = useCallback(
    async (data: CreateReviewComment) => {
      const comment = await invoke<ReviewCommentResponse>(
        "create_review_comment",
        {
          args: {
            session_id: data.sessionId,
            file_path: data.filePath,
            line_number: data.lineNumber,
            side: data.side,
            content: data.content,
            code_line: data.codeLine,
            sent_to_agent: data.sentToAgent ?? true,
          },
        }
      )
      const normalized = normalizeComment(comment)
      addStoredComment(normalized)
      return normalized
    },
    [addStoredComment]
  )

  const updateComment = useCallback(
    async (comment: ReviewComment) => {
      const updated = await invoke<ReviewCommentResponse>(
        "update_review_comment",
        {
          args: {
            comment_id: comment.id,
            content: comment.content,
            sent_to_agent: comment.sentToAgent,
          },
        }
      )
      const normalized = normalizeComment(updated)
      updateStoredComment(normalized)
      return normalized
    },
    [updateStoredComment]
  )

  const resolveComment = useCallback(
    async (id: string, resolved = true) => {
      const updated = await invoke<ReviewCommentResponse>(
        "resolve_review_comment",
        {
          commentId: id,
          resolved,
        }
      )
      const normalized = normalizeComment(updated)
      updateStoredComment(normalized)
      return normalized
    },
    [updateStoredComment]
  )

  const importComments = useCallback(
    async (comments: CreateReviewComment[]) => {
      const created = await Promise.all(
        comments.map((comment) => addComment(comment))
      )
      return created
    },
    [addComment]
  )

  const getCommentsForFile = useCallback(
    (filePath: string) => {
      return comments.filter((c) => c.filePath === filePath && !c.isResolved)
    },
    [comments]
  )

  const getCommentsForLine = useCallback(
    (filePath: string, lineNumber: number, side: "old" | "new") => {
      return comments.filter(
        (c) =>
          c.filePath === filePath &&
          c.lineNumber === lineNumber &&
          c.side === side &&
          !c.isResolved
      )
    },
    [comments]
  )

  const buildReviewContext = useCallback(async (overrideSessionId?: string) => {
    const sessionId =
      overrideSessionId ?? useReviewStore.getState().comments[0]?.sessionId
    if (!sessionId) return null
    const context = await invoke<string>("build_review_context", { sessionId })
    return context || null
  }, [])

  return {
    comments,
    unresolvedCount: comments.filter((comment) => !comment.isResolved && comment.sentToAgent).length,
    draftContent,
    setDraftContent,
    loadComments,
    addComment,
    updateComment,
    resolveComment,
    getCommentsForFile,
    getCommentsForLine,
    buildReviewContext,
    importComments,
  }
}
