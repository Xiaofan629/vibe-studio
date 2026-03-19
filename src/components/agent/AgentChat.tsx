"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useAgentStore } from "@/stores/agentStore"
import { useReviewStore } from "@/stores/reviewStore"
import { useAgent } from "@/hooks/useAgent"
import { useReview } from "@/hooks/useReview"
import { sessionsApi } from "@/lib/tauri"
import { AgentOutput } from "./AgentOutput"
import { AgentInput } from "./AgentInput"
import { SessionStatsPanel } from "./SessionStats"
import { Message, MessageContent } from "@/components/ai-elements/message"
import {
  AlertCircle,
  Bot,
  ListOrdered,
  MessageSquare,
} from "lucide-react"
import type {
  AgentType,
  AgentLogEntry,
  ClaudePermissionMode,
} from "@/lib/types"

interface AgentChatProps {
  projectId: string
  projectPath: string // Work directory (worktree for workspaces, original otherwise)
  originalProjectPath: string // Original project path (for non-workspace history loading)
  branch: string
  agentType: AgentType
  sessionId?: string
  workspaceId?: string
  initialPrompt?: string
  onInitialPromptConsumed?: () => void
}

interface ConversationTurn {
  type: "user" | "assistant"
  entries: AgentLogEntry[]
}

function isRenderableEntry(entry: AgentLogEntry) {
  if (entry.toolName === "user_message") {
    return true
  }

  if (entry.entryType === "text") {
    return entry.content.trim().length > 0
  }

  return true
}

function entrySignature(entry: Pick<AgentLogEntry, "entryType" | "toolName" | "filePath" | "content">) {
  return JSON.stringify([
    entry.entryType,
    entry.toolName ?? "",
    entry.filePath ?? "",
    entry.content,
  ])
}

function mergeHistoryAndLiveEntries(
  historyEntries: AgentLogEntry[],
  liveEntries: AgentLogEntry[]
) {
  if (liveEntries.length === 0) {
    return historyEntries
  }

  const seenCounts = new Map<string, number>()
  for (const entry of historyEntries) {
    const key = entrySignature(entry)
    seenCounts.set(key, (seenCounts.get(key) ?? 0) + 1)
  }

  const dedupedLiveEntries: AgentLogEntry[] = []
  for (const entry of liveEntries) {
    const key = entrySignature(entry)
    const remaining = seenCounts.get(key) ?? 0
    if (remaining > 0) {
      seenCounts.set(key, remaining - 1)
      continue
    }
    dedupedLiveEntries.push(entry)
  }

  return [
    ...historyEntries,
    ...dedupedLiveEntries.map((entry, idx) => ({
      ...entry,
      sequence: historyEntries.length + idx,
    })),
  ]
}

function groupIntoTurns(logs: AgentLogEntry[]): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  let currentAssistantEntries: AgentLogEntry[] = []

  for (const entry of logs) {
    if (entry.toolName === "user_message") {
      // Flush any pending assistant entries
      if (currentAssistantEntries.length > 0) {
        turns.push({ type: "assistant", entries: currentAssistantEntries })
        currentAssistantEntries = []
      }
      turns.push({ type: "user", entries: [entry] })
    } else if (isRenderableEntry(entry)) {
      currentAssistantEntries.push(entry)
    } else {
      continue
    }
  }

  // Flush remaining assistant entries
  if (currentAssistantEntries.length > 0) {
    turns.push({ type: "assistant", entries: currentAssistantEntries })
  }

  return turns
}

function getAgentLabel(agentType: AgentType) {
  switch (agentType) {
    case "claude_code":
      return "Claude Code"
    case "codex":
      return "Codex"
    case "gemini":
      return "Gemini CLI"
    default:
      return agentType
  }
}

export function AgentChat({
  projectId,
  projectPath,
  originalProjectPath,
  branch,
  agentType,
  sessionId,
  workspaceId,
  initialPrompt,
  onInitialPromptConsumed,
}: AgentChatProps) {
  const { logs, status, activeSessionId, sessionStats } = useAgentStore()
  const { startAgent, stopAgent, createSession, loadSession } = useAgent()
  const { unresolvedCount, buildReviewContext, loadComments } = useReview()
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const initialPromptSentRef = useRef(false)
  const prevWorkspaceRef = useRef<string | null>(null)
  const prevAgentRef = useRef<AgentType | null>(null)
  const historyLoadedForRef = useRef<string | null>(null)
  const queueDrainInFlightRef = useRef(false)
  const [uiError, setUiError] = useState<string | null>(null)
  const [queuedPrompts, setQueuedPrompts] = useState<string[]>([])
  const [claudePermissionMode, setClaudePermissionMode] =
    useState<ClaudePermissionMode>("default")
  const [historyReloadKey, setHistoryReloadKey] = useState(0)

  // Determine the correct path for loading Claude history:
  // - Workspace mode: use projectPath (worktree directory) because Claude Code
  //   stores its history based on the working directory it runs in
  // - Normal mode: use originalProjectPath (the original project directory)
  const historyPath = workspaceId ? projectPath : originalProjectPath

  useEffect(() => {
    if (!workspaceId) {
      return
    }

    useAgentStore.getState().setActiveWorkspace(workspaceId)

    return () => {
      useAgentStore.getState().saveToCache(workspaceId, agentType)
    }
  }, [agentType, workspaceId, historyPath])

  // ── Workspace switch: save/restore cached logs ────────────────────────
  // This effect runs BEFORE the history-loading effect so that switching
  // to a workspace with a cache skips the JSONL reload entirely.
  useEffect(() => {
    const currentWsId = workspaceId ?? null
    const prevWsId = prevWorkspaceRef.current
    const prevAgentType = prevAgentRef.current

    // Only act when workspace or agent actually changed
    if (currentWsId === prevWsId && agentType === prevAgentType) return
    prevWorkspaceRef.current = currentWsId
    prevAgentRef.current = agentType

    if (currentWsId) {
      // switchWorkspace saves old workspace+agent logs to cache, restores new workspace+agent from cache
      const hadCache = useAgentStore
        .getState()
        .switchWorkspace(prevWsId, prevAgentType, currentWsId, agentType)
      if (hadCache) {
        const restoredState = useAgentStore.getState()
        const hasRestoredLogs = restoredState.logs.length > 0
        const hasActiveRuntime =
          restoredState.status === "running" || !!restoredState.activeProcessId

        if (hasRestoredLogs || hasActiveRuntime) {
          // Cache hit with meaningful data — skip JSONL reload
          const loadKey = `${currentWsId}:${historyPath}:${agentType}`
          historyLoadedForRef.current = loadKey
        } else {
          // Cache hit but empty — force JSONL reload to avoid stale "no records"
          historyLoadedForRef.current = null
        }
      } else {
        // Cache miss — reset historyLoadedFor so the JSONL loader runs
        historyLoadedForRef.current = null
      }
    } else {
      // No workspace (non-workspace project mode)
      // Save the previous workspace logs if there was one
      if (prevWsId) {
        useAgentStore.getState().saveToCache(prevWsId, prevAgentType)
      }
      // Clear for non-workspace project
      historyLoadedForRef.current = null
    }

    // Clear review comments when switching workspaces
    // This ensures stale comments from the previous workspace are not shown
    useReviewStore.getState().setComments([])
  }, [workspaceId, historyPath, agentType])

  useEffect(() => {
    if (!workspaceId) {
      return
    }

    const needsReload = useAgentStore
      .getState()
      .checkAndClearHistoryReloadNeeded(workspaceId, agentType)

    if (!needsReload) {
      return
    }

    historyLoadedForRef.current = null
  }, [workspaceId, agentType])

  // ── Load agent history from JSONL files ──────────────────────────────
  // Only runs when there is no cached state for the workspace
  useEffect(() => {
    const loadKey = `${workspaceId ?? "none"}:${historyPath}:${agentType}`

    // Skip if already loaded (either from cache or previous JSONL load)
    if (historyLoadedForRef.current === loadKey) return
    historyLoadedForRef.current = loadKey

    if (!workspaceId) return

    console.log(
      `[HistoryLoad] Loading ${agentType} history for workspace: ${workspaceId}`
    )
    console.log(`[HistoryLoad] History path: ${historyPath}`)

    // Calculate expected file paths for debugging
    const encodedPath = historyPath
      .replace(/\//g, "-")
      .replace(/ /g, "-")
      .replace(/\./g, "-")
    const expectedClaudePath = `~/.claude/projects/${encodedPath}/*.jsonl`
    console.log(
      `[HistoryLoad] Expected Claude file path: ${expectedClaudePath}`
    )

    // Load based on agent type
    const loadPromise =
      agentType === "codex"
        ? sessionsApi.loadCodexSessionFull(workspaceId)
        : agentType === "claude_code"
          ? sessionsApi.loadClaudeSessionFull(workspaceId)
          : agentType === "gemini"
            ? sessionsApi.loadGeminiSessionFull(workspaceId)
            : Promise.reject(new Error(`${agentType} 暂不支持历史回放`))

    loadPromise
      .then((conversation) => {
        setUiError(null)
        console.log(
          `[HistoryLoad] Successfully loaded ${conversation.turns.length} turns from ${agentType} history`
        )
        useAgentStore.getState().setSessionStats(conversation.sessionStats)

        const entries: AgentLogEntry[] = []
        let seq = 0
        conversation.turns.forEach((turn) => {
          turn.blocks.forEach((block) => {
            if (block.type === "text") {
              const normalizedText = block.text.trim()
              if (
                normalizedText.length === 0 ||
                normalizedText === "undefined" ||
                normalizedText === "null"
              ) {
                return
              }
              entries.push({
                id: seq,
                processId: "history",
                entryType: "text",
                content: normalizedText,
                toolName: turn.role === "user" ? "user_message" : null,
                filePath: null,
                timestamp: turn.timestamp,
                sequence: seq++,
              })
            } else if (block.type === "thinking") {
              entries.push({
                id: seq,
                processId: "history",
                entryType: "thinking",
                content: block.text,
                toolName: null,
                filePath: null,
                timestamp: turn.timestamp,
                sequence: seq++,
              })
            } else if (block.type === "tool_use") {
              entries.push({
                id: seq,
                processId: "history",
                entryType: "tool_call",
                content: block.inputPreview || "{}",
                toolName: block.toolName,
                filePath: null,
                timestamp: turn.timestamp,
                sequence: seq++,
              })
            } else if (block.type === "tool_result") {
              entries.push({
                id: seq,
                processId: "history",
                entryType: block.isError ? "error" : "tool_result",
                content: block.outputPreview || "(no output)",
                toolName: null,
                filePath: null,
                timestamp: turn.timestamp,
                sequence: seq++,
              })
            }
          })
        })

        useAgentStore.getState().setLogs(
          (() => {
            const historyEntries = entries.map((entry, idx) => ({
              ...entry,
              id: Date.now() + idx,
              processId: `${agentType}-history`,
              sequence: idx,
            }))

            const storeState = useAgentStore.getState()
            const isActiveContext =
              workspaceId === storeState.activeWorkspaceId &&
              agentType === storeState.activeAgentType
            const shouldMergeLiveLogs =
              isActiveContext &&
              storeState.status === "running" &&
              !!storeState.activeProcessId
            const liveLogs = shouldMergeLiveLogs
              ? storeState.logs.filter(
                  (entry) => entry.processId !== `${agentType}-history`
                )
              : []

            if (liveLogs.length === 0) {
              return historyEntries
            }

            return mergeHistoryAndLiveEntries(historyEntries, liveLogs)
          })()
        )

        // Also save to cache immediately so future switches are instant
        if (workspaceId) {
          useAgentStore.getState().saveToCache(workspaceId, agentType)
        }
      })
      .catch((err) => {
        // Don't clearLogs on failure! The workspace might have in-session logs
        // that were set by the agent during this session. Only clear sessionStats.
        // If the workspace truly has no history, logs will already be empty from switchWorkspace.
        setUiError(err instanceof Error ? err.message : "加载历史记录失败")
        console.debug(`No ${agentType} history found for workspace: ${workspaceId}`)
      })
  }, [workspaceId, historyReloadKey, agentType, historyPath])

  useEffect(() => {
    if (!workspaceId) {
      return
    }

    useAgentStore.getState().saveToCache(workspaceId, agentType)
  }, [workspaceId, agentType, logs, activeSessionId, sessionStats])

  // ── Reload history when returning to page if agent completed while away ──
  useEffect(() => {
    if (!workspaceId) return

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const state = useAgentStore.getState()
        const needsReload = state.checkAndClearHistoryReloadNeeded(
          workspaceId,
          agentType
        )

        if (needsReload) {
          console.log(
            `[HistoryReload] Agent completed while away, reloading history for workspace: ${workspaceId}`
          )
          // Reset the history loaded flag to trigger JSONL reload
          historyLoadedForRef.current = null
          // Trigger the history load effect by updating historyPath ref
          // The effect depends on workspaceId which hasn't changed, so we use a key invalidation
          setHistoryReloadKey((prev) => prev + 1)
        }
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [workspaceId, agentType])

  // Load session if explicitly provided via props
  useEffect(() => {
    if (sessionId && sessionId !== activeSessionId) {
      loadSession(sessionId)
    }
  }, [sessionId, activeSessionId, loadSession])

  // Load comments when session changes
  useEffect(() => {
    const currentSessionId = sessionId ?? activeSessionId
    if (currentSessionId) {
      loadComments(currentSessionId).catch(() => {
        // Ignore errors when loading comments
      })
    }
  }, [sessionId, activeSessionId, loadComments])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [logs.length])

  useEffect(() => {
    if (status === "running" || queuedPrompts.length === 0 || queueDrainInFlightRef.current) {
      return
    }

    const [nextPrompt, ...rest] = queuedPrompts
    queueDrainInFlightRef.current = true
    setQueuedPrompts(rest)

    Promise.resolve(handleSend(nextPrompt))
      .catch(() => {})
      .finally(() => {
        queueDrainInFlightRef.current = false
      })
  }, [queuedPrompts, status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-send initial prompt (one-time)
  useEffect(() => {
    // Check if we should auto-send the initial prompt:
    // 1. initialPrompt exists
    // 2. Not already sent
    // 3. Agent is not currently running
    // 4. Session is loaded (activeSessionId exists)
    // 5. Session has no existing user messages (text entries)
    const hasExistingUserMessages = logs.some(
      (log) => log.entryType === "text"
    )

    if (
      initialPrompt &&
      !initialPromptSentRef.current &&
      status !== "running" &&
      activeSessionId &&
      !hasExistingUserMessages
    ) {
      // Auto-send initial prompt when session is ready and has no existing conversation
      initialPromptSentRef.current = true
      onInitialPromptConsumed?.()
      handleSend(initialPrompt)
    } else if (!initialPrompt) {
      // Reset the ref when there's no initial prompt
      initialPromptSentRef.current = false
    }
  }, [initialPrompt, status, activeSessionId, logs, onInitialPromptConsumed]) // eslint-disable-line react-hooks/exhaustive-deps

  const isRunning = status === "running"

  const handleSend = async (message: string) => {
    if (status === "running") {
      setQueuedPrompts((prev) => [...prev, message])
      return
    }

    try {
      setUiError(null)

      // Use sessionId prop if provided, otherwise use activeSessionId from store
      // This ensures we use the correct session ID even when loadSession is still pending
      let currentSessionId = sessionId ?? activeSessionId

      // If no session exists, create one
      if (!currentSessionId) {
        const session = await createSession({
          project_id: projectId,
          branch,
          agent_type: agentType,
          title: message.slice(0, 50),
          workspace_id: workspaceId,
        })
        currentSessionId = session.id
      }

      // Only inject review context if we have an active session AND unresolved comments
      // This prevents injecting comments from previous workspaces when creating a new one
      let finalPrompt = message

      // Debug logging
      console.log("[AgentChat] handleSend:", {
        sessionId,
        activeSessionId,
        currentSessionId,
        unresolvedCount,
        commentsFromStore: useReviewStore.getState().comments.length,
      })

      if (currentSessionId && unresolvedCount > 0) {
        const reviewContext = await buildReviewContext(currentSessionId)
        console.log("[AgentChat] reviewContext:", reviewContext)
        if (reviewContext) {
          finalPrompt = `${reviewContext}\n\n---\n\n${message}`
        }
      }

      await startAgent(projectPath, finalPrompt, {
        agentType,
        claudePermissionMode,
      })
    } catch (err) {
      console.error("Failed to send message:", err)
      setUiError(err instanceof Error ? err.message : "发送消息失败")
    }
  }

  const handleStop = async () => {
    setQueuedPrompts([])
    try {
      await stopAgent()
    } catch (err) {
      setUiError(err instanceof Error ? err.message : "停止失败")
    }
  }

  const turns = useMemo(() => groupIntoTurns(logs), [logs])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {sessionStats && <SessionStatsPanel stats={sessionStats} />}
      {uiError && (
        <div className="mx-4 mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <div className="font-medium">聊天页面遇到错误</div>
            <div className="break-words text-destructive/90">{uiError}</div>
          </div>
        </div>
      )}
      {queuedPrompts.length > 0 && (
        <div className="mx-4 mt-4 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-300">
            <ListOrdered className="h-4 w-4" />
            待发送队列
          </div>
          <div className="space-y-2">
            {queuedPrompts.map((prompt, index) => (
              <div
                key={`${prompt.slice(0, 32)}-${index}`}
                className="rounded-md bg-background/80 px-3 py-2 text-sm text-muted-foreground"
              >
                <span className="mr-2 text-xs text-blue-600 dark:text-blue-300">
                  #{index + 1}
                </span>
                {prompt}
              </div>
            ))}
          </div>
        </div>
      )}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {logs.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6">
            <div className="text-center">
              <Bot className="mx-auto h-12 w-12 text-muted-foreground/40" />
              <p className="mt-4 text-sm text-muted-foreground">发送消息开始对话</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 p-4">
            {turns.map((turn, turnIdx) => {
              const renderableEntries =
                turn.type === "assistant"
                  ? turn.entries.filter(isRenderableEntry)
                  : turn.entries

              if (turn.type === "assistant" && renderableEntries.length === 0) {
                return null
              }

              if (turn.type === "user") {
                return (
                  <Message key={`turn-${turnIdx}`} from="user">
                    <MessageContent className="ml-auto max-w-[min(90%,820px)] rounded-[24px] border border-orange-500/15 bg-[linear-gradient(180deg,rgba(249,115,22,0.10),rgba(249,115,22,0.04))] px-4 py-3 shadow-[0_14px_36px_-28px_rgba(249,115,22,0.25)]">
                      <div className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-orange-700/70 dark:text-orange-300/80">
                        <MessageSquare className="h-3 w-3" />
                        You
                      </div>
                      <div className="whitespace-pre-wrap leading-relaxed text-sm">
                        {turn.entries[0].content}
                      </div>
                    </MessageContent>
                  </Message>
                )
              }
              return (
                <Message key={`turn-${turnIdx}`} from="assistant">
                  <MessageContent className="max-w-[min(100%,960px)] rounded-[28px] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,250,252,0.88))] px-4 py-4 shadow-[0_18px_44px_-34px_rgba(15,23,42,0.22)] dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.88),rgba(15,23,42,0.76))]">
                    <div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      <Bot className="h-3 w-3" />
                      {getAgentLabel(agentType)}
                    </div>
                    <div className="space-y-2">
                      {renderableEntries.map((entry, i) => (
                        <AgentOutput
                          key={`${entry.id}-${i}`}
                          entry={entry}
                          isLatest={
                            turnIdx === turns.length - 1 &&
                            i === renderableEntries.length - 1 &&
                            isRunning
                          }
                        />
                      ))}
                    </div>
                  </MessageContent>
                </Message>
              )
            })}

            {isRunning &&
              (turns.length === 0 ||
                turns[turns.length - 1].type === "user") && (
                <Message from="assistant">
                  <MessageContent className="max-w-[min(100%,960px)] rounded-[28px] border border-border/70 bg-background px-4 py-3 shadow-[0_18px_44px_-34px_rgba(15,23,42,0.22)]">
                    <div className="flex items-center gap-1.5 py-2">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground animate-[pulse_1.4s_ease-in-out_infinite]" />
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground animate-[pulse_1.4s_ease-in-out_0.2s_infinite]" />
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground animate-[pulse_1.4s_ease-in-out_0.4s_infinite]" />
                    </div>
                  </MessageContent>
                </Message>
              )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <AgentInput
        disabled={isRunning}
        isRunning={isRunning}
        onSend={handleSend}
        onStop={handleStop}
        hasUnresolvedComments={unresolvedCount > 0}
        unresolvedCount={unresolvedCount}
        projectPath={projectPath}
        agentLabel={getAgentLabel(agentType)}
        agentType={agentType}
        queueCount={queuedPrompts.length}
        claudePermissionMode={claudePermissionMode}
        onClaudePermissionModeChange={setClaudePermissionMode}
      />
    </div>
  )
}
