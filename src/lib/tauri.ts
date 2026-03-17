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

const WORKSPACE_STATUS_EVENT = "vibe:workspace-status-changed"

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(cmd, args)
}

export function listen<T>(event: string, handler: (payload: T) => void) {
  return tauriListen<T>(event, (e) => handler(e.payload))
}

export interface WorkspaceStatusChangedPayload {
  workspaceId: string
  status: string
  updatedAt: number
}

export function emitWorkspaceStatusChanged(payload: WorkspaceStatusChangedPayload) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(WORKSPACE_STATUS_EVENT, { detail: payload }))
}

export function onWorkspaceStatusChanged(
  handler: (payload: WorkspaceStatusChangedPayload) => void
) {
  if (typeof window === "undefined") {
    return () => {}
  }

  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<WorkspaceStatusChangedPayload>
    handler(customEvent.detail)
  }

  window.addEventListener(WORKSPACE_STATUS_EVENT, listener)
  return () => window.removeEventListener(WORKSPACE_STATUS_EVENT, listener)
}

// Global callbacks
interface AgentOutputEvent {
  processId: string
  entry: AgentLogEntry
}

let globalOnOutput: ((payload: AgentOutputEvent) => void) | null = null
let globalOnFinished: ((processId: string) => void) | null = null

// Deduplication
const processedEntries = new Set<string>()

function getEntryKey(entry: AgentLogEntry | undefined | null): string {
  if (!entry) return "unknown:unknown:unknown"
  const content = entry.content || ""
  const entryType = entry.entryType || "unknown"
  const timestamp = entry.timestamp || "unknown"
  return `${entryType}:${content.slice(0, 100)}:${timestamp}`
}

// Singleton initialization
let initialized = false

async function initGlobalListeners() {
  if (initialized) return
  initialized = true

  await tauriListen<AgentOutputEvent>("agent:output", (e) => {
    const payload = e.payload
    const entry = payload?.entry
    
    // Deduplication check
    const key = getEntryKey(entry)
    if (processedEntries.has(key)) {
      return
    }
    processedEntries.add(key)
    setTimeout(() => processedEntries.delete(key), 5000)
    
    if (globalOnOutput && payload) {
      globalOnOutput(payload)
    }
  })

  await tauriListen<string>("agent:finished", (e) => {
    if (globalOnFinished) {
      globalOnFinished(e.payload)
    }
  })
}

export function registerCallbacks(
  onOutput: (payload: AgentOutputEvent) => void,
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

  loadCodexSessionFull: async (workspaceId: string): Promise<import("@/lib/types").ConversationDetail> => {
    return invoke("load_codex_session_full", { workspaceId })
  },

  loadGeminiSessionFull: async (workspaceId: string): Promise<import("@/lib/types").ConversationDetail> => {
    return invoke("load_gemini_session_full", { workspaceId })
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

  updateTitle: async (workspaceId: string, title: string | null): Promise<void> => {
    return invoke("update_workspace_title", { workspaceId, title })
  },

  updateAgent: async (workspaceId: string, agentType: string): Promise<void> => {
    return invoke("update_workspace_agent", { workspaceId, agentType })
  },

  delete: async (workspaceId: string): Promise<void> => {
    return invoke("delete_workspace", { workspaceId })
  },
}

// Prompt API (slash commands, file picker, image paste)
export const promptApi = {
  listSlashCommands: async (projectPath: string | undefined, agentType: string | undefined): Promise<import("@/lib/types").SlashCommand[]> => {
    return invoke("slash_commands_list", { projectPath, agentType })
  },

  listDirectoryContents: async (path: string): Promise<import("@/lib/types").FileEntry[]> => {
    return invoke("list_directory_contents", { directoryPath: path })
  },

  searchFiles: async (basePath: string, query: string): Promise<import("@/lib/types").FileEntry[]> => {
    return invoke("search_files", { basePath, query })
  },

  savePastedImage: async (projectPath: string | null, dataUrl: string): Promise<import("@/lib/types").SavedImage> => {
    return invoke("save_pasted_image", { projectPath, dataUrl })
  },
}
