"use client"

import { useTranslations } from "next-intl"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  FolderGit2,
  GitBranch,
  GripVertical,
  KanbanSquare,
  Loader2,
  Play,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"
import { invoke, workspacesApi } from "@/lib/tauri"
import { FileBrowser } from "@/components/workspace/FileBrowser"
import type {
  AgentType,
  Project,
  Workspace,
  WorkspaceStatus,
} from "@/lib/types"

interface SelectedRepo {
  path: string
  name: string
  branch: string
  branches: string[]
  loadingBranches: boolean
}

type TabKey = "recent" | "browse" | "create"
type BoardColumnKey = "need_review" | "running" | "done"
type PointerDragState = {
  workspace: Workspace
  startX: number
  startY: number
  currentX: number
  currentY: number
  offsetX: number
  offsetY: number
  width: number
  height: number
  activated: boolean
}

const AGENT_OPTIONS: { value: AgentType; label: string }[] = [
  { value: "claude_code", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "gemini", label: "Gemini CLI" },
]

const BOARD_COLUMNS: {
  key: BoardColumnKey
  title: string
  description: string
}[] = [
  {
    key: "need_review",
    title: "Todo",
    description: "等待你检查、提交或创建 PR",
  },
  {
    key: "running",
    title: "Doing",
    description: "Agent 正在处理中的工作区",
  },
  {
    key: "done",
    title: "Done",
    description: "已经完成的工作区",
  },
]

function getStatusMeta(status: BoardColumnKey) {
  switch (status) {
    case "need_review":
      return {
        icon: AlertCircle,
        accent:
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      }
    case "running":
      return {
        icon: Loader2,
        accent:
          "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
      }
    case "done":
      return {
        icon: CheckCircle2,
        accent:
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      }
    default:
      return {
        icon: Circle,
        accent: "border-border bg-muted/40 text-muted-foreground",
      }
  }
}

export default function HomePage() {
  const t = useTranslations()
  const router = useRouter()
  const [selectedRepos, setSelectedRepos] = useState<SelectedRepo[]>([])
  const [recentProjects, setRecentProjects] = useState<Project[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeTab, setActiveTab] = useState<TabKey>("recent")
  const [browserOpen, setBrowserOpen] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [cloneUrl, setCloneUrl] = useState("")
  const [cloneTarget, setCloneTarget] = useState("")
  const [cloneToken, setCloneToken] = useState("")
  const [cloning, setCloning] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [promptText, setPromptText] = useState("")
  const [selectedAgent, setSelectedAgent] = useState<AgentType>("claude_code")
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draggingWorkspaceId, setDraggingWorkspaceId] = useState<string | null>(
    null
  )
  const [pointerDrag, setPointerDrag] = useState<PointerDragState | null>(null)
  const [activeDropLane, setActiveDropLane] = useState<BoardColumnKey | null>(
    null
  )
  const [pendingDeleteWorkspace, setPendingDeleteWorkspace] =
    useState<Workspace | null>(null)
  const pointerDragRef = useRef<PointerDragState | null>(null)

  useEffect(() => {
    invoke<Project[]>("list_projects")
      .then(setRecentProjects)
      .catch(() => {})

    workspacesApi
      .list()
      .then(setWorkspaces)
      .catch(() => {})
  }, [])

  const loadBranches = useCallback(async (path: string): Promise<string[]> => {
    try {
      return await invoke<string[]>("get_repo_branches", { repoPath: path })
    } catch {
      return ["main"]
    }
  }, [])

  const addRepo = useCallback(
    async (path: string) => {
      if (selectedRepos.some((repo) => repo.path === path)) {
        return
      }

      const name = path.split("/").filter(Boolean).pop() ?? "Unknown"
      const nextRepo: SelectedRepo = {
        path,
        name,
        branch: "",
        branches: [],
        loadingBranches: true,
      }

      setSelectedRepos((prev) => [...prev, nextRepo])

      const branches = await loadBranches(path)
      const defaultBranch =
        branches.find((branch) => branch === "origin/main") ??
        branches.find((branch) => branch === "origin/master") ??
        branches.find((branch) => !branch.startsWith("origin/")) ??
        branches[0] ??
        "main"

      setSelectedRepos((prev) =>
        prev.map((repo) =>
          repo.path === path
            ? {
                ...repo,
                branches,
                branch: defaultBranch,
                loadingBranches: false,
              }
            : repo
        )
      )
    },
    [loadBranches, selectedRepos]
  )

  const removeRepo = useCallback((path: string) => {
    setSelectedRepos((prev) => prev.filter((repo) => repo.path !== path))
  }, [])

  const updateBranch = useCallback((path: string, branch: string) => {
    setSelectedRepos((prev) =>
      prev.map((repo) => (repo.path === path ? { ...repo, branch } : repo))
    )
  }, [])

  const addFromRecent = useCallback(
    (project: Project) => {
      void addRepo(project.path)
    },
    [addRepo]
  )

  const handleBrowserSelect = useCallback(
    (path: string) => {
      setBrowserOpen(false)
      void addRepo(path)
    },
    [addRepo]
  )

  const handleClone = useCallback(async () => {
    if (!cloneUrl.trim() || !cloneTarget.trim()) {
      return
    }

    setCloning(true)
    try {
      await invoke("git_clone", {
        url: cloneUrl,
        target: cloneTarget,
        token: cloneToken || null,
      })
      await addRepo(cloneTarget)
      setCloneUrl("")
      setCloneTarget("")
      setCloneToken("")
      setActiveTab("recent")
    } catch (err) {
      console.error("Clone failed:", err)
    } finally {
      setCloning(false)
    }
  }, [addRepo, cloneTarget, cloneToken, cloneUrl])

  const handleCreate = useCallback(async () => {
    if (selectedRepos.length === 0) {
      return
    }

    setCreating(true)
    try {
      const workspace = await workspacesApi.create({
        repos: selectedRepos.map((repo) => ({
          path: repo.path,
          branch: repo.branch,
        })),
        agent_type: selectedAgent,
        initial_prompt: promptText.trim() || undefined,
      })

      sessionStorage.setItem("vibe-studio:workspaceId", workspace.id)
      if (promptText.trim()) {
        sessionStorage.setItem("vibe-studio:initialPrompt", promptText.trim())
      }

      router.push("/project")
    } catch (err) {
      console.error("Failed to create workspace:", err)
    } finally {
      setCreating(false)
    }
  }, [promptText, router, selectedAgent, selectedRepos])

  const handleOpenWorkspace = useCallback(
    (workspace: Workspace) => {
      sessionStorage.setItem("vibe-studio:workspaceId", workspace.id)
      router.push("/project")
    },
    [router]
  )

  const handleUpdateWorkspaceStatus = useCallback(
    async (workspaceId: string, status: WorkspaceStatus) => {
      const previous = workspaces
      const next = workspaces.map((workspace) =>
        workspace.id === workspaceId ? { ...workspace, status } : workspace
      )
      setWorkspaces(next)

      try {
        await workspacesApi.updateStatus(workspaceId, status)
      } catch (err) {
        console.error("Failed to update workspace status:", err)
        setWorkspaces(previous)
      }
    },
    [workspaces]
  )

  const handleDeleteWorkspace = useCallback(
    async (workspace: Workspace) => {
      const previous = workspaces
      setWorkspaces((current) =>
        current.filter((item) => item.id !== workspace.id)
      )

      try {
        await workspacesApi.delete(workspace.id)
        return true
      } catch (err) {
        console.error("Failed to delete workspace:", err)
        setWorkspaces(previous)
        return false
      }
    },
    [workspaces]
  )

  const handleRequestDeleteWorkspace = useCallback((workspace: Workspace) => {
    setPendingDeleteWorkspace(workspace)
  }, [])

  const handleDropToLane = useCallback(
    async (workspaceId: string, targetLane: BoardColumnKey) => {
      if (!workspaceId) {
        return
      }

      const workspace = workspaces.find((item) => item.id === workspaceId)
      setDraggingWorkspaceId(null)
      setActiveDropLane(null)

      if (!workspace) {
        return
      }

      const currentLane =
        workspace.status === "idle" ? "need_review" : workspace.status

      if (currentLane === targetLane) {
        return
      }

      await handleUpdateWorkspaceStatus(workspaceId, targetLane)
    },
    [handleUpdateWorkspaceStatus, workspaces]
  )

  const getLaneFromPoint = useCallback(
    (clientX: number, clientY: number): BoardColumnKey | null => {
      if (typeof document === "undefined") {
        return null
      }

      const lane = document
        .elementFromPoint(clientX, clientY)
        ?.closest("[data-board-lane]")
        ?.getAttribute("data-board-lane")

      if (lane === "need_review" || lane === "running" || lane === "done") {
        return lane
      }

      return null
    },
    []
  )

  const handleWorkspacePointerDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, workspace: Workspace) => {
      if (event.button !== 0) {
        return
      }

      if (
        (event.target as HTMLElement).closest("[data-delete-button='true']")
      ) {
        return
      }

      event.preventDefault()
      document.body.style.userSelect = "none"

      const rect = event.currentTarget.getBoundingClientRect()
      const nextDrag: PointerDragState = {
        workspace,
        startX: event.clientX,
        startY: event.clientY,
        currentX: event.clientX,
        currentY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        width: rect.width,
        height: rect.height,
        activated: false,
      }

      pointerDragRef.current = nextDrag
      setPointerDrag(nextDrag)
    },
    []
  )

  useEffect(() => {
    if (!pointerDrag) {
      return
    }

    const clearDragState = () => {
      pointerDragRef.current = null
      setPointerDrag(null)
      setDraggingWorkspaceId(null)
      setActiveDropLane(null)
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
    }

    const handleMouseMove = (event: MouseEvent) => {
      const current = pointerDragRef.current
      if (!current) {
        return
      }

      const movedEnough =
        Math.abs(event.clientX - current.startX) > 6 ||
        Math.abs(event.clientY - current.startY) > 6
      const activated = current.activated || movedEnough
      const nextDrag: PointerDragState = {
        ...current,
        currentX: event.clientX,
        currentY: event.clientY,
        activated,
      }

      pointerDragRef.current = nextDrag
      setPointerDrag(nextDrag)

      if (!activated) {
        return
      }

      document.body.style.userSelect = "none"
      document.body.style.cursor = "grabbing"
      setDraggingWorkspaceId(current.workspace.id)
      setActiveDropLane(getLaneFromPoint(event.clientX, event.clientY))
    }

    const handleMouseUp = (event: MouseEvent) => {
      const current = pointerDragRef.current
      if (!current) {
        return
      }

      const dropLane = current.activated
        ? getLaneFromPoint(event.clientX, event.clientY)
        : null

      clearDragState()

      if (current.activated) {
        if (dropLane) {
          void handleDropToLane(current.workspace.id, dropLane)
        }
        return
      }

      handleOpenWorkspace(current.workspace)
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)

    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
    }
  }, [
    getLaneFromPoint,
    handleDropToLane,
    handleOpenWorkspace,
    Boolean(pointerDrag),
  ])

  const filteredRecent = searchQuery
    ? recentProjects.filter(
        (project) =>
          project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          project.path.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : recentProjects

  const workspaceBuckets = useMemo(() => {
    return {
      need_review: workspaces.filter(
        (workspace) =>
          workspace.status === "need_review" || workspace.status === "idle"
      ),
      running: workspaces.filter((workspace) => workspace.status === "running"),
      done: workspaces.filter((workspace) => workspace.status === "done"),
    }
  }, [workspaces])

  const statusSummary = `${workspaces.length} workspaces · ${recentProjects.length} repos`
  const selectedAgentLabel =
    AGENT_OPTIONS.find((option) => option.value === selectedAgent)?.label ??
    "Claude Code"

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

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.14),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.12),_transparent_26%),linear-gradient(180deg,_rgba(15,23,42,0.02),_transparent_38%)] text-foreground">
      <div className="mx-auto flex min-h-screen max-w-[2200px] flex-col px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
        <header className="rounded-[20px] sm:rounded-[24px] border border-border/70 bg-background/85 p-3 sm:p-4 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.55)] backdrop-blur">
          <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1.5 sm:space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-2.5 sm:px-3 py-1 text-xs text-muted-foreground">
                <KanbanSquare className="h-3 sm:h-3.5 w-3 sm:w-3.5" />
                Workspace Board
              </div>
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
                工作区看板
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground">{statusSummary}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-medium text-white transition-colors hover:bg-orange-600"
              >
                <Plus className="h-3.5 sm:h-4 w-3.5 sm:w-4" />
                <span className="hidden sm:inline">New Workspace</span>
                <span className="sm:hidden">New</span>
              </button>
              <Link
                href="/settings"
                className="inline-flex items-center gap-2 rounded-xl border border-border px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Settings className="h-3.5 sm:h-4 w-3.5 sm:w-4" />
                <span className="hidden sm:inline">{t("settings.title")}</span>
              </Link>
            </div>
          </div>
        </header>

        {/* 关键修复点 1：将 main 变成一个可以继续向下传递高度的 flex 列容器 */}
        <main className="mt-3 sm:mt-4 flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* 关键修复点 2：将滚动容器也变为 flex 列，这样内部网格就可以使用 flex-1 完全撑满屏幕 */}
          <div className="flex-1 flex flex-col overflow-y-auto overflow-x-auto pb-2">
            
            {/* 关键修复点 3：添加 flex-1 shrink-0 强制填充父级，移除固定行高。这样列宽不仅会自适应，高度也会顶到底部 */}
            <div className="flex-1 shrink-0 grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-[repeat(auto-fit,minmax(320px,1fr))] xl:grid-cols-[repeat(auto-fit,minmax(380px,1fr))] items-stretch">
              {BOARD_COLUMNS.map((column) => {
                const meta = getStatusMeta(column.key)
                const Icon = meta.icon
                const laneWorkspaces = workspaceBuckets[column.key]
                const isActiveDropLane = activeDropLane === column.key

                return (
                  <section
                    key={column.key}
                    data-board-lane={column.key}
                    className={[
                      "flex flex-col h-full min-h-[560px] rounded-[24px] border bg-background/80 p-3 shadow-[0_18px_60px_-48px_rgba(15,23,42,0.5)] backdrop-blur",
                      "border-border/70",
                      isActiveDropLane ? "ring-2 ring-primary/30" : "",
                    ].join(" ")}
                  >
                    <div
                      className={`flex items-center gap-2 rounded-2xl border px-3 py-2 ${meta.accent}`}
                    >
                      <Icon
                        className={`h-4 w-4 ${column.key === "running" ? "animate-spin" : ""}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">
                          {column.title}
                        </div>
                      </div>
                      <div className="rounded-full bg-background/80 px-2 py-0.5 text-xs font-medium text-foreground">
                        {laneWorkspaces.length}
                      </div>
                    </div>

                    {/* 关键修复点 4：列表容器添加 min-h-0，防止卡片过多时撑破看板外框 */}
                    <div className="mt-4 flex-1 min-h-0 space-y-3 overflow-y-auto pr-1">
                      {laneWorkspaces.length === 0 ? (
                        <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                          当前列还没有工作区
                        </div>
                      ) : (
                        laneWorkspaces.map((workspace) => (
                          <WorkspaceCard
                            key={workspace.id}
                            workspace={workspace}
                            isDragging={draggingWorkspaceId === workspace.id}
                            onDelete={handleRequestDeleteWorkspace}
                            onPointerDown={handleWorkspacePointerDown}
                          />
                        ))
                      )}
                    </div>
                  </section>
                )
              })}
            </div>
          </div>
        </main>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6 backdrop-blur-sm">
          <div className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-border bg-background shadow-[0_40px_120px_-48px_rgba(15,23,42,0.65)]">
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" />
                  New Workspace
                </div>
                <h2 className="mt-3 text-2xl font-semibold">
                  选择仓库和基线分支
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  这里还是原来的创建逻辑，只是收进了弹窗里，避免首页信息分散。
                </p>
              </div>

              <button
                onClick={() => setShowCreateModal(false)}
                className="rounded-xl border border-border p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="min-h-0 overflow-y-auto border-b border-border p-6 lg:border-b-0 lg:border-r">
                <div className="rounded-3xl border border-border bg-muted/20">
                  <div className="flex border-b border-border">
                    <TabButton
                      active={activeTab === "recent"}
                      onClick={() => setActiveTab("recent")}
                      icon={<Clock className="h-3.5 w-3.5" />}
                      label="最近"
                    />
                    <TabButton
                      active={activeTab === "browse"}
                      onClick={() => setActiveTab("browse")}
                      icon={<Search className="h-3.5 w-3.5" />}
                      label="浏览"
                    />
                    <TabButton
                      active={activeTab === "create"}
                      onClick={() => setActiveTab("create")}
                      icon={<Plus className="h-3.5 w-3.5" />}
                      label="克隆"
                    />
                  </div>

                  <div className="p-4">
                    {activeTab === "recent" && (
                      <div>
                        {recentProjects.length === 0 ? (
                          <p className="py-8 text-center text-sm text-muted-foreground">
                            还没有最近的项目
                          </p>
                        ) : (
                          <>
                            <div className="mb-3">
                              <input
                                type="text"
                                value={searchQuery}
                                onChange={(event) =>
                                  setSearchQuery(event.target.value)
                                }
                                placeholder="搜索项目..."
                                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                              />
                            </div>
                            <div className="max-h-[420px] space-y-1 overflow-y-auto">
                              {filteredRecent.map((project) => {
                                const isSelected = selectedRepos.some(
                                  (repo) => repo.path === project.path
                                )

                                return (
                                  <button
                                    key={project.id}
                                    onClick={() => addFromRecent(project)}
                                    disabled={isSelected}
                                    className="flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-3 text-left transition-colors hover:border-border hover:bg-background disabled:opacity-50"
                                  >
                                    <FolderGit2 className="h-4 w-4 shrink-0 text-blue-500" />
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-medium">
                                        {project.name}
                                      </p>
                                      <p className="truncate text-xs text-muted-foreground">
                                        {project.path}
                                      </p>
                                    </div>
                                    {isSelected && (
                                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-400">
                                        已选
                                      </span>
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {activeTab === "browse" && (
                      <div className="flex flex-col items-center gap-4 py-10">
                        <p className="text-sm text-muted-foreground">
                          浏览文件系统，选择包含 `.git` 的项目目录
                        </p>
                        <button
                          onClick={() => setBrowserOpen(true)}
                          className="flex items-center gap-2 rounded-xl border border-input px-4 py-2.5 text-sm hover:bg-accent"
                        >
                          <Search className="h-4 w-4" />
                          打开文件浏览器
                        </button>
                      </div>
                    )}

                    {activeTab === "create" && (
                      <div className="space-y-4">
                        <div>
                          <label className="text-sm font-medium">
                            仓库 URL
                          </label>
                          <input
                            type="text"
                            value={cloneUrl}
                            onChange={(event) =>
                              setCloneUrl(event.target.value)
                            }
                            placeholder="https://github.com/user/repo.git"
                            className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium">
                            本地路径
                          </label>
                          <input
                            type="text"
                            value={cloneTarget}
                            onChange={(event) =>
                              setCloneTarget(event.target.value)
                            }
                            placeholder="/Users/you/projects/repo"
                            className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium">
                            Token{" "}
                            <span className="text-muted-foreground">
                              (可选)
                            </span>
                          </label>
                          <input
                            type="password"
                            value={cloneToken}
                            onChange={(event) =>
                              setCloneToken(event.target.value)
                            }
                            placeholder="ghp_xxxx"
                            className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                          />
                        </div>
                        <button
                          onClick={() => {
                            void handleClone()
                          }}
                          disabled={
                            cloning || !cloneUrl.trim() || !cloneTarget.trim()
                          }
                          className="rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                        >
                          {cloning ? "克隆中..." : "克隆并添加"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="min-h-0 overflow-y-auto p-6">
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">创建清单</h3>
                      <p className="text-sm text-muted-foreground">
                        这里选择每个仓库创建工作区时的基线分支。
                      </p>
                    </div>

                    <div className="relative">
                      <button
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          setAgentMenuOpen((current) => !current)
                        }}
                        className="inline-flex items-center gap-2 rounded-xl border border-border bg-muted/15 px-3 py-2 text-sm transition-colors hover:bg-accent"
                      >
                        <Bot className="h-4 w-4 text-muted-foreground" />
                        <span className="max-w-[140px] truncate">
                          {selectedAgentLabel}
                        </span>
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>

                      {agentMenuOpen && (
                        <div
                          onMouseDown={(event) => event.stopPropagation()}
                          className="absolute right-0 top-full z-50 mt-2 min-w-[190px] overflow-hidden rounded-2xl border border-border bg-popover p-1 shadow-[0_20px_60px_-36px_rgba(15,23,42,0.55)]"
                        >
                          {AGENT_OPTIONS.map((option) => (
                            <button
                              key={option.value}
                              onClick={() => {
                                setSelectedAgent(option.value)
                                setAgentMenuOpen(false)
                              }}
                              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition-colors ${
                                selectedAgent === option.value
                                  ? "bg-accent text-foreground"
                                  : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
                              }`}
                            >
                              <span>{option.label}</span>
                              {selectedAgent === option.value && (
                                <span className="text-[11px] text-muted-foreground">
                                  当前
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    {selectedRepos.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
                        先从左侧选择至少一个仓库。
                      </div>
                    ) : (
                      selectedRepos.map((repo) => (
                        <div
                          key={repo.path}
                          className="rounded-2xl border border-border bg-muted/20 p-4"
                        >
                          <div className="flex items-start gap-3">
                            <FolderGit2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {repo.name}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {repo.path}
                              </p>
                            </div>
                            <button
                              onClick={() => removeRepo(repo.path)}
                              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          <div className="mt-3">
                            <div className="mb-1 text-xs font-medium text-muted-foreground">
                              目标基线分支
                            </div>
                            <BranchDropdown
                              branches={repo.branches}
                              currentBranch={repo.branch}
                              loading={repo.loadingBranches}
                              onChange={(branch) =>
                                updateBranch(repo.path, branch)
                              }
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="rounded-2xl border border-border bg-muted/20 p-4">
                    <label className="text-sm font-medium">任务说明</label>
                    <textarea
                      value={promptText}
                      onChange={(event) => setPromptText(event.target.value)}
                      placeholder="描述你想要完成的任务...（可选，也可以进入工作区后再输入）"
                      rows={5}
                      className="mt-2 w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm [overflow-wrap:anywhere]"
                    />
                  </div>

                  <button
                    onClick={() => {
                      void handleCreate()
                    }}
                    disabled={creating || selectedRepos.length === 0}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
                  >
                    {creating ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        创建中...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4" />
                        创建工作区
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingDeleteWorkspace && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[24px] border border-border bg-background p-5 shadow-[0_32px_100px_-48px_rgba(15,23,42,0.7)]">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-red-500/10 p-2 text-red-600 dark:text-red-400">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold">删除工作区</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  删除后不会出现在看板中。确认删除
                  <span className="mx-1 font-medium text-foreground">
                    {pendingDeleteWorkspace.title ??
                      pendingDeleteWorkspace.initial_prompt?.slice(0, 32) ??
                      "未命名工作区"}
                  </span>
                  吗？
                </p>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setPendingDeleteWorkspace(null)}
                className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-accent"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const workspace = pendingDeleteWorkspace
                  setPendingDeleteWorkspace(null)
                  if (workspace) {
                    void handleDeleteWorkspace(workspace)
                  }
                }}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      <FileBrowser
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
        onSelect={handleBrowserSelect}
      />

      {pointerDrag?.activated && (
        <div
          className="pointer-events-none fixed z-[55] overflow-hidden rounded-[20px] border border-orange-500/30 bg-background/95 px-4 py-3 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.7)]"
          style={{
            width: pointerDrag.width,
            height: pointerDrag.height,
            left: pointerDrag.currentX - pointerDrag.offsetX,
            top: pointerDrag.currentY - pointerDrag.offsetY,
          }}
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 text-muted-foreground">
              <GripVertical className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {pointerDrag.workspace.title ??
                  pointerDrag.workspace.initial_prompt?.slice(0, 80) ??
                  "未命名工作区"}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {pointerDrag.workspace.repos
                  .map((repo) => repo.name)
                  .join(", ")}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function WorkspaceCard({
  workspace,
  isDragging,
  onDelete,
  onPointerDown,
}: {
  workspace: Workspace
  isDragging: boolean
  onDelete: (workspace: Workspace) => void
  onPointerDown: (
    event: React.MouseEvent<HTMLDivElement>,
    workspace: Workspace
  ) => void
}) {
  return (
    <div
      onMouseDown={(event) => onPointerDown(event, workspace)}
      className={[
        "select-none cursor-grab rounded-[20px] border border-border bg-background px-4 py-3 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.28)] transition-transform active:cursor-grabbing",
        isDragging ? "scale-[0.98] opacity-60" : "hover:-translate-y-0.5",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-muted-foreground">
          <GripVertical className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-semibold">
            {workspace.title ??
              workspace.initial_prompt?.slice(0, 80) ??
              "未命名工作区"}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {workspace.repos.map((repo) => repo.name).join(", ")}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            更新于 {formatRelativeTime(workspace.updated_at)}
          </p>
        </div>

        <button
          data-delete-button="true"
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onDelete(workspace)
          }}
          draggable={false}
          className="rounded-xl border border-transparent p-2 text-muted-foreground transition-colors hover:border-red-500/20 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
          title="删除工作区"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function formatRelativeTime(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return "刚刚"
    if (diffMin < 60) return `${diffMin} 分钟前`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr} 小时前`
    const diffDay = Math.floor(diffHr / 24)
    if (diffDay < 30) return `${diffDay} 天前`
    return date.toLocaleDateString()
  } catch {
    return dateStr
  }
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function BranchDropdown({
  branches,
  currentBranch,
  loading,
  onChange,
}: {
  branches: string[]
  currentBranch: string
  loading: boolean
  onChange: (branch: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const filteredBranches = search
    ? branches.filter((branch) =>
        branch.toLowerCase().includes(search.toLowerCase())
      )
    : branches

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((current) => !current)}
        disabled={loading}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-input bg-background px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <GitBranch className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{loading ? "..." : currentBranch}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-full rounded-2xl border border-border bg-popover p-2 shadow-lg">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="选择分支..."
            className="mb-2 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs"
            autoFocus
          />

          <div className="max-h-56 overflow-y-auto">
            {filteredBranches.map((branch) => (
              <button
                key={branch}
                onClick={() => {
                  onChange(branch)
                  setOpen(false)
                  setSearch("")
                }}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs hover:bg-accent ${
                  branch === currentBranch ? "bg-accent/60" : ""
                }`}
              >
                <GitBranch className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{branch}</span>
              </button>
            ))}

            {filteredBranches.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                没有匹配的分支
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}