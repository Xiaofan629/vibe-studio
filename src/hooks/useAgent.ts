"use client"

import { useCallback } from "react"
import {
  emitWorkspaceStatusChanged,
  invoke,
  registerCallbacks,
  sessionsApi,
  workspacesApi,
} from "@/lib/tauri"
import { useAgentStore } from "@/stores/agentStore"
import type {
  AgentLogEntry,
  AgentType,
  AgentInfo,
  ClaudePermissionMode,
  Session,
  CreateSessionRequest,
} from "@/lib/types"

let callbacksRegistered = false
const PROCESS_BINDINGS_KEY = "vibe-studio:agent-process-bindings"

interface ProcessBinding {
  sessionId: string | null
  workspaceId: string | null
  agentType: AgentType | null
}

function readProcessBindings(): Record<string, ProcessBinding> {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(PROCESS_BINDINGS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, ProcessBinding>) : {}
  } catch {
    return {}
  }
}

function writeProcessBindings(bindings: Record<string, ProcessBinding>) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(PROCESS_BINDINGS_KEY, JSON.stringify(bindings))
}

function setProcessBinding(processId: string, binding: ProcessBinding) {
  const bindings = readProcessBindings()
  bindings[processId] = binding
  writeProcessBindings(bindings)
}

function getProcessBinding(processId: string): ProcessBinding | null {
  return readProcessBindings()[processId] ?? null
}

function removeProcessBinding(processId: string) {
  const bindings = readProcessBindings()
  if (!(processId in bindings)) return
  delete bindings[processId]
  writeProcessBindings(bindings)
}

let persistedBindingsReconciled = false

async function reconcilePersistedProcesses() {
  if (persistedBindingsReconciled || typeof window === "undefined") return
  persistedBindingsReconciled = true

  const bindings = readProcessBindings()
  await Promise.all(
    Object.entries(bindings).map(async ([processId, binding]) => {
      let shouldRemoveBinding = true
      try {
        const running = await invoke<boolean>("is_agent_running", { processId })
        if (running) {
          shouldRemoveBinding = false
          useAgentStore.getState().setWorkspaceRuntime(
            binding.workspaceId,
            binding.agentType,
            {
            activeProcessId: processId,
            activeSessionId: binding.sessionId,
            status: "running",
            }
          )
          return
        }

        if (binding.sessionId) {
          await sessionsApi
            .updateStatus(binding.sessionId, "completed")
            .catch(console.error)
        }
        if (binding.workspaceId) {
          const workspace = await workspacesApi
            .get(binding.workspaceId)
            .catch(() => null)
          if (workspace?.status === "running") {
            await workspacesApi
              .updateStatus(binding.workspaceId, "need_review")
              .catch(console.error)
          }
        }
      } finally {
        if (shouldRemoveBinding) {
          removeProcessBinding(processId)
        }
      }
    })
  )
}

function registerCallbacksOnce() {
  if (callbacksRegistered) return
  callbacksRegistered = true

  registerCallbacks(
    ({ processId, entry }: { processId: string; entry: AgentLogEntry }) => {
      const state = useAgentStore.getState()
      const binding = getProcessBinding(processId)
      const targetWorkspaceId = binding?.workspaceId ?? state.activeWorkspaceId
      const targetAgentType = binding?.agentType ?? state.activeAgentType

      const logEntry = {
        ...entry,
        id: Date.now() + Math.random(),
        processId,
        sequence:
          targetWorkspaceId &&
          (targetWorkspaceId !== state.activeWorkspaceId ||
            targetAgentType !== state.activeAgentType)
            ? (
                state._workspaceCache[
                  `${targetWorkspaceId}::${targetAgentType ?? "unknown"}`
                ]?.logs.length ?? 0
              )
            : state.logs.length,
      }
      state.appendLogToWorkspace(targetWorkspaceId, targetAgentType, logEntry)
    },
    (processId: string) => {
      const state = useAgentStore.getState()
      const binding = getProcessBinding(processId)
      const targetSessionId = binding?.sessionId ?? state.activeSessionId
      const targetWorkspaceId = binding?.workspaceId ?? state.activeWorkspaceId
      const targetAgentType = binding?.agentType ?? state.activeAgentType

      if (processId === state.activeProcessId && state.status === "running") {
        state.setStatus("completed")
        state.setActiveProcess(null)
      }
      state.setWorkspaceRuntime(targetWorkspaceId, targetAgentType, {
        status: "completed",
        activeProcessId: null,
      })

      if (targetSessionId) {
        sessionsApi
          .updateStatus(targetSessionId, "completed")
          .catch(console.error)
      }
      if (targetWorkspaceId) {
        workspacesApi
          .get(targetWorkspaceId)
          .then((workspace) => {
            const nextStatus = workspace?.status === "done" ? "done" : "need_review"
            emitWorkspaceStatusChanged({
              workspaceId: targetWorkspaceId,
              status: nextStatus,
              updatedAt: Date.now(),
            })
            if (workspace?.status !== nextStatus) {
              return workspacesApi.updateStatus(targetWorkspaceId, nextStatus)
            }
            return undefined
          })
          .catch(console.error)

        // Mark workspace as needing history reload in case user was away during agent execution
        state.markHistoryReloadNeeded(targetWorkspaceId, targetAgentType)
      }

      removeProcessBinding(processId)

      if (processId === state.activeProcessId) {
        useAgentStore.setState({ activeProcessId: null })
      }
    }
  )

  void reconcilePersistedProcesses()
}

if (typeof window !== "undefined") {
  registerCallbacksOnce()
}

export function useAgent() {
  const store = useAgentStore()

  const discoverAgents = useCallback(async (): Promise<AgentInfo[]> => {
    try {
      return await invoke<AgentInfo[]>("discover_agents")
    } catch (err) {
      console.error("Failed to discover agents:", err)
      return []
    }
  }, [])

  const createSession = useCallback(async (
    request: CreateSessionRequest
  ): Promise<Session> => {
    const session = await sessionsApi.create(request)
    useAgentStore.getState().setActiveSession(session.id)
    return session
  }, [])

  const loadSession = useCallback(async (sessionId: string) => {
    const session = await sessionsApi.get(sessionId)
    if (session) {
      useAgentStore.getState().setActiveSession(sessionId)
      useAgentStore.getState().loadSession(session)
    }
    return session
  }, [])

  const startAgent = async (
    workingDir: string,
    prompt: string,
    options?: {
      agentType?: AgentType
      claudePermissionMode?: ClaudePermissionMode
    }
  ) => {
    const processId = crypto.randomUUID()
    const type = options?.agentType ?? store.activeAgentType ?? "claude_code"

    console.log("[DEBUG] startAgent called with workingDir:", workingDir)

    const currentState = useAgentStore.getState()
    const targetWorkspaceId = currentState.activeWorkspaceId
    const targetSessionId = currentState.activeSessionId

    // Determine if this is a continuation (has previous logs = previous conversation exists)
    const hasPreviousConversation = currentState.logs.length > 0

    // Append user message as a log entry (preserves multi-turn history)
    const userLogEntry = {
      id: Date.now(),
      processId,
      entryType: "text",
      content: prompt,
      toolName: "user_message",
      filePath: null,
      timestamp: new Date().toISOString(),
      sequence: currentState.logs.length,
    } satisfies AgentLogEntry

    if (targetWorkspaceId) {
      currentState.appendLogToWorkspace(targetWorkspaceId, type, userLogEntry)
    } else {
      currentState.appendLog(userLogEntry)
    }

    useAgentStore.setState({
      activeAgentType: type,
      userPrompt: prompt,
      activeProcessId: processId,
      status: "running",
    })

    setProcessBinding(processId, {
      sessionId: targetSessionId,
      workspaceId: targetWorkspaceId,
      agentType: type,
    })
    useAgentStore.getState().setWorkspaceRuntime(
      targetWorkspaceId,
      type,
      {
        activeProcessId: processId,
        activeSessionId: targetSessionId,
        userPrompt: prompt,
        status: "running",
      }
    )

    try {
      await invoke("start_agent", {
        processId,
        agentType: type,
        workingDir,
        prompt,
        continueSession: hasPreviousConversation,
        permissionMode:
          type === "claude_code" ? options?.claudePermissionMode ?? "default" : null,
      })

      const runningState = useAgentStore.getState()

      if (runningState.activeSessionId) {
        await sessionsApi.updateStatus(runningState.activeSessionId, "running")
      }

      // Update workspace status to running
      if (runningState.activeWorkspaceId) {
        emitWorkspaceStatusChanged({
          workspaceId: runningState.activeWorkspaceId,
          status: "running",
          updatedAt: Date.now(),
        })
        await workspacesApi
          .updateStatus(runningState.activeWorkspaceId, "running")
          .catch(console.error)
      }
    } catch (err) {
      removeProcessBinding(processId)
      useAgentStore.setState({ status: "failed" })
      useAgentStore.getState().setWorkspaceRuntime(
        targetWorkspaceId,
        type,
        {
          status: "failed",
          activeProcessId: null,
        }
      )
      const errorLogEntry = {
        id: Date.now(),
        processId,
        entryType: "error",
        content: String(err),
        toolName: null,
        filePath: null,
        timestamp: new Date().toISOString(),
        sequence: 0,
      } satisfies AgentLogEntry

      if (targetWorkspaceId) {
        useAgentStore
          .getState()
          .appendLogToWorkspace(targetWorkspaceId, type, errorLogEntry)
      } else {
        useAgentStore.getState().appendLog(errorLogEntry)
      }
      throw err
    }
  }

  const stopAgent = async () => {
    const processId = store.activeProcessId
    if (!processId) return
    try {
      const binding = getProcessBinding(processId)
      await invoke("stop_agent", { processId })
      useAgentStore.setState({ status: "killed", activeProcessId: null })
      useAgentStore.getState().setWorkspaceRuntime(
        binding?.workspaceId ?? store.activeWorkspaceId,
        binding?.agentType ?? store.activeAgentType,
        {
          status: "killed",
          activeProcessId: null,
        }
      )
      const targetWorkspaceId = binding?.workspaceId ?? store.activeWorkspaceId
      if (targetWorkspaceId) {
        emitWorkspaceStatusChanged({
          workspaceId: targetWorkspaceId,
          status: "need_review",
          updatedAt: Date.now(),
        })
      }
      if (binding?.sessionId ?? store.activeSessionId) {
        await sessionsApi.updateStatus(
          binding?.sessionId ?? store.activeSessionId!,
          "killed"
        )
      }
      removeProcessBinding(processId)
    } catch (err) {
      console.error("Failed to stop agent:", err)
    }
  }

  return {
    ...store,
    discoverAgents,
    createSession,
    loadSession,
    startAgent,
    stopAgent,
  }
}
