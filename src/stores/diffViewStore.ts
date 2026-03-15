import { create } from "zustand"
import { persist } from "zustand/middleware"

type DiffViewMode = "unified" | "split"

interface DiffViewState {
  viewMode: DiffViewMode
  ignoreWhitespace: boolean
  wrapText: boolean
  setViewMode: (mode: DiffViewMode) => void
  setIgnoreWhitespace: (val: boolean) => void
  setWrapText: (val: boolean) => void
}

export const useDiffViewStore = create<DiffViewState>()(
  persist(
    (set) => ({
      viewMode: "unified",
      ignoreWhitespace: false,
      wrapText: true,
      setViewMode: (mode) => set({ viewMode: mode }),
      setIgnoreWhitespace: (val) => set({ ignoreWhitespace: val }),
      setWrapText: (val) => set({ wrapText: val }),
    }),
    { name: "vibe-studio-diff-prefs" }
  )
)
