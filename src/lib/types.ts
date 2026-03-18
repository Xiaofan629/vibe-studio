// ============================================================
// Vibe Studio - 核心类型定义
// ============================================================

// --- Project ---
export interface Project {
  id: string
  name: string
  path: string
  remoteUrl: string | null
  remoteType: "github" | "gitlab" | null
  defaultBranch: string
  defaultAgent: AgentType | null
  lastOpenedAt: string
  createdAt: string
  updatedAt: string
}

// --- Git ---
export interface GitBranch {
  name: string
  isRemote: boolean
  isCurrent: boolean
  lastCommitSha: string | null
  lastCommitMessage: string | null
}

export interface DiffFile {
  oldPath: string | null
  newPath: string | null
  changeKind: "added" | "modified" | "deleted" | "renamed"
  additions: number
  deletions: number
  hunks: DiffHunk[]
  isBinary: boolean
  contentOmitted: boolean
}

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  header: string
  lines: DiffLine[]
}

export interface DiffLine {
  content: string
  kind: "context" | "addition" | "deletion"
  oldLineNumber: number | null
  newLineNumber: number | null
}

// --- Session ---
export type SessionStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "killed"

export interface Session {
  id: string
  project_id: string
  branch: string
  worktree_path: string | null
  agent_type: AgentType
  title: string | null
  status: SessionStatus
  workspace_id: string | null
  created_at: string
  updated_at: string
}

export interface SessionWithLogs extends Session {
  logs: PersistedLogEntry[]
  userPrompt: string | null
}

export interface PersistedLogEntry {
  id: string
  processId: string
  entryType: AgentLogEntryType
  content: string
  toolName: string | null
  filePath: string | null
  sequence: number
  createdAt: string
}

export interface CreateSessionRequest {
  project_id: string
  branch: string
  agent_type: AgentType
  title?: string
  workspace_id?: string
}

// --- Workspace ---
export type WorkspaceStatus = "idle" | "running" | "need_review" | "done"

export interface WorkspaceRepo {
  id: string
  workspace_id: string
  project_id: string
  path: string
  name: string
  branch: string
  base_branch?: string | null
  worktree_path: string | null
  base_commit: string | null
}

export interface Workspace {
  id: string
  title: string | null
  status: WorkspaceStatus
  agent_type: AgentType
  initial_prompt: string | null
  repos: WorkspaceRepo[]
  created_at: string
  updated_at: string
}

export interface CreateWorkspaceRepo {
  path: string
  branch: string
  use_local_project?: boolean
}

export interface CreateWorkspaceRequest {
  repos: CreateWorkspaceRepo[]
  agent_type: AgentType
  initial_prompt?: string
  title?: string
}

// --- Agent ---
export type AgentType = "claude_code" | "gemini" | "codex"

export type ClaudePermissionMode =
  | "default"
  | "plan"
  | "acceptEdits"
  | "dontAsk"

export type AgentProcessStatus = "running" | "completed" | "failed" | "killed"

export interface AgentProcess {
  id: string
  sessionId: string
  parentId: string | null
  agentType: AgentType
  status: AgentProcessStatus
  prompt: string | null
  depth: number
  startedAt: string
  completedAt: string | null
}

export type AgentLogEntryType =
  | "text"
  | "tool_call"
  | "tool_result"
  | "thinking"
  | "error"
  | "file_op"

export interface AgentLogEntry {
  id: number
  processId: string
  entryType: AgentLogEntryType
  content: string
  toolName: string | null
  filePath: string | null
  timestamp: string
  sequence: number
}

// --- Multi-Agent ---
export interface AgentNode {
  id: string
  parentId: string | null
  agentType: AgentType
  status: AgentProcessStatus
  prompt: string | null
  depth: number
  startedAt: string
  completedAt: string | null
  children: AgentNode[]
}

export interface TimelineEntry {
  id: string
  label: string
  startTime: number
  endTime: number | null
  status: AgentProcessStatus
  depth: number
  parentId: string | null
}

// --- Review ---
export interface ReviewComment {
  id: string
  sessionId: string
  filePath: string
  lineNumber: number
  side: "old" | "new"
  content: string
  codeLine: string | null
  isResolved: boolean
  sentToAgent: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateReviewComment {
  sessionId: string
  filePath: string
  lineNumber: number
  side: "old" | "new"
  content: string
  codeLine: string | null
  sentToAgent?: boolean
}

// --- Commit ---
export interface CommitMessage {
  title: string
  body: string
  filesChanged: number
  additions: number
  deletions: number
}

export interface CommitResult {
  sha: string
  branch: string
  message: string
}

export interface CommitHistoryEntry {
  sha: string
  shortSha: string
  summary: string
  committedAt: string
  index: number
}

export interface PrResult {
  url: string
  number: number
  title: string
}

export interface PrInfo {
  number: number
  url: string
  status: "open" | "merged" | "closed"
}

export interface CreatePrRequest {
  title: string
  body: string | null
  baseBranch: string | null
  draft: boolean
  autoGenerateDescription: boolean
}

// --- Agent Discovery ---
export interface AgentInfo {
  agentType: AgentType
  name: string
  available: boolean
  version: string | null
  path: string | null
}

// --- Claude Session History ---
export interface ClaudeSession {
  id: string
  project_path: string
  messages: ClaudeMessage[]
}

export interface ClaudeMessage {
  role: string
  content: string
  timestamp: string
}

// --- Claude Full Session (完整解析) ---
export interface ConversationDetail {
  summary: ConversationSummary
  turns: MessageTurn[]
  sessionStats: SessionStats | null
}

export interface ConversationSummary {
  id: string
  folderPath: string | null
  folderName: string | null
  title: string | null
  startedAt: string
  endedAt: string | null
  messageCount: number
  model: string | null
  gitBranch: string | null
}

export interface MessageTurn {
  id: string
  role: "user" | "assistant" | "system"
  blocks: ContentBlock[]
  timestamp: string
  usage: TurnUsage | null
  durationMs: number | null
  model: string | null
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "tool_use"
      toolUseId: string | null
      toolName: string
      inputPreview: string | null
    }
  | {
      type: "tool_result"
      toolUseId: string | null
      outputPreview: string | null
      isError: boolean
    }
  | { type: "image"; data: string; mimeType: string; uri: string | null }

export interface TurnUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
}

export interface SessionStats {
  model: string | null
  totalUsage: TurnUsage | null
  totalTokens: number | null
  totalDurationMs: number
  contextWindowUsedTokens: number | null
  contextWindowMaxTokens: number | null
  contextWindowUsagePercent: number | null
}

// --- File Picker & Slash Commands ---
export interface SavedImage {
  path: string
  relative_path: string
}

export interface FileEntry {
  name: string
  path: string
  is_directory: boolean
  extension: string | null
  size: number | null
}

export interface SlashCommand {
  id: string
  name: string
  full_command: string
  description: string | null
  content: string | null
  namespace: string | null
  scope: "project" | "global" | null
  has_bash_commands: boolean
  has_file_references: boolean
  accepts_arguments: boolean
}
