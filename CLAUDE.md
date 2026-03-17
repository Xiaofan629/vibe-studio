# Vibe Studio 项目指引

本文件用于帮助 Claude Code 或其他协作型编码 Agent 快速理解当前项目的真实结构、边界和开发约定。以当前仓库代码为准，不要沿用旧版设计文档或假设中的目录结构。

## 一句话概览

Vibe Studio 是一个基于 Tauri 2 + Next.js 16 + Rust 的本地优先桌面 AI 开发工作台，围绕 Git 仓库、工作区、Agent 会话、Diff、评审、提交和 PR 流程展开。

## 当前真实能力

- 首页支持最近项目、目录浏览、仓库克隆、工作区创建与看板管理。
- 工作区支持多仓库挂载，并自动创建 Git worktree。
- 后端已接入 `Claude Code`、`Gemini CLI`、`Codex` 的发现与启动。
- 支持流式 Agent 输出、评审上下文构建、远端 PR 评论导入、提交与 PR 内容生成。
- 支持内置 PTY 终端，以及 `VSCode`、`Cursor`、`Trae` 外部编辑器联动。

## 技术栈

- 桌面：Tauri 2
- 前端：Next.js 16 + React 19 + TypeScript 5.8
- 样式：Tailwind CSS 4 + Radix UI + shadcn/ui
- 状态管理：Zustand 5
- 后端：Rust 2021 + Tokio
- 数据库：SeaORM 1.1 + SQLite
- 终端：xterm.js

## 常用命令

```bash
# 前端开发
pnpm dev

# 桌面开发
pnpm tauri dev

# 构建
pnpm build
pnpm tauri build

# 前端检查
pnpm lint

# Rust 检查（在 src-tauri/ 下）
cargo check --workspace
cargo test --workspace
cargo clippy --workspace
```

## 目录结构

```text
src/
├── app/
│   ├── page.tsx                    # 首页：项目、工作区、克隆、看板
│   ├── project/page.tsx            # 主工作区页：聊天、评审、终端
│   └── settings/                   # 设置页
├── components/
│   ├── agent/                      # 聊天、输出、思考、工具调用、评审上下文提示
│   ├── commit/                     # 提交流程与选择性提交
│   ├── diff/                       # Diff 文件树、工具栏、统计与渲染
│   ├── multi-agent/                # 树状 / 面板 / 时间线视图
│   ├── pr/                         # PR 状态徽标、创建 PR 对话框
│   ├── project/                    # 分支选择、项目列表、克隆弹窗
│   ├── review/                     # 评论编辑、行内评论、远端评论导入
│   ├── terminal/                   # 内置终端
│   └── workspace/                  # 仓库目录浏览
├── hooks/                          # useAgent / useGit / useReview / useCommit ...
├── stores/                         # Agent、Review、Project、Diff、多 Agent 状态
└── lib/                            # types、tauri invoke/listen、utils

src-tauri/
├── src/lib.rs                      # Tauri builder 与命令注册
└── crates/
    ├── agent/                      # Agent 发现、适配、输出解析、会话读取
    ├── commands/                   # Tauri IPC 命令入口
    ├── db/                         # SeaORM 实体与迁移
    ├── git/                        # Git、Diff、worktree、PR/MR
    ├── review/                     # 评论 CRUD 与评审上下文
    └── terminal/                   # PTY 终端管理
```

## 前端页面说明

### `src/app/page.tsx`

- 最近项目列表
- 本地目录浏览并识别 Git 仓库
- 通过 URL 克隆仓库
- 选择多个仓库和分支创建工作区
- 首页工作区看板：`need_review` / `running` / `done`
- 默认 Agent 选择入口

### `src/app/project/page.tsx`

- 工作区侧栏与仓库切换
- 聊天、评审、终端三大主 tab
- 分支信息、PR 状态、提交流程、创建 PR 流程
- 评审上下文预览
- 外部编辑器打开

## Tauri 命令分层

命令注册在 [src-tauri/src/lib.rs](src-tauri/src/lib.rs)，主要分为：

- 项目：`list_projects`、`add_local_project`、`delete_project`、`list_directory`
- 工作区：`create_workspace`、`list_workspaces`、`get_workspace`、`update_workspace_status`
- 会话：`create_session`、`list_sessions`、`list_sessions_by_workspace`
- Agent：`discover_agents`、`start_agent`、`stop_agent`、`is_agent_running`
- Git：分支、Diff、提交、push、PR/MR、远端评论拉取
- Review：评论 CRUD、未解决评论、评审上下文
- Terminal：创建、写入、缩放、关闭、切目录
- Editor：`open_in_editor`

## 关键数据模型

前端类型集中在 [src/lib/types.ts](src/lib/types.ts)。

核心实体：

- `Project`
- `Workspace`
- `WorkspaceRepo`
- `Session`
- `AgentProcess`
- `ReviewComment`
- `PrInfo`
- `ConversationDetail`

数据库表位于 `src-tauri/crates/db/src/entities/`：

- `project`
- `workspace`
- `workspace_repo`
- `session`
- `agent_process`
- `review_comment`
- `commit_history`

## 数据库存储位置

数据库由 `DbService::new()` 初始化，路径来自 Tauri `app_data_dir()`。

- 数据库文件：`vibe-studio.db`
- macOS 默认目录：`~/Library/Application Support/app.vibe-studio/`
- 工作区 worktree：`~/Library/Application Support/app.vibe-studio/worktrees/<workspace-id>/`

相关实现见 [src-tauri/crates/db/src/lib.rs](src-tauri/crates/db/src/lib.rs)。

## Git / PR / MR 依赖

- 仓库克隆、分支、Diff、worktree 依赖本机 `git`
- GitHub PR 能力依赖 `gh`
- GitLab MR 能力依赖 `glab`
- 远端评论导入通过 `git_get_remote_review_bundle` 获取

PR/MR 相关实现见 [src-tauri/crates/git/src/pr.rs](src-tauri/crates/git/src/pr.rs)。

## Agent 相关约定

- Agent 发现来自 `discover_agents()`
- 启动入口是 `start_agent`
- 输出通过 Tauri 事件 `agent:output` 推给前端
- 完成信号通过 `agent:finished`
- 多 Agent 视图依赖 `multi-agent:update`
- Claude 本地历史读取逻辑在 `claude_session_reader.rs` 与 `claude_history.rs`

前端封装见：

- [src/hooks/useAgent.ts](src/hooks/useAgent.ts)
- [src/lib/tauri.ts](src/lib/tauri.ts)

## 工作区创建与会话初始化流程

### 首页创建工作区

**文件：** [src/app/page.tsx:322-349](src/app/page.tsx#L322-L349)

1. 用户选择仓库、分支、Agent 和初始提示词
2. 调用 `workspacesApi.create()` 创建工作区
3. 将 `workspaceId` 和 `initialPrompt` 存入 sessionStorage
4. 跳转到 `/project` 页面

### 工作区页面初始化

**文件：** [src/app/project/page.tsx:170-244](src/app/project/page.tsx#L170-L244)

1. 页面挂载时从 sessionStorage 读取 `workspaceId` 和 `initialPrompt`
2. 调用 `workspacesApi.get(workspaceId)` 获取工作区详情
3. **关键修复：在工作区数据加载成功后立即创建会话**
   - 检查是否有现有的匹配会话
   - 如果没有，立即调用 `createSession` 创建新会话
   - 避免依赖 useEffect 的时序问题

4. **会话切换逻辑** ([src/app/project/page.tsx:247-337](src/app/project/page.tsx#L247-L337))
   - 使用 `prevActiveRepoRef` 跟踪上一个活跃仓库
   - 只在 active repo 真正变化时才重新执行会话逻辑
   - 避免不必要的会话重新加载

### 初始提示词自动发送

**文件：** [src/components/agent/AgentChat.tsx:426-452](src/components/agent/AgentChat.tsx#L426-L452)

1. 从 props 接收 `initialPrompt`（由工作区页面通过 `chatInitialPrompt` 传递）
2. 检查发送条件：
   - `initialPrompt` 存在
   - 未发送过（`!initialPromptSentRef.current`）
   - Agent 未运行（`status !== "running"`）
   - 会话已加载（`activeSessionId` 存在）
   - 会话没有现有用户消息（避免重复发送）
3. 满足条件时自动调用 `handleSend(initialPrompt)`

## 错误处理组件

### PR 创建对话框

**文件：** [src/components/pr/CreatePRDialog.tsx:293-313](src/components/pr/CreatePRDialog.tsx#L293-L313)

- 错误信息限制为 2 行显示（`line-clamp-2`）
- 右侧提供复制按钮，一键复制完整错误到剪贴板
- 复制后显示"已复制"状态，2 秒后恢复

### 提交流程对话框

**文件：** [src/components/commit/CommitFlowDialog.tsx:734-754](src/components/commit/CommitFlowDialog.tsx#L734-L754)

- 同样的错误显示和复制逻辑
- 适用于 GitHub Push Protection 等长错误信息场景

## 代码修改时的注意事项

- 前端是静态导出模式，不要引入 Next.js API Routes 依赖。
- 客户端组件必须保留 `"use client"`。
- Tauri 命令参数会经历前端 `camelCase` 到 Rust `snake_case` 的映射，改名时要两边一起检查。
- 文档、结构说明、功能描述必须基于当前代码，不要照搬旧 README 中未实现的目录。
- 如果新增命令，通常需要同时更新：
  - `src-tauri/crates/commands/src/*.rs`
  - `src-tauri/src/lib.rs`
  - `src/lib/tauri.ts`
  - `src/lib/types.ts`
  - 对应 hook / store / 组件

## 前端协作建议

- 工作流相关状态优先放 Zustand store，而不是层层 props 传递。
- 与后端交互优先走 `src/lib/tauri.ts` 和 hooks，不要在组件里散落 `invoke()` 细节。
- Diff、Review、Commit、PR 是一条连续链路，改动其中一处时要检查上下游是否仍兼容。
- **工作区初始化与会话创建有严格的时序依赖，修改时需特别注意 React effect 的执行顺序**

## 真正需要先验证的地方

以下改动最容易引发联动问题，提交前建议优先验证：

- 工作区创建与会话初始化流程（**高频问题区域**）
- Agent 启动、续聊、结束状态回写
- 初始提示词自动发送逻辑
- Review 评论加载与评审上下文构建
- 选择性提交 patch 的生成和提交
- PR/MR 获取、创建、远端评论导入
- 终端创建与目录切换
- 错误信息显示与复制功能

## 文档维护原则

- README 偏对外介绍、开源宣传、功能总览。
- CLAUDE.md 偏内部协作、架构理解、开发注意事项。
- 两份文档都使用中文，并且只描述仓库中已经存在或明确落地的能力。
- 文档更新时需同步检查代码实现，确保描述与实际一致。