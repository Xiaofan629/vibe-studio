"use client"

import { useTranslations } from "next-intl"
import {
  MessageSquare,
  MessageCircle,
  Terminal,
  Code2,
  FolderGit2,
  ArrowLeft,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Circle,
  ChevronDown,
  Bot,
} from "lucide-react"
import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { useAgent } from "@/hooks/useAgent"
import { useGit } from "@/hooks/useGit"
import { useProject } from "@/hooks/useProject"
import { useReview } from "@/hooks/useReview"
import { BranchSelector } from "@/components/project/BranchSelector"
import { ReviewContextBanner } from "@/components/agent/ReviewContextBanner"
import { AgentChat } from "@/components/agent/AgentChat"
import { ReviewPanel } from "@/components/review/ReviewPanel"
import { TerminalPanel } from "@/components/terminal/TerminalPanel"
import { PRBadge } from "@/components/pr/PRBadge"
import { CreatePRDialog } from "@/components/pr/CreatePRDialog"
import { CommitFlowDialog } from "@/components/commit/CommitFlowDialog"
import { workspacesApi, invoke } from "@/lib/tauri"
import type { AgentType, Workspace, WorkspaceRepo, PrInfo } from "@/lib/types"

type TabKey = "chat" | "review" | "terminal"

const TAB_CONFIG: { key: TabKey; icon: React.ElementType; labelKey: string }[] =
  [
    { key: "chat", icon: MessageSquare, labelKey: "tabs.chat" },
    { key: "review", icon: MessageCircle, labelKey: "tabs.review" },
    { key: "terminal", icon: Terminal, labelKey: "tabs.terminal" },
  ]

const AGENT_OPTIONS: { value: AgentType; label: string }[] = [
  { value: "claude_code", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "gemini", label: "Gemini CLI" },
]

const WORKSPACE_AGENT_KEY_PREFIX = "vibe-studio:workspace-agent:"

function normalizeAgentType(value: string): AgentType | null {
  if (value === "claude_code" || value === "codex" || value === "gemini") {
    return value
  }
  return null
}

function readStoredWorkspaceAgent(workspaceId: string): AgentType | null {
  if (typeof window === "undefined") {
    return null
  }

  const value = window.localStorage.getItem(
    `${WORKSPACE_AGENT_KEY_PREFIX}${workspaceId}`
  )
  if (
    value === "claude_code" ||
    value === "codex" ||
    value === "gemini"
  ) {
    return value
  }
  return null
}

function persistWorkspaceAgent(workspaceId: string, agentType: AgentType) {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(
    `${WORKSPACE_AGENT_KEY_PREFIX}${workspaceId}`,
    agentType
  )
}

const EDITOR_OPTIONS = [
  { value: "vscode", label: "VSCode", icon: Code2 },
  { value: "cursor", label: "Cursor", icon: Code2 },
  { value: "trae", label: "Trae", icon: Code2 },
]

export default function ProjectPage() {
  const t = useTranslations()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabKey>("chat")
  const [selectedAgent, setSelectedAgent] = useState<AgentType>("claude_code")

  // Workspace state
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(
    null
  )
  const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>([])
  const [activeRepoId, setActiveRepoId] = useState<string | null>(null)
  const [initialPrompt, setInitialPrompt] = useState<string | null>(null)
  const [prInfo, setPrInfo] = useState<PrInfo | null | undefined>(undefined)
  const [prBranch, setPrBranch] = useState<string | null>(null)
  const [showCreatePR, setShowCreatePR] = useState(false)
  const [showCommitDialog, setShowCommitDialog] = useState(false)
  const [reviewRefreshKey, setReviewRefreshKey] = useState(0)
  const [prRefreshKey, setPrRefreshKey] = useState(0)
  const [commitRefreshKey, setCommitRefreshKey] = useState(0)
  const [editorMenuOpen, setEditorMenuOpen] = useState(false)
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [chatPromptConsumed, setChatPromptConsumed] = useState(false)
  const [reviewContextPreview, setReviewContextPreview] = useState<string | null>(null)
  const [workspaceSessionId, setWorkspaceSessionId] = useState<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)

  const { openInEditor } = useProject()
  const { comments, loadComments, buildReviewContext } = useReview()

  // Active repo from workspace
  const activeRepo: WorkspaceRepo | null =
    currentWorkspace?.repos.find((r) => r.id === activeRepoId) ??
    currentWorkspace?.repos[0] ??
    null

  // Workspace root directory: the parent directory of all repo worktrees
  // e.g., if repo worktree is .../worktrees/<workspace-id>/blog-webapp,
  // workspace root is .../worktrees/<workspace-id>/
  // All repos in a workspace share this directory for a unified conversation
  const workspaceRootDir = (() => {
    if (!currentWorkspace) return null
    // Find first repo with a worktree_path to derive the workspace root
    const repoWithWorktree = currentWorkspace.repos.find((r) => r.worktree_path)
    if (!repoWithWorktree?.worktree_path) return null
    // Parent directory of the repo worktree = workspace root
    const parts = repoWithWorktree.worktree_path.split("/")
    parts.pop() // remove repo name
    return parts.join("/") || null
  })()

  // Work directory: prefer worktree path, fall back to original path
  const workDir = activeRepo?.worktree_path ?? activeRepo?.path ?? null
  const chatWorkDir = workspaceRootDir ?? workDir
  const chatInitialPrompt = chatPromptConsumed ? null : initialPrompt

  const {
    status: agentStatus,
    activeSessionId,
    setAgentType,
    createSession,
    loadSession,
  } = useAgent()

  const {
    branches,
    currentBranch,
    loading: gitLoading,
    fetchBranches,
    checkout,
  } = useGit(workDir)

  // In workspace mode, use workspace branch and disable selector
  const isWorkspaceMode = !!currentWorkspace
  const headBranch =
    (isWorkspaceMode ? activeRepo?.branch : currentBranch) ?? null
  const reviewBaseBranch = activeRepo?.base_branch ?? null
  const unresolvedReviewComments = comments.filter(
    (comment) => !comment.isResolved && comment.sentToAgent
  )

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  // Load workspace on mount
  useEffect(() => {
    const workspaceId = sessionStorage.getItem("vibe-studio:workspaceId")
    if (workspaceId) {
      workspacesApi
        .get(workspaceId)
        .then(async (ws) => {
          if (ws) {
            const restoredAgent =
              readStoredWorkspaceAgent(ws.id) ?? (ws.agent_type as AgentType)
            setCurrentWorkspace(ws)
            setSelectedAgent(restoredAgent)

            // Ensure we have at least one repo and it's set as active
            if (ws.repos.length > 0) {
              const firstRepo = ws.repos[0]
              setActiveRepoId(firstRepo.id)

              // Immediately create or load session for the first repo
              // This avoids timing issues with useEffect dependencies
              try {
                const existingSessions = await invoke<
                  {
                    id: string
                    project_id: string
                    agent_type: AgentType
                    branch: string
                    title: string | null
                    status: string
                    updated_at: string
                  }[]
                >("list_sessions_by_workspace", {
                  workspaceId: ws.id,
                })

                const projectSessions = existingSessions
                  .filter((session) => session.project_id === firstRepo.project_id)
                  .sort(
                    (left, right) =>
                      new Date(right.updated_at).getTime() -
                      new Date(left.updated_at).getTime()
                  )

                const latestSession =
                  projectSessions.find(
                    (session) => session.agent_type === restoredAgent
                  ) ?? projectSessions[0]

                if (latestSession) {
                  const latestSessionAgent = normalizeAgentType(
                    latestSession.agent_type
                  )
                  if (
                    latestSessionAgent &&
                    latestSessionAgent !== restoredAgent
                  ) {
                    setSelectedAgent(latestSessionAgent)
                    persistWorkspaceAgent(ws.id, latestSessionAgent)
                  }
                  setWorkspaceSessionId(latestSession.id)
                  await loadSession(latestSession.id)
                } else {
                  // Create new session immediately
                  const createdSession = await createSession({
                    project_id: firstRepo.project_id,
                    branch: firstRepo.branch,
                    agent_type: restoredAgent,
                    title:
                      ws.title ??
                      ws.initial_prompt?.slice(0, 60) ??
                      firstRepo.name,
                    workspace_id: ws.id,
                  })
                  setWorkspaceSessionId(createdSession.id)
                }
              } catch (err) {
                console.error("Failed to ensure workspace session on load:", err)
              }
            } else {
              console.error("Workspace has no repos:", ws.id)
            }
          }
        })
        .catch(() => {})
    }

    // Read initial prompt (one-time auto-send)
    const prompt = sessionStorage.getItem("vibe-studio:initialPrompt")
    if (prompt) {
      setInitialPrompt(prompt)
      sessionStorage.removeItem("vibe-studio:initialPrompt")
    }

    // Load all workspaces for sidebar
    workspacesApi
      .list()
      .then(setAllWorkspaces)
      .catch(() => {})
  }, [])

  // Fetch branches when active repo changes
  useEffect(() => {
    if (workDir) {
      fetchBranches()
    }
  }, [workDir, fetchBranches])

  useEffect(() => {
    if (!currentWorkspace) {
      return
    }

    persistWorkspaceAgent(currentWorkspace.id, selectedAgent)
  }, [currentWorkspace, selectedAgent])

  useEffect(() => {
    if (!currentWorkspace || currentWorkspace.agent_type === selectedAgent) {
      return
    }

    const previousWorkspace = currentWorkspace
    const previousWorkspaces = allWorkspaces
    const nextWorkspace = {
      ...currentWorkspace,
      agent_type: selectedAgent,
    }

    setCurrentWorkspace(nextWorkspace)
    setAllWorkspaces((items) =>
      items.map((workspace) =>
        workspace.id === currentWorkspace.id
          ? { ...workspace, agent_type: selectedAgent }
          : workspace
      )
    )

    workspacesApi.updateAgent(currentWorkspace.id, selectedAgent).catch((err) => {
      console.error("Failed to update workspace agent:", err)
      setCurrentWorkspace(previousWorkspace)
      setAllWorkspaces(previousWorkspaces)
    })
  }, [allWorkspaces, currentWorkspace, selectedAgent])

  // Track previous active repo to detect when it actually changes
  const prevActiveRepoRef = useRef<WorkspaceRepo | null>(null)

  useEffect(() => {
    if (!currentWorkspace || !activeRepo) {
      // Only clear session if we had a valid workspace before
      if (prevActiveRepoRef.current && !activeRepo) {
        setWorkspaceSessionId(null)
        setReviewContextPreview(null)
      }
      prevActiveRepoRef.current = activeRepo
      return
    }

    // Skip if active repo hasn't actually changed (avoid unnecessary re-runs)
    if (
      prevActiveRepoRef.current?.id === activeRepo.id &&
      prevActiveRepoRef.current?.project_id === activeRepo.project_id &&
      workspaceSessionId !== null
    ) {
      prevActiveRepoRef.current = activeRepo
      return
    }

    let cancelled = false
    setReviewContextPreview(null)

    const ensureWorkspaceSession = async () => {
      try {
        const existingSessions = await invoke<
          {
            id: string
            project_id: string
            agent_type: AgentType
            branch: string
            title: string | null
            status: string
            updated_at: string
          }[]
        >("list_sessions_by_workspace", {
          workspaceId: currentWorkspace.id,
        })

        if (cancelled) {
          return
        }

        const projectSessions = existingSessions
          .filter((session) => session.project_id === activeRepo.project_id)
          .sort(
            (left, right) =>
              new Date(right.updated_at).getTime() -
              new Date(left.updated_at).getTime()
          )

        const latestSession =
          projectSessions.find((session) => session.agent_type === selectedAgent) ??
          projectSessions[0]
        if (latestSession) {
          const latestSessionAgent = normalizeAgentType(latestSession.agent_type)
          if (
            latestSessionAgent &&
            latestSessionAgent !== selectedAgent
          ) {
            setSelectedAgent(latestSessionAgent)
            persistWorkspaceAgent(currentWorkspace.id, latestSessionAgent)
          }
          if (!cancelled) {
            setWorkspaceSessionId(latestSession.id)
          }
          if (latestSession.id !== activeSessionIdRef.current) {
            await loadSession(latestSession.id)
          }
          prevActiveRepoRef.current = activeRepo
          return
        }

        const createdSession = await createSession({
          project_id: activeRepo.project_id,
          branch: activeRepo.branch,
          agent_type: selectedAgent,
          title:
            currentWorkspace.title ??
            currentWorkspace.initial_prompt?.slice(0, 60) ??
            activeRepo.name,
          workspace_id: currentWorkspace.id,
        })
        if (!cancelled) {
          setWorkspaceSessionId(createdSession.id)
        }
        prevActiveRepoRef.current = activeRepo
      } catch (err) {
        console.error("Failed to ensure workspace session:", err)
      }
    }

    void ensureWorkspaceSession()

    return () => {
      cancelled = true
    }
  }, [
    activeRepo?.branch,
    activeRepo?.name,
    activeRepo?.project_id,
    activeRepo?.id,
    createSession,
    currentWorkspace?.id,
    currentWorkspace?.initial_prompt,
    currentWorkspace?.title,
    loadSession,
    selectedAgent,
    workspaceSessionId,
  ])

  const loadPrInfo = useCallback(() => {
    if (!workDir || !headBranch) {
      setPrInfo(undefined)
      setPrBranch(null)
      return
    }

    setPrInfo(undefined)
    setPrBranch(null)

    const prLookupBranches = [
      headBranch,
      ...(headBranch.startsWith("vibe-studio/") &&
      reviewBaseBranch &&
      !reviewBaseBranch.startsWith("origin/")
        ? [reviewBaseBranch]
        : []),
    ]

    void Promise.all(
      prLookupBranches.map((branch) =>
        invoke<PrInfo | null>("git_get_pr_info", {
          repoPath: workDir,
          branch,
        })
          .then((info) => ({ branch, info }))
          .catch(() => ({ branch, info: null as PrInfo | null }))
      )
    )
      .then((infos) => {
        const matched = infos.find((entry) => entry.info)
        setPrInfo(matched?.info ?? null)
        setPrBranch(matched?.branch ?? null)
      })
      .catch(() => {
        setPrInfo(null)
        setPrBranch(null)
      })
  }, [headBranch, reviewBaseBranch, workDir])

  // Load PR info when repo changes
  useEffect(() => {
    loadPrInfo()
  }, [loadPrInfo, prRefreshKey])

  // Sync agent type only while chatting; other tabs still keep the selector state.
  useEffect(() => {
    if (activeTab === "chat") {
      setAgentType(selectedAgent)
    }
  }, [activeTab, selectedAgent, setAgentType])

  useEffect(() => {
    if (!agentMenuOpen) {
      return
    }

    const handleClickOutside = () => {
      setAgentMenuOpen(false)
    }

    window.addEventListener("mousedown", handleClickOutside)
    return () => window.removeEventListener("mousedown", handleClickOutside)
  }, [agentMenuOpen])

  useEffect(() => {
    if (!activeSessionId || !workspaceSessionId || activeSessionId !== workspaceSessionId) {
      setReviewContextPreview(null)
      return
    }

    let cancelled = false

    loadComments(activeSessionId).catch(() => {
      if (!cancelled) {
        setReviewContextPreview(null)
      }
    })

    return () => {
      cancelled = true
    }
  }, [activeSessionId, loadComments, workspaceSessionId, activeTab])

  useEffect(() => {
    if (
      !activeSessionId ||
      !workspaceSessionId ||
      activeSessionId !== workspaceSessionId
    ) {
      setReviewContextPreview(null)
      return
    }

    const currentSessionComments = unresolvedReviewComments.filter(
      (c) => c.sessionId === activeSessionId
    )

    if (currentSessionComments.length === 0) {
      setReviewContextPreview(null)
      return
    }

    let cancelled = false

    buildReviewContext(activeSessionId)
      .then((reviewContext) => {
        if (cancelled) {
          return
        }

        setReviewContextPreview(reviewContext?.trim() || null)
      })
      .catch(() => {
        if (!cancelled) {
          setReviewContextPreview(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    activeSessionId,
    buildReviewContext,
    unresolvedReviewComments,
    workspaceSessionId,
  ])

  // Switch workspace
  const handleSwitchWorkspace = useCallback(async (ws: Workspace) => {
    sessionStorage.setItem("vibe-studio:workspaceId", ws.id)
    setWorkspaceSessionId(null)
    setReviewContextPreview(null)
    setCurrentWorkspace(ws)
    setSelectedAgent(readStoredWorkspaceAgent(ws.id) ?? (ws.agent_type as AgentType))
    if (ws.repos.length > 0) {
      setActiveRepoId(ws.repos[0].id)
    }
  }, [])

  const handleCompleteWorkspace = useCallback(async () => {
    if (!currentWorkspace) return
    try {
      await workspacesApi.updateStatus(currentWorkspace.id, "done")
      setCurrentWorkspace({ ...currentWorkspace, status: "done" })
      // Update in allWorkspaces list
      setAllWorkspaces((prev) =>
        prev.map((ws) =>
          ws.id === currentWorkspace.id ? { ...ws, status: "done" } : ws
        )
      )
    } catch (err) {
      console.error("Failed to complete workspace:", err)
    }
  }, [currentWorkspace])

  // Other workspaces (excluding current)
  const otherWorkspaces = allWorkspaces.filter(
    (ws) => ws.id !== currentWorkspace?.id
  )
  const selectedAgentLabel =
    AGENT_OPTIONS.find((option) => option.value === selectedAgent)?.label ??
    "Agent"

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Top Bar */}
      <header className="flex h-12 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/")}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            title="返回首页"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="font-semibold text-sm">Vibe Studio</span>
          {activeRepo && (
            <>
              <span className="text-muted-foreground">|</span>
              <span className="text-sm text-muted-foreground max-w-[150px] truncate">
                {activeRepo.name}
              </span>
              <BranchSelector
                branches={branches}
                currentBranch={headBranch}
                onCheckout={checkout}
                loading={gitLoading}
                disabled={isWorkspaceMode}
              />
              {reviewBaseBranch && (
                <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                  base {reviewBaseBranch}
                </span>
              )}
            </>
          )}
          {currentWorkspace && currentWorkspace.status !== "done" && (
            <button
              onClick={handleCompleteWorkspace}
              className="ml-2 flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1 text-sm text-white hover:bg-emerald-600"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              完成
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {activeTab === "review" && activeRepo && workDir && (
            <button
              onClick={() => setShowCommitDialog(true)}
              className="rounded-md border border-border bg-background px-3 py-1 text-sm hover:bg-accent"
            >
              提交
            </button>
          )}
          {activeRepo &&
            (prInfo === undefined ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>PR...</span>
              </div>
            ) : prInfo ? (
              <PRBadge prInfo={prInfo} />
            ) : (
              <button
                onClick={() => setShowCreatePR(true)}
                className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
              >
                创建 PR
              </button>
            ))}
          <div className="relative">
            <button
              onClick={() => setAgentMenuOpen((current) => !current)}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-muted/15 px-3 py-1.5 text-sm transition-colors hover:bg-accent"
            >
              <Bot className="h-4 w-4 text-muted-foreground" />
              <span className="max-w-[120px] truncate">
                {selectedAgentLabel}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>

            {agentMenuOpen && (
              <div
                onMouseDown={(event) => event.stopPropagation()}
                className="absolute right-0 top-full z-50 min-w-[180px] overflow-hidden rounded-2xl border border-border bg-popover p-1 shadow-[0_20px_60px_-36px_rgba(15,23,42,0.55)]"
              >
                {AGENT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setSelectedAgent(opt.value)
                      setAgentMenuOpen(false)
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition-colors ${
                      selectedAgent === opt.value
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
                    }`}
                  >
                    <span>{opt.label}</span>
                    {selectedAgent === opt.value && (
                      <span className="text-[11px] text-muted-foreground">
                        当前
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {activeRepo && (
            <div
              className="relative"
              onMouseEnter={() => setEditorMenuOpen(true)}
              onMouseLeave={() => setEditorMenuOpen(false)}
            >
              <button className="inline-flex items-center gap-2 rounded-xl border border-border bg-muted/15 px-3 py-1.5 text-sm transition-colors hover:bg-accent">
                {t("topbar.openIn")} ▾
              </button>
              <div
                className={`absolute right-0 top-full z-50 min-w-[160px] overflow-hidden rounded-2xl border border-border bg-popover p-1 shadow-[0_20px_60px_-36px_rgba(15,23,42,0.55)] transition-opacity ${
                  editorMenuOpen
                    ? "pointer-events-auto opacity-100"
                    : "pointer-events-none opacity-0"
                }`}
              >
                {EDITOR_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() =>
                      openInEditor(
                        opt.value,
                        activeRepo.worktree_path ?? activeRepo.path
                      )
                    }
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
                  >
                    <opt.icon className="h-3.5 w-3.5" />
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - Workspace Context */}
        <aside className="flex w-56 flex-col border-r border-border bg-sidebar overflow-y-auto">
          {/* Current workspace repos */}
          {currentWorkspace && (
            <div className="p-3">
              <h3 className="text-xs font-medium uppercase text-muted-foreground mb-2">
                当前工作区
              </h3>
              <p className="text-xs text-muted-foreground mb-2 truncate">
                {currentWorkspace.title ??
                  currentWorkspace.initial_prompt?.slice(0, 40) ??
                  "未命名"}
              </p>
              <div className="space-y-1">
                {currentWorkspace.repos.map((repo) => {
                  const isActive = repo.id === activeRepoId
                  return (
                    <button
                      key={repo.id}
                      onClick={() => setActiveRepoId(repo.id)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                        isActive
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                      }`}
                    >
                      <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                      <span className="flex-1 truncate">{repo.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Divider */}
          {currentWorkspace && otherWorkspaces.length > 0 && (
            <div className="border-t border-border" />
          )}

          {/* Other workspaces */}
          {otherWorkspaces.length > 0 && (
            <div className="p-3">
              <h3 className="text-xs font-medium uppercase text-muted-foreground mb-2">
                所有工作区
              </h3>
              <div className="space-y-1">
                {otherWorkspaces.map((ws) => (
                  <button
                    key={ws.id}
                    onClick={() => handleSwitchWorkspace(ws)}
                    className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                  >
                    <div className="flex items-center gap-1.5">
                      <WorkspaceStatusIcon status={ws.status} />
                      <span className="flex-1 truncate text-sm">
                        {ws.title ??
                          ws.initial_prompt?.slice(0, 30) ??
                          "未命名"}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground pl-5">
                      {ws.repos.map((r) => r.name).join(", ")}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Content Area */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex items-center border-b border-border">
            <div className="flex flex-1">
              {TAB_CONFIG.map(({ key, icon: Icon, labelKey }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm transition-colors ${
                    activeTab === key
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {t(labelKey)}
                </button>
              ))}
            </div>
            {activeTab === "chat" && unresolvedReviewComments.length > 0 && (
              <div className="pr-4">
                <ReviewContextBanner
                  count={unresolvedReviewComments.length}
                  preview={reviewContextPreview}
                />
              </div>
            )}
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-hidden">
            {activeTab === "chat" &&
              (activeRepo && workDir ? (
                <div className="flex h-full flex-col">
                  <div className="min-h-0 flex-1">
                    <AgentChat
                      projectId={activeRepo.project_id}
                      projectPath={chatWorkDir ?? workDir}
                      originalProjectPath={activeRepo.path}
                      branch={activeRepo.branch}
                      agentType={selectedAgent}
                      sessionId={workspaceSessionId ?? undefined}
                      workspaceId={currentWorkspace?.id}
                      initialPrompt={chatInitialPrompt ?? undefined}
                      onInitialPromptConsumed={() => setChatPromptConsumed(true)}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                  <MessageSquare className="mb-2 h-10 w-10" />
                  <p>{t("project.startCoding")}</p>
                </div>
              ))}

            {activeTab === "review" &&
              (activeRepo && workDir ? (
                <ReviewPanel
                  files={[]}
                  rawPatch=""
                  sessionId={activeSessionId ?? ""}
                  repoPath={workDir ?? ""}
                  baseBranch={reviewBaseBranch}
                  headBranch={activeRepo?.branch ?? null}
                  prInfo={prInfo ?? null}
                  refreshKey={reviewRefreshKey}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                  <MessageCircle className="mb-2 h-10 w-10" />
                  <p>{t("project.reviewHint")}</p>
                </div>
              ))}

            {activeTab === "terminal" && (
              <div className="h-full">
                <TerminalPanel
                  projectPath={workDir}
                  repoId={activeRepo?.id}
                  embedded
                />
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Status Bar */}
      <footer className="flex h-6 items-center border-t border-border bg-sidebar px-4 text-xs text-muted-foreground">
        <span className={agentStatus === "running" ? "text-blue-400" : ""}>
          {t(`agent.${agentStatus === "idle" ? "idle" : agentStatus}`)}
        </span>
        <span className="mx-2">|</span>
        <span>{currentBranch ?? activeRepo?.branch ?? "—"}</span>
        {activeRepo && (
          <>
            <span className="mx-2">|</span>
            <span className="truncate">{activeRepo.name}</span>
          </>
        )}
        {currentWorkspace && (
          <>
            <span className="mx-2">|</span>
            <span className="truncate text-muted-foreground">
              {currentWorkspace.title ?? "工作区"}
            </span>
          </>
        )}
      </footer>

      {/* Create PR Dialog */}
      {showCreatePR && workDir && headBranch && (
        <CreatePRDialog
          repoPath={workDir}
          headBranch={headBranch}
          preferredBaseBranch={reviewBaseBranch}
          agentType={selectedAgent}
          defaultTitle={
            currentWorkspace?.title ?? currentWorkspace?.initial_prompt ?? ""
          }
          workspaceTitle={currentWorkspace?.title ?? undefined}
          workspacePrompt={currentWorkspace?.initial_prompt ?? undefined}
          onClose={() => setShowCreatePR(false)}
          onSuccess={(info) => {
            setPrInfo(info)
            setShowCreatePR(false)
          }}
        />
      )}

      {showCommitDialog && workDir && (
        <CommitFlowDialog
          repoPath={workDir}
          headBranch={headBranch}
          prInfo={prInfo ?? null}
          prBranch={prBranch}
          agentType={selectedAgent}
          workspaceTitle={currentWorkspace?.title ?? null}
          workspacePrompt={currentWorkspace?.initial_prompt ?? null}
          refreshKey={commitRefreshKey}
          onClose={() => setShowCommitDialog(false)}
          onCommitted={() => {
            setCommitRefreshKey((current) => current + 1)
            setReviewRefreshKey((current) => current + 1)
            setPrRefreshKey((current) => current + 1)
            loadPrInfo()
          }}
          onRequestCreatePr={() => setShowCreatePR(true)}
        />
      )}
    </div>
  )
}

function WorkspaceStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "running":
      return <Loader2 className="h-3 w-3 text-blue-500 animate-spin shrink-0" />
    case "need_review":
      return <AlertCircle className="h-3 w-3 text-amber-500 shrink-0" />
    case "done":
      return <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
    default:
      return <Circle className="h-3 w-3 text-muted-foreground shrink-0" />
  }
}
