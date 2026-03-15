import { create } from "zustand"
import type {
  AgentType,
  AgentLogEntry,
  AgentProcessStatus,
  PersistedLogEntry,
  SessionStats,
  SessionWithLogs,
} from "@/lib/types"

/** Per-workspace cached state (logs + session metadata) */
interface WorkspaceCache {
  logs: AgentLogEntry[]
  userPrompt: string | null
  activeSessionId: string | null
  sessionStats: SessionStats | null
}

interface AgentState {
  activeSessionId: string | null
  activeProcessId: string | null
  activeAgentType: AgentType | null
  activeWorkspaceId: string | null
  status: AgentProcessStatus | "idle"
  logs: AgentLogEntry[]
  userPrompt: string | null
  sessionStats: SessionStats | null

  /** In-memory cache: workspaceId → { logs, userPrompt, activeSessionId, sessionStats } */
  _workspaceCache: Record<string, WorkspaceCache>

  setActiveSession: (id: string | null) => void
  setActiveProcess: (id: string | null) => void
  setAgentType: (type: AgentType | null) => void
  setActiveWorkspace: (id: string | null) => void
  setStatus: (status: AgentProcessStatus | "idle") => void
  appendLog: (entry: AgentLogEntry) => void
  setLogs: (logs: AgentLogEntry[]) => void
  clearLogs: () => void
  setUserPrompt: (prompt: string | null) => void
  setSessionStats: (stats: SessionStats | null) => void
  loadSession: (
    session:
      | Pick<SessionWithLogs, "logs" | "userPrompt">
      | { logs?: PersistedLogEntry[] | null; userPrompt?: string | null }
  ) => void

  /**
   * Save current logs/session into cache for the given workspace,
   * then restore cached state for the new workspace (if any).
   * Returns true if the new workspace had cached state.
   */
  switchWorkspace: (
    fromWorkspaceId: string | null,
    toWorkspaceId: string
  ) => boolean

  /** Save current state to cache for the given workspace */
  saveToCache: (workspaceId: string) => void

  /** Restore cached state for the given workspace. Returns true if cache existed. */
  restoreFromCache: (workspaceId: string) => boolean
}

export const useAgentStore = create<AgentState>((set, get) => ({
  activeSessionId: null,
  activeProcessId: null,
  activeAgentType: null,
  activeWorkspaceId: null,
  status: "idle",
  logs: [],
  userPrompt: null,
  sessionStats: null,
  _workspaceCache: {},

  setActiveSession: (id) => set({ activeSessionId: id }),
  setActiveProcess: (id) => set({ activeProcessId: id }),
  setAgentType: (type) => set({ activeAgentType: type }),
  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
  setStatus: (status) => set({ status }),
  appendLog: (entry) => set((state) => ({ logs: [...state.logs, entry] })),
  setLogs: (logs) => set({ logs }),
  clearLogs: () => set({ logs: [], userPrompt: null, sessionStats: null }),
  setUserPrompt: (prompt) => set({ userPrompt: prompt }),
  setSessionStats: (stats) => set({ sessionStats: stats }),
  loadSession: (session) => {
    const persistedLogs = Array.isArray(session.logs) ? session.logs : []

    set({
      logs: persistedLogs.map((log) => ({
        id: Date.now() + Math.random(),
        processId: log.processId,
        entryType: log.entryType as AgentLogEntry["entryType"],
        content: log.content,
        toolName: log.toolName,
        filePath: log.filePath,
        timestamp: log.createdAt,
        sequence: log.sequence,
      })),
      userPrompt: session.userPrompt ?? null,
    })
  },

  saveToCache: (workspaceId) => {
    const state = get()
    set({
      _workspaceCache: {
        ...state._workspaceCache,
        [workspaceId]: {
          logs: state.logs,
          userPrompt: state.userPrompt,
          activeSessionId: state.activeSessionId,
          sessionStats: state.sessionStats,
        },
      },
    })
  },

  restoreFromCache: (workspaceId) => {
    const state = get()
    const cached = state._workspaceCache[workspaceId]
    if (cached) {
      set({
        logs: cached.logs,
        userPrompt: cached.userPrompt,
        activeSessionId: cached.activeSessionId,
        sessionStats: cached.sessionStats,
        activeWorkspaceId: workspaceId,
      })
      return true
    }
    return false
  },

  switchWorkspace: (fromWorkspaceId, toWorkspaceId) => {
    const state = get()

    // 1. Save current state to cache for the old workspace
    if (fromWorkspaceId) {
      const updatedCache = {
        ...state._workspaceCache,
        [fromWorkspaceId]: {
          logs: state.logs,
          userPrompt: state.userPrompt,
          activeSessionId: state.activeSessionId,
          sessionStats: state.sessionStats,
        },
      }
      set({ _workspaceCache: updatedCache })
    }

    // 2. Try to restore cached state for the new workspace
    // Re-read state after saving to get updated cache
    const freshState = get()
    const cached = freshState._workspaceCache[toWorkspaceId]
    if (cached) {
      set({
        logs: cached.logs,
        userPrompt: cached.userPrompt,
        activeSessionId: cached.activeSessionId,
        sessionStats: cached.sessionStats,
        activeWorkspaceId: toWorkspaceId,
        status: "idle",
      })
      return true
    }

    // 3. No cache: clear for fresh start (will be loaded from JSONL by AgentChat)
    set({
      logs: [],
      userPrompt: null,
      activeSessionId: null,
      sessionStats: null,
      activeWorkspaceId: toWorkspaceId,
      status: "idle",
    })
    return false
  },
}))
