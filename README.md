[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB)](https://tauri.app/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)

<p align="center">
  <img src="https://raw.githubusercontent.com/Xiaofan629/my-image-host/refs/heads/main/vibe-studio-icon.png?raw=true" alt="Vibe Studio Logo" width="120" />
</p>

# Vibe Studio

Vibe Studio 是一个面向本地代码仓库的桌面 AI 开发工作台。它把项目选择、Git 工作区、AI Agent 对话、代码评审、提交与 PR 流程整合到一个 Tauri 桌面应用里，适合想把 Claude Code、Codex、Gemini CLI 和本地仓库协作体验做得更顺手的开发者。

这是一个本地优先、强调真实仓库操作的开源项目。你不是在一个"玩具聊天框"里生成代码，而是在真实 Git 仓库、真实 worktree、真实终端和真实提交流里完成开发。

## 产品截图

![首页工作区看板](https://raw.githubusercontent.com/Xiaofan629/my-image-host/refs/heads/main/hero-home.png?raw=true)

### 创建工作区

![创建工作区](https://raw.githubusercontent.com/Xiaofan629/my-image-host/refs/heads/main/a2f2e61a0b382a543c95653b13b3b621.png?raw=true)

### AI 对话与代码评审

| AI 对话页面 | 代码评审面板 |
| --- | --- |
| ![AI 对话](https://raw.githubusercontent.com/Xiaofan629/my-image-host/refs/heads/main/14d4394e62683ec25c644b9af8b0a2a9.png?raw=true) | ![代码评审](https://raw.githubusercontent.com/Xiaofan629/my-image-host/refs/heads/main/743af436f37c3a6c1f0731eeeabbc600.png) |

### 提交流程与 PR 创建

| 提交改动页面 | 创建 PR |
| --- | --- |
| ![提交改动](https://raw.githubusercontent.com/Xiaofan629/my-image-host/refs/heads/main/0dca46e96b4ff067a1d4f2bd2d66453f.png?raw=true) | ![创建 PR](https://raw.githubusercontent.com/Xiaofan629/my-image-host/refs/heads/main/a9d46df56fcc43b166fa3a71e750d9d2.png?raw=true) |

### 远端评论导入

| GitHub 评论 | 导入到本地 |
| --- | --- |
| ![GitHub 评论](https://raw.githubusercontent.com/Xiaofan629/my-image-host/refs/heads/main/5d62e61575536a35a68c00f7f456eec2.png?raw=true) | ![导入评论](https://raw.githubusercontent.com/Xiaofan629/my-image-host/refs/heads/main/f277a0b1480fd0b24120eb1008a97ce4.png?raw=true) |

### 内置终端

![终端页面](https://raw.githubusercontent.com/Xiaofan629/my-image-host/refs/heads/main/a940bdf4816e89291f0790c77b4a9498.png?raw=true)


## 项目亮点

- 一个应用里统一管理本地项目、工作区、Agent 会话、Diff、评审、提交和 PR。
- 支持多仓库工作区，为同一任务同时挂载多个 Git 仓库。
- 自动创建 Git worktree，避免直接污染主分支工作目录。
- 支持 Claude Code、Gemini CLI、Codex 的本地发现与接入。
- 支持结构化 Diff、行级评审评论、远端 PR 评论导入。
- 支持 AI 生成提交信息、PR 标题与描述，并串联 push / PR 创建流程。
- 内置终端与外部编辑器联动，适合边聊边改边验证。
- 数据默认保存在本机 SQLite，项目和会话管理都是本地完成。

## 当前已实现的能力

### 1. 项目与工作区管理

- 浏览本机目录并识别 Git 仓库。
- 将本地仓库加入最近项目列表。
- 通过 URL 克隆仓库，支持附带 token。
- 从一个或多个仓库创建工作区。
- 为每个工作区记录状态流转：`Todo / Doing / Done`。
- 在首页看板里拖拽整理工作区状态。
- 自动为工作区创建独立 worktree 与任务分支。

### 2. AI Agent 协作

- 自动发现本机可用 Agent CLI。
- 已接入 `Claude Code`、`Gemini CLI`、`Codex`。
- 主工作区会话体验当前重点打磨 `Claude Code` 与 `Codex`。
- 支持流式输出，展示文本、思考片段、工具调用、工具结果等日志类型。
- 支持多轮对话续接，保留当前会话上下文。
- 提供多 Agent 数据结构与事件流，支持树状、面板、时间线视图。
- 支持读取 Claude 本地会话历史，并解析完整会话详情与统计信息。

### 3. Diff 与代码评审

- 获取结构化 Diff 摘要与完整 Diff。
- 支持原始 patch、按 revision 对比、双 revision 对比。
- 支持查看文件前后内容。
- 支持行级评审评论的创建、修改、解决与删除。
- 支持构建“评审上下文”并回灌给 Agent。
- 支持从 GitHub / GitLab 的远端 PR / MR 拉取评论并导入到本地评审流。

### 4. 提交与 PR 流程

- 支持全量提交。
- 支持按文件、按 hunk 选择性提交。
- 支持基于当前改动让 Agent 自动生成 commit title / body。
- 支持基于选中 patch 单独生成提交说明。
- 支持 push 当前分支。
- 支持自动生成 PR / MR 标题与描述。
- 支持创建 PR / MR、读取 PR 状态、更新 PR 描述。

### 5. 终端与编辑器联动

- 内置 PTY 终端，支持创建、写入、缩放、关闭、切换目录。
- 工作区页可以直接启动与 Agent 相关的终端命令。
- 支持一键用 `VSCode`、`Cursor`、`Trae` 打开当前目录。

### 6. 桌面应用体验

- 基于 Tauri 2，运行轻量，适合本地开发工具形态。
- 支持浅色 / 深色 / 跟随系统主题。
- 使用 Next.js 16 静态导出模式，前端与桌面壳层解耦。
- 支持中英文国际化基础设施。

## 适合谁

- 想把本地 AI 编程 CLI 工具整合进统一工作流的开发者。
- 同时管理多个仓库、多个任务分支、多个 worktree 的个人开发者或小团队。
- 希望把“聊天、看 Diff、提评论、写提交、开 PR”串成闭环的人。
- 希望做本地优先 AI IDE / AI coding workspace 的开源贡献者。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面容器 | Tauri 2 |
| 前端 | Next.js 16 + React 19 + TypeScript 5 |
| UI | Tailwind CSS 4 + Radix UI + shadcn/ui |
| 状态管理 | Zustand 5 |
| 后端 | Rust 2021 + Tokio |
| 数据库 | SeaORM 1.1 + SQLite |
| Diff / 渲染 | Monaco Editor + Shiki + `@pierre/diffs` |
| 终端 | xterm.js |
| 国际化 | next-intl |

## 快速开始

### 环境要求

- Node.js 20+
- pnpm 9+
- Rust stable
- Tauri 2 对应系统依赖
- 至少一个本地 Agent CLI：`claude` / `codex` / `gemini`

可选但推荐：

- `gh`：GitHub PR 能力
- `glab`：GitLab MR 能力
- `code` / `cursor` / `trae`：外部编辑器联动

### 安装依赖

```bash
pnpm install
```

### 启动前端开发

```bash
pnpm dev
```

### 启动桌面开发模式

```bash
pnpm tauri dev
```

### 构建

```bash
pnpm build
pnpm tauri build
```

### 代码检查

```bash
pnpm lint

cd src-tauri
cargo check --workspace
cargo test --workspace
cargo clippy --workspace
```

## 项目结构

```text
vibe-studio/
├── docs/
│   └── screenshots/         # README 宣传截图目录
├── src/
│   ├── app/                  # 首页、工作区页、设置页
│   ├── components/           # Agent、Diff、Review、Commit、PR、Terminal 等组件
│   ├── hooks/                # 前端能力封装
│   ├── stores/               # Zustand 状态管理
│   └── lib/                  # 类型定义、Tauri 调用封装、工具函数
├── src-tauri/
│   ├── src/                  # Tauri 启动入口
│   └── crates/
│       ├── agent/            # Agent 发现、启动、输出解析
│       ├── commands/         # Tauri IPC 命令
│       ├── db/               # SeaORM 实体与迁移
│       ├── git/              # Git / PR / Diff / worktree 能力
│       ├── review/           # 评论与评审上下文
│       └── terminal/         # PTY 终端管理
├── README.md
├── CLAUDE.md
└── package.json
```

## 数据与本地目录

应用数据默认保存在 Tauri 的 `app_data_dir` 中。

- 数据库文件：`vibe-studio.db`
- 工作区 worktree 目录：`worktrees/<workspace-id>/`

macOS 下默认路径通常是：

```text
~/Library/Application Support/app.vibe-studio/
```

当前业务表包括：

- `project`
- `workspace`
- `workspace_repo`
- `session`
- `agent_process`
- `review_comment`
- `commit_history`

## 已知实现约束

- 前端采用静态导出模式，不使用 Next.js API Routes。
- Tauri 命令参数需要注意前端 `camelCase` 与 Rust `snake_case` 的映射。
- PR / MR 相关能力依赖仓库 remote 类型以及本机 `gh` / `glab` CLI。
- 外部编辑器打开能力依赖对应命令存在于系统 PATH。

## 开源协作

这个项目适合围绕以下方向继续演进：

- 多 Agent 编排体验和可视化继续打磨。
- 更强的工作区总览和任务流。
- 更细粒度的评审回灌策略。
- 更完整的提交、PR、远端评论闭环。
- 更好的终端与编辑器协同体验。

欢迎提 Issue、提 PR、提设计建议，也欢迎直接基于它做你自己的本地 AI 开发工作台。

## 许可证

MIT
