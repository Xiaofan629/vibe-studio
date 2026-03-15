import { create } from "zustand"
import type { ReviewComment } from "@/lib/types"

interface ReviewState {
  comments: ReviewComment[]
  draftContent: string
  setComments: (comments: ReviewComment[]) => void
  addComment: (comment: ReviewComment) => void
  updateComment: (comment: ReviewComment) => void
  resolveComment: (id: string, resolved?: boolean) => void
  markAsSent: (ids: string[]) => void
  setDraftContent: (content: string) => void
  unresolvedCount: () => number
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  comments: [],
  draftContent: "",
  setComments: (comments) => set({ comments }),
  addComment: (comment) =>
    set((state) => ({ comments: [...state.comments, comment] })),
  updateComment: (comment) =>
    set((state) => ({
      comments: state.comments.map((item) =>
        item.id === comment.id ? comment : item
      ),
    })),
  resolveComment: (id, resolved = true) =>
    set((state) => ({
      comments: state.comments.map((c) =>
        c.id === id ? { ...c, isResolved: resolved } : c
      ),
    })),
  markAsSent: (ids) =>
    set((state) => ({
      comments: state.comments.map((c) =>
        ids.includes(c.id) ? { ...c, sentToAgent: true } : c
      ),
    })),
  setDraftContent: (content) => set({ draftContent: content }),
  unresolvedCount: () => get().comments.filter((c) => !c.isResolved).length,
}))
