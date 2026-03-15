"use client"

import { useCallback } from "react"
import {
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
  Session,
  CreateSessionRequest,
} from "@/lib/types"

let callbacksRegistered = false
const PROCESS_BINDINGS_KEY = "vibe-studio:agent-process-bindings"

interface ProcessBinding {
  sessionId: string | null
  workspaceId: string | null
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
      try {
        const running = await invoke<boolean>("is_agent_running", { processId })
        if (running) {
          useAgentStore.setState({
            activeProcessId: processId,
            activeSessionId: binding.sessionId,
            activeWorkspaceId: binding.workspaceId,
            status: "running",
          })
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
        removeProcessBinding(processId)
      }
    })
  )
}

function registerCallbacksOnce() {
  if (callbacksRegistered) return
  callbacksRegistered = true

  registerCallbacks(
    (entry: AgentLogEntry) => {
      const state = useAgentStore.getState()
      const logEntry = {
        ...entry,
        id: Date.now() + Math.random(),
        processId: state.activeProcessId ?? "",
        sequence: state.logs.length,
      }
      state.appendLog(logEntry)
    },
    (processId: string) => {
      const state = useAgentStore.getState()
      const binding = getProcessBinding(processId)
      const targetSessionId = binding?.sessionId ?? state.activeSessionId
      const targetWorkspaceId = binding?.workspaceId ?? state.activeWorkspaceId

      if (processId === state.activeProcessId && state.status === "running") {
        state.setStatus("completed")
        state.setActiveProcess(null)
      }

      if (targetSessionId) {
        sessionsApi
          .updateStatus(targetSessionId, "completed")
          .catch(console.error)
      }
      if (targetWorkspaceId) {
        workspacesApi
          .get(targetWorkspaceId)
          .then((workspace) => {
            if (workspace?.status === "running") {
              return workspacesApi.updateStatus(
                targetWorkspaceId,
                "need_review"
              )
            }
          })
          .catch(console.error)
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
      useAgentStore.getState().setStatus("idle")
    }
    return session
  }, [])

  const startAgent = async (
    workingDir: string,
    prompt: string,
    agentType?: AgentType
  ) => {
    const processId = crypto.randomUUID()
    const type = agentType ?? store.activeAgentType ?? "claude_code"

    console.log("[DEBUG] startAgent called with workingDir:", workingDir)

    const currentState = useAgentStore.getState()

    // Determine if this is a continuation (has previous logs = previous conversation exists)
    const hasPreviousConversation = currentState.logs.length > 0

    // Append user message as a log entry (preserves multi-turn history)
    currentState.appendLog({
      id: Date.now(),
      processId,
      entryType: "text",
      content: prompt,
      toolName: "user_message",
      filePath: null,
      timestamp: new Date().toISOString(),
      sequence: currentState.logs.length,
    })

    useAgentStore.setState({
      userPrompt: prompt,
      activeProcessId: processId,
      status: "running",
    })

    const latestState = useAgentStore.getState()
    setProcessBinding(processId, {
      sessionId: latestState.activeSessionId,
      workspaceId: latestState.activeWorkspaceId,
    })

    try {
      await invoke("start_agent", {
        processId,
        agentType: type,
        workingDir,
        prompt,
        continueSession: hasPreviousConversation,
      })

      const runningState = useAgentStore.getState()

      if (runningState.activeSessionId) {
        await sessionsApi.updateStatus(runningState.activeSessionId, "running")
      }

      // Update workspace status to running
      if (runningState.activeWorkspaceId) {
        await workspacesApi
          .updateStatus(runningState.activeWorkspaceId, "running")
          .catch(console.error)
      }
    } catch (err) {
      removeProcessBinding(processId)
      useAgentStore.setState({ status: "failed" })
      useAgentStore.getState().appendLog({
        id: Date.now(),
        processId,
        entryType: "error",
        content: String(err),
        toolName: null,
        filePath: null,
        timestamp: new Date().toISOString(),
        sequence: 0,
      })
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
