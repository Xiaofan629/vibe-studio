"use client"

import { invoke as tauriInvoke } from "@tauri-apps/api/core"
import { listen as tauriListen } from "@tauri-apps/api/event"
import type {
  Session,
  SessionWithLogs,
  CreateSessionRequest,
  AgentLogEntry,
  Workspace,
  CreateWorkspaceRequest,
} from "@/lib/types"

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(cmd, args)
}

export function listen<T>(event: string, handler: (payload: T) => void) {
  return tauriListen<T>(event, (e) => handler(e.payload))
}

// Global callbacks
let globalOnOutput: ((entry: AgentLogEntry) => void) | null = null
let globalOnFinished: ((processId: string) => void) | null = null

// Deduplication
const processedEntries = new Set<string>()

function getEntryKey(entry: AgentLogEntry): string {
  return `${entry.entryType}:${entry.content.slice(0, 100)}:${entry.timestamp}`
}

// Singleton initialization
let initialized = false

async function initGlobalListeners() {
  if (initialized) return
  initialized = true

  await tauriListen<AgentLogEntry>("agent:output", (e) => {
    const entry = e.payload
    
    // Deduplication check
    const key = getEntryKey(entry)
    if (processedEntries.has(key)) {
      return
    }
    processedEntries.add(key)
    setTimeout(() => processedEntries.delete(key), 5000)
    
    if (globalOnOutput) {
      globalOnOutput(entry)
    }
  })

  await tauriListen<string>("agent:finished", (e) => {
    if (globalOnFinished) {
      globalOnFinished(e.payload)
    }
  })
}

export function registerCallbacks(
  onOutput: (entry: AgentLogEntry) => void,
  onFinished: (processId: string) => void
) {
  globalOnOutput = onOutput
  globalOnFinished = onFinished
  initGlobalListeners()
}

// Session API
export const sessionsApi = {
  list: async (projectId: string): Promise<Session[]> => {
    return invoke<Session[]>("list_sessions", { projectId })
  },

  listByWorkspace: async (workspaceId: string): Promise<Session[]> => {
    return invoke<Session[]>("list_sessions_by_workspace", { workspaceId })
  },

  get: async (sessionId: string): Promise<SessionWithLogs | null> => {
    return invoke<SessionWithLogs | null>("get_session", { sessionId })
  },

  create: async (request: CreateSessionRequest): Promise<Session> => {
    return invoke<Session>("create_session", { request })
  },

  updateStatus: async (sessionId: string, status: string): Promise<void> => {
    return invoke("update_session_status", { sessionId, status })
  },

  delete: async (sessionId: string): Promise<void> => {
    return invoke("delete_session", { sessionId })
  },

  loadClaudeHistory: async (projectPath: string): Promise<AgentLogEntry[]> => {
    return invoke<AgentLogEntry[]>("load_claude_session_history", { projectPath })
  },

  loadClaudeSessionFull: async (workspaceId: string): Promise<import("@/lib/types").ConversationDetail> => {
    return invoke("load_claude_session_full", { workspaceId })
  },

  setupWorktree: async (
    sessionId: string,
    projectPath: string
  ): Promise<{ worktree_path: string; branch_name: string; base_commit: string }> => {
    return invoke("setup_session_worktree", { sessionId, projectPath })
  },

  cleanupWorktree: async (sessionId: string, projectPath: string): Promise<void> => {
    return invoke("cleanup_session_worktree", { sessionId, projectPath })
  },
}

// Workspace API
export const workspacesApi = {
  create: async (request: CreateWorkspaceRequest): Promise<Workspace> => {
    return invoke<Workspace>("create_workspace", { request })
  },

  list: async (): Promise<Workspace[]> => {
    return invoke<Workspace[]>("list_workspaces")
  },

  get: async (workspaceId: string): Promise<Workspace | null> => {
    return invoke<Workspace | null>("get_workspace", { workspaceId })
  },

  updateStatus: async (workspaceId: string, status: string): Promise<void> => {
    return invoke("update_workspace_status", { workspaceId, status })
  },

  delete: async (workspaceId: string): Promise<void> => {
    return invoke("delete_workspace", { workspaceId })
  },
}
