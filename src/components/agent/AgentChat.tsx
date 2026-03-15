"use client"

import { useEffect, useRef, useMemo } from "react"
import { useAgentStore } from "@/stores/agentStore"
import { useAgent } from "@/hooks/useAgent"
import { useReview } from "@/hooks/useReview"
import { sessionsApi } from "@/lib/tauri"
import { AgentOutput } from "./AgentOutput"
import { AgentInput } from "./AgentInput"
import { SessionStatsPanel } from "./SessionStats"
import { Message, MessageContent } from "@/components/ai-elements/message"
import { Bot, MessageSquare } from "lucide-react"
import type { AgentType, AgentLogEntry } from "@/lib/types"

interface AgentChatProps {
  projectId: string
  projectPath: string // Work directory (worktree for workspaces, original otherwise)
  originalProjectPath: string // Original project path (for non-workspace history loading)
  branch: string
  agentType: AgentType
  sessionId?: string
  workspaceId?: string
  initialPrompt?: string
}

interface ConversationTurn {
  type: "user" | "assistant"
  entries: AgentLogEntry[]
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
    } else {
      currentAssistantEntries.push(entry)
    }
  }

  // Flush remaining assistant entries
  if (currentAssistantEntries.length > 0) {
    turns.push({ type: "assistant", entries: currentAssistantEntries })
  }

  return turns
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
}: AgentChatProps) {
  const { logs, status, activeSessionId, sessionStats } = useAgentStore()
  const { startAgent, stopAgent, createSession, loadSession } = useAgent()
  const { unresolvedCount, buildReviewContext } = useReview()
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const initialPromptSentRef = useRef(false)
  const prevWorkspaceRef = useRef<string | null>(null)
  const historyLoadedForRef = useRef<string | null>(null)

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
      useAgentStore.getState().saveToCache(workspaceId)
    }
  }, [workspaceId, historyPath])

  // ── Workspace switch: save/restore cached logs ────────────────────────
  // This effect runs BEFORE the history-loading effect so that switching
  // to a workspace with a cache skips the JSONL reload entirely.
  useEffect(() => {
    const currentWsId = workspaceId ?? null
    const prevWsId = prevWorkspaceRef.current

    // Only act when workspace actually changed
    if (currentWsId === prevWsId) return
    prevWorkspaceRef.current = currentWsId

    if (currentWsId) {
      // switchWorkspace saves old workspace logs to cache, restores new workspace from cache
      const hadCache = useAgentStore
        .getState()
        .switchWorkspace(prevWsId, currentWsId)
      if (hadCache) {
        // Cache hit — mark history as already loaded so we don't re-fetch from JSONL
        const loadKey = `${currentWsId}:${historyPath}`
        historyLoadedForRef.current = loadKey
      } else {
        // Cache miss — reset historyLoadedFor so the JSONL loader runs
        historyLoadedForRef.current = null
      }
    } else {
      // No workspace (non-workspace project mode)
      // Save the previous workspace logs if there was one
      if (prevWsId) {
        useAgentStore.getState().saveToCache(prevWsId)
      }
      // Clear for non-workspace project
      historyLoadedForRef.current = null
    }
  }, [workspaceId, historyPath])

  // ── Load Claude history from JSONL files ──────────────────────────────
  // Only runs when there is no cached state for the workspace
  useEffect(() => {
    const loadKey = `${workspaceId ?? "none"}:${historyPath}`

    // Skip if already loaded (either from cache or previous JSONL load)
    if (historyLoadedForRef.current === loadKey) return
    historyLoadedForRef.current = loadKey

    if (!workspaceId) return

    console.log(
      `[HistoryLoad] Loading Claude history for workspace: ${workspaceId}`
    )
    console.log(`[HistoryLoad] History path: ${historyPath}`)

    // Calculate expected Claude file path
    const encodedPath = historyPath
      .replace(/\//g, "-")
      .replace(/ /g, "-")
      .replace(/\./g, "-")
    const expectedClaudePath = `~/.claude/projects/${encodedPath}/*.jsonl`
    console.log(
      `[HistoryLoad] Expected Claude file path: ${expectedClaudePath}`
    )

    // Load from Claude's local JSONL history files via workspace ID
    sessionsApi
      .loadClaudeSessionFull(workspaceId)
      .then((conversation) => {
        console.log(
          `[HistoryLoad] Successfully loaded ${conversation.turns.length} turns from Claude history`
        )
        useAgentStore.getState().setSessionStats(conversation.sessionStats)

        const entries: AgentLogEntry[] = []
        let seq = 0
        conversation.turns.forEach((turn) => {
          turn.blocks.forEach((block) => {
            if (block.type === "text") {
              entries.push({
                id: seq,
                processId: "history",
                entryType: "text",
                content: block.text,
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
          entries.map((entry, idx) => ({
            ...entry,
            id: Date.now() + idx,
            processId: "claude-history",
            sequence: idx,
          }))
        )

        // Also save to cache immediately so future switches are instant
        if (workspaceId) {
          useAgentStore.getState().saveToCache(workspaceId)
        }
      })
      .catch(() => {
        // Don't clearLogs on failure! The workspace might have in-session logs
        // that were set by the agent during this session. Only clear sessionStats.
        // If the workspace truly has no history, logs will already be empty from switchWorkspace.
        console.debug(`No Claude history found for workspace: ${workspaceId}`)
      })
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) {
      return
    }

    useAgentStore.getState().saveToCache(workspaceId)
  }, [workspaceId, logs, activeSessionId, sessionStats])

  // Load session if explicitly provided via props
  useEffect(() => {
    if (sessionId && sessionId !== activeSessionId) {
      loadSession(sessionId)
    }
  }, [sessionId, activeSessionId, loadSession])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [logs.length])

  // Auto-send initial prompt (one-time)
  useEffect(() => {
    if (
      initialPrompt &&
      !initialPromptSentRef.current &&
      status !== "running"
    ) {
      initialPromptSentRef.current = true
      handleSend(initialPrompt)
    }
  }, [initialPrompt]) // eslint-disable-line react-hooks/exhaustive-deps

  const isRunning = status === "running"

  const handleSend = async (message: string) => {
    try {
      if (!activeSessionId) {
        await createSession({
          project_id: projectId,
          branch,
          agent_type: agentType,
          title: message.slice(0, 50),
          workspace_id: workspaceId,
        })
      }

      // Inject review context if there are unsent unresolved comments
      let finalPrompt = message
      const reviewContext = await buildReviewContext()
      if (reviewContext) {
        finalPrompt = `${reviewContext}\n\n---\n\n${message}`
      }

      await startAgent(projectPath, finalPrompt, agentType)
    } catch (err) {
      console.error("Failed to send message:", err)
    }
  }

  const turns = useMemo(() => groupIntoTurns(logs), [logs])

  return (
    <div className="flex h-full flex-col">
      {sessionStats && <SessionStatsPanel stats={sessionStats} />}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {logs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground gap-3 px-4">
            <Bot className="h-10 w-10 opacity-30" />
            <p className="text-sm text-center">发送消息开始 Vibe Coding</p>
          </div>
        ) : (
          <div className="space-y-4 p-4">
            {turns.map((turn, turnIdx) => {
              if (turn.type === "user") {
                return (
                  <Message key={`turn-${turnIdx}`} from="user">
                    <MessageContent>
                      <div className="whitespace-pre-wrap">
                        {turn.entries[0].content}
                      </div>
                    </MessageContent>
                  </Message>
                )
              }
              return (
                <Message key={`turn-${turnIdx}`} from="assistant">
                  <MessageContent className="rounded-[22px] border border-border/70 bg-background/70 px-4 py-4 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.5)] backdrop-blur">
                    <div className="space-y-2">
                      {turn.entries.map((entry, i) => (
                        <AgentOutput
                          key={`${entry.id}-${i}`}
                          entry={entry}
                          isLatest={
                            turnIdx === turns.length - 1 &&
                            i === turn.entries.length - 1 &&
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
                  <MessageContent className="rounded-[22px] border border-border/70 bg-background/70 px-4 py-4 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.5)] backdrop-blur">
                    <div className="flex items-center gap-1.5 py-1">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-[pulse_1.4s_ease-in-out_infinite]" />
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-[pulse_1.4s_ease-in-out_0.2s_infinite]" />
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-[pulse_1.4s_ease-in-out_0.4s_infinite]" />
                    </div>
                  </MessageContent>
                </Message>
              )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {unresolvedCount > 0 && (
        <div className="mx-4 mb-1 flex items-center gap-1.5 rounded-md bg-yellow-500/10 px-3 py-1.5 text-xs text-yellow-600 dark:text-yellow-400">
          <MessageSquare className="h-3 w-3" />
          <span>{unresolvedCount} 条未解决评审评论将随消息自动发送</span>
        </div>
      )}

      <AgentInput
        disabled={isRunning}
        isRunning={isRunning}
        onSend={handleSend}
        onStop={stopAgent}
        hasUnresolvedComments={unresolvedCount > 0}
      />
    </div>
  )
}
