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
  status: AgentProcessStatus | "idle"
  activeProcessId: string | null
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

  /** In-memory cache: workspaceId + agentType → { logs, userPrompt, activeSessionId, sessionStats } */
  _workspaceCache: Record<string, WorkspaceCache>

  /** Track workspace+agent contexts that may have new history to reload */
  _workspacesNeedingHistoryReload: Record<string, boolean>

  setActiveSession: (id: string | null) => void
  setActiveProcess: (id: string | null) => void
  setAgentType: (type: AgentType | null) => void
  setActiveWorkspace: (id: string | null) => void
  setStatus: (status: AgentProcessStatus | "idle") => void
  appendLog: (entry: AgentLogEntry) => void
  appendLogToWorkspace: (
    workspaceId: string | null,
    agentType: AgentType | null,
    entry: AgentLogEntry
  ) => void
  setLogs: (logs: AgentLogEntry[]) => void
  clearLogs: () => void
  setUserPrompt: (prompt: string | null) => void
  setSessionStats: (stats: SessionStats | null) => void
  setWorkspaceRuntime: (
    workspaceId: string | null,
    agentType: AgentType | null,
    runtime: Partial<
      Pick<
        WorkspaceCache,
        "activeSessionId" | "sessionStats" | "status" | "activeProcessId" | "userPrompt"
      >
    >
  ) => void
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
    fromAgentType: AgentType | null,
    toWorkspaceId: string,
    toAgentType: AgentType | null
  ) => boolean

  /** Save current state to cache for the given workspace */
  saveToCache: (workspaceId: string, agentType: AgentType | null) => void

  /** Restore cached state for the given workspace. Returns true if cache existed. */
  restoreFromCache: (workspaceId: string, agentType: AgentType | null) => boolean

  /** Mark a workspace+agent context as needing history reload */
  markHistoryReloadNeeded: (
    workspaceId: string,
    agentType: AgentType | null
  ) => void

  /** Check and clear the reload flag for a workspace+agent context */
  checkAndClearHistoryReloadNeeded: (
    workspaceId: string,
    agentType: AgentType | null
  ) => boolean
}

function getWorkspaceCacheKey(
  workspaceId: string,
  agentType: AgentType | null | undefined
) {
  return `${workspaceId}::${agentType ?? "unknown"}`
}

function mergeGeminiDeltaLogs(existingLogs: AgentLogEntry[], entry: AgentLogEntry) {
  if (existingLogs.length === 0) {
    return [...existingLogs, entry]
  }

  const previous = existingLogs[existingLogs.length - 1]
  const canMerge =
    previous.processId === entry.processId &&
    previous.entryType === "text" &&
    entry.entryType === "text" &&
    previous.toolName == null &&
    entry.toolName == null

  if (!canMerge) {
    return [...existingLogs, entry]
  }

  return [
    ...existingLogs.slice(0, -1),
    {
      ...previous,
      content: `${previous.content}${entry.content}`,
      timestamp: entry.timestamp,
    },
  ]
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
  _workspacesNeedingHistoryReload: {},

  setActiveSession: (id) => set({ activeSessionId: id }),
  setActiveProcess: (id) => set({ activeProcessId: id }),
  setAgentType: (type) => set({ activeAgentType: type }),
  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
  setStatus: (status) => set({ status }),
  appendLog: (entry) => set((state) => ({ logs: [...state.logs, entry] })),
  appendLogToWorkspace: (workspaceId, agentType, entry) =>
    set((state) => {
      if (!workspaceId) {
        return { logs: [...state.logs, entry] }
      }

      const cacheKey = getWorkspaceCacheKey(
        workspaceId,
        agentType ?? state.activeAgentType
      )
      const cached = state._workspaceCache[cacheKey] ?? {
        logs: [],
        userPrompt: null,
        activeSessionId: null,
        sessionStats: null,
        status: "idle" as const,
        activeProcessId: null,
      }

      const nextLogs =
        workspaceId === state.activeWorkspaceId &&
        (agentType ?? state.activeAgentType) === state.activeAgentType
          ? agentType === "gemini"
            ? mergeGeminiDeltaLogs(state.logs, entry)
            : [...state.logs, entry]
          : agentType === "gemini"
            ? mergeGeminiDeltaLogs(cached.logs, entry)
            : [...cached.logs, entry]

      const nextCache = {
        ...state._workspaceCache,
        [cacheKey]: {
          ...cached,
          logs: nextLogs,
        },
      }

      if (
        workspaceId === state.activeWorkspaceId &&
        (agentType ?? state.activeAgentType) === state.activeAgentType
      ) {
        return {
          logs: nextLogs,
          _workspaceCache: nextCache,
        }
      }

      return {
        _workspaceCache: nextCache,
      }
    }),
  setLogs: (logs) => set({ logs }),
  clearLogs: () => set({ logs: [], userPrompt: null, sessionStats: null }),
  setUserPrompt: (prompt) => set({ userPrompt: prompt }),
  setSessionStats: (stats) => set({ sessionStats: stats }),
  setWorkspaceRuntime: (workspaceId, agentType, runtime) =>
    set((state) => {
      if (!workspaceId) {
        return {
          activeSessionId:
            runtime.activeSessionId !== undefined
              ? runtime.activeSessionId
              : state.activeSessionId,
          activeProcessId:
            runtime.activeProcessId !== undefined
              ? runtime.activeProcessId
              : state.activeProcessId,
          userPrompt:
            runtime.userPrompt !== undefined ? runtime.userPrompt : state.userPrompt,
          sessionStats:
            runtime.sessionStats !== undefined
              ? runtime.sessionStats
              : state.sessionStats,
          status: runtime.status !== undefined ? runtime.status : state.status,
        }
      }

      const resolvedAgentType = agentType ?? state.activeAgentType
      const cacheKey = getWorkspaceCacheKey(workspaceId, resolvedAgentType)
      const cached = state._workspaceCache[cacheKey] ?? {
        logs: [],
        userPrompt: null,
        activeSessionId: null,
        sessionStats: null,
        status: "idle" as const,
        activeProcessId: null,
      }

      const nextCache: WorkspaceCache = {
        ...cached,
        ...runtime,
      }

      if (
        workspaceId === state.activeWorkspaceId &&
        resolvedAgentType === state.activeAgentType
      ) {
        return {
          _workspaceCache: {
            ...state._workspaceCache,
            [cacheKey]: nextCache,
          },
          activeSessionId:
            runtime.activeSessionId !== undefined
              ? runtime.activeSessionId
              : state.activeSessionId,
          activeProcessId:
            runtime.activeProcessId !== undefined
              ? runtime.activeProcessId
              : state.activeProcessId,
          userPrompt:
            runtime.userPrompt !== undefined ? runtime.userPrompt : state.userPrompt,
          sessionStats:
            runtime.sessionStats !== undefined
              ? runtime.sessionStats
              : state.sessionStats,
          status: runtime.status !== undefined ? runtime.status : state.status,
        }
      }

      return {
        _workspaceCache: {
          ...state._workspaceCache,
          [cacheKey]: nextCache,
        },
      }
    }),
  loadSession: (session) => {
    const persistedLogs = Array.isArray(session.logs) ? session.logs : []

    set({
      ...(persistedLogs.length > 0
        ? {
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
          }
        : {}),
      userPrompt: session.userPrompt ?? null,
    })
  },

  saveToCache: (workspaceId, agentType) => {
    const state = get()
    const cacheKey = getWorkspaceCacheKey(workspaceId, agentType ?? state.activeAgentType)
    set({
      _workspaceCache: {
        ...state._workspaceCache,
        [cacheKey]: {
          logs: state.logs,
          userPrompt: state.userPrompt,
          activeSessionId: state.activeSessionId,
          sessionStats: state.sessionStats,
          status: state.status,
          activeProcessId: state.activeProcessId,
        },
      },
    })
  },

  restoreFromCache: (workspaceId, agentType) => {
    const state = get()
    const resolvedAgentType = agentType ?? state.activeAgentType
    const cacheKey = getWorkspaceCacheKey(workspaceId, resolvedAgentType)
    const cached = state._workspaceCache[cacheKey]
    if (cached) {
      set({
        logs: cached.logs,
        userPrompt: cached.userPrompt,
        activeSessionId: cached.activeSessionId,
        sessionStats: cached.sessionStats,
        activeWorkspaceId: workspaceId,
        status: cached.status,
        activeProcessId: cached.activeProcessId,
      })
      return true
    }
    return false
  },

  switchWorkspace: (fromWorkspaceId, fromAgentType, toWorkspaceId, toAgentType) => {
    const state = get()

    // 1. Save current state to cache for the old workspace
    if (fromWorkspaceId) {
      const fromCacheKey = getWorkspaceCacheKey(
        fromWorkspaceId,
        fromAgentType ?? state.activeAgentType
      )
      const updatedCache = {
        ...state._workspaceCache,
        [fromCacheKey]: {
          logs: state.logs,
          userPrompt: state.userPrompt,
          activeSessionId: state.activeSessionId,
          sessionStats: state.sessionStats,
          status: state.status,
          activeProcessId: state.activeProcessId,
        },
      }
      set({ _workspaceCache: updatedCache })
    }

    // 2. Try to restore cached state for the new workspace
    // Re-read state after saving to get updated cache
    const freshState = get()
    const toCacheKey = getWorkspaceCacheKey(
      toWorkspaceId,
      toAgentType ?? freshState.activeAgentType
    )
    const cached = freshState._workspaceCache[toCacheKey]
    if (cached) {
      set({
        logs: cached.logs,
        userPrompt: cached.userPrompt,
        activeSessionId: cached.activeSessionId,
        sessionStats: cached.sessionStats,
        activeWorkspaceId: toWorkspaceId,
        status: cached.status,
        activeProcessId: cached.activeProcessId,
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
      activeProcessId: null,
    })
    return false
  },

  markHistoryReloadNeeded: (workspaceId, agentType) => {
    const reloadKey = getWorkspaceCacheKey(workspaceId, agentType)
    set((state) => ({
      _workspacesNeedingHistoryReload: {
        ...state._workspacesNeedingHistoryReload,
        [reloadKey]: true,
      },
    }))
  },

  checkAndClearHistoryReloadNeeded: (workspaceId, agentType) => {
    const state = get()
    const reloadKey = getWorkspaceCacheKey(workspaceId, agentType)
    const needed = state._workspacesNeedingHistoryReload[reloadKey] ?? false
    if (needed) {
      set((state) => {
        const next = { ...state._workspacesNeedingHistoryReload }
        delete next[reloadKey]
        return { _workspacesNeedingHistoryReload: next }
      })
    }
    return needed
  },
}))
