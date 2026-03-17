use sea_orm::prelude::*;
use sea_orm::*;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use vibe_studio_db::entities::{agent_process, session};

use crate::AppState;

#[derive(Serialize)]
pub struct SessionInfo {
    pub id: String,
    pub project_id: String,
    pub branch: String,
    pub worktree_path: Option<String>,
    pub agent_type: String,
    pub title: Option<String>,
    pub status: String,
    pub workspace_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl From<session::Model> for SessionInfo {
    fn from(m: session::Model) -> Self {
        Self {
            id: m.id,
            project_id: m.project_id,
            branch: m.branch,
            worktree_path: m.worktree_path,
            agent_type: m.agent_type,
            title: m.title,
            status: m.status,
            workspace_id: m.workspace_id,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}

#[derive(Serialize)]
pub struct SessionWithLogs {
    #[serde(flatten)]
    pub session: SessionInfo,
    pub user_prompt: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateSessionRequest {
    pub project_id: String,
    pub branch: String,
    pub agent_type: String,
    pub title: Option<String>,
    pub workspace_id: Option<String>,
}

#[tauri::command]
pub async fn list_sessions(
    state: State<'_, AppState>,
    project_id: String,
) -> std::result::Result<Vec<SessionInfo>, String> {
    let sessions = session::Entity::find()
        .filter(session::Column::ProjectId.eq(&project_id))
        .filter(session::Column::DeletedAt.is_null())
        .order_by_desc(session::Column::UpdatedAt)
        .all(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;

    Ok(sessions.into_iter().map(SessionInfo::from).collect())
}

#[tauri::command]
pub async fn list_sessions_by_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
) -> std::result::Result<Vec<SessionInfo>, String> {
    let sessions = session::Entity::find()
        .filter(session::Column::WorkspaceId.eq(&workspace_id))
        .filter(session::Column::DeletedAt.is_null())
        .order_by_desc(session::Column::UpdatedAt)
        .all(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;

    Ok(sessions.into_iter().map(SessionInfo::from).collect())
}

#[tauri::command]
pub async fn get_session(
    state: State<'_, AppState>,
    session_id: String,
) -> std::result::Result<Option<SessionWithLogs>, String> {
    let session_model = session::Entity::find_by_id(&session_id)
        .one(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;

    let Some(session_model) = session_model else {
        return Ok(None);
    };

    let user_prompt = agent_process::Entity::find()
        .filter(agent_process::Column::SessionId.eq(&session_id))
        .order_by_asc(agent_process::Column::CreatedAt)
        .one(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?
        .and_then(|p| p.prompt);

    Ok(Some(SessionWithLogs {
        session: SessionInfo::from(session_model),
        user_prompt,
    }))
}

#[tauri::command]
pub async fn create_session(
    state: State<'_, AppState>,
    request: CreateSessionRequest,
) -> std::result::Result<SessionInfo, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let id = uuid::Uuid::new_v4().to_string();

    let model = session::ActiveModel {
        id: Set(id.clone()),
        project_id: Set(request.project_id),
        branch: Set(request.branch),
        worktree_path: Set(None),
        agent_type: Set(request.agent_type),
        title: Set(request.title),
        status: Set("idle".to_string()),
        base_commit: Set(None),
        workspace_id: Set(request.workspace_id),
        created_at: Set(now.clone()),
        updated_at: Set(now),
        deleted_at: Set(None),
    };

    session::Entity::insert(model)
        .exec(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;

    let session = session::Entity::find_by_id(&id)
        .one(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Session not found after insert".to_string())?;

    Ok(SessionInfo::from(session))
}

#[tauri::command]
pub async fn update_session_status(
    state: State<'_, AppState>,
    session_id: String,
    status: String,
) -> std::result::Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    session::Entity::update_many()
        .col_expr(session::Column::Status, Expr::value(status))
        .col_expr(session::Column::UpdatedAt, Expr::value(now))
        .filter(session::Column::Id.eq(&session_id))
        .exec(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_session(
    state: State<'_, AppState>,
    session_id: String,
) -> std::result::Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    session::Entity::update_many()
        .col_expr(session::Column::DeletedAt, Expr::value(Some(now)))
        .filter(session::Column::Id.eq(&session_id))
        .exec(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
pub struct WorktreeInfo {
    pub worktree_path: String,
    pub branch_name: String,
    pub base_commit: String,
}

#[tauri::command]
pub async fn setup_session_worktree(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    project_path: String,
) -> std::result::Result<WorktreeInfo, String> {
    let repo_path = std::path::Path::new(&project_path);

    // Get current HEAD commit as base
    let base_commit = vibe_studio_git::cli::run_git(repo_path, &["rev-parse", "HEAD"])
        .map(|s| s.trim().to_string())
        .map_err(|e| e.to_string())?;

    // Create a unique branch name using short session id
    let short_id = &session_id[..8.min(session_id.len())];
    let branch_name = format!("vibe-studio/{}", short_id);

    // Worktree directory in app data
    let worktree_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("worktrees")
        .join(&session_id);

    std::fs::create_dir_all(worktree_dir.parent().unwrap()).map_err(|e| e.to_string())?;

    // Create worktree with new branch
    vibe_studio_git::cli::run_git(
        repo_path,
        &[
            "worktree",
            "add",
            "-b",
            &branch_name,
            &worktree_dir.to_string_lossy(),
        ],
    )
    .map_err(|e| e.to_string())?;

    let worktree_path_str = worktree_dir.to_string_lossy().to_string();

    // Update session record
    let now = chrono::Utc::now().to_rfc3339();
    session::Entity::update_many()
        .col_expr(
            session::Column::WorktreePath,
            Expr::value(Some(worktree_path_str.clone())),
        )
        .col_expr(
            session::Column::BaseCommit,
            Expr::value(Some(base_commit.clone())),
        )
        .col_expr(session::Column::UpdatedAt, Expr::value(now))
        .filter(session::Column::Id.eq(&session_id))
        .exec(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;

    Ok(WorktreeInfo {
        worktree_path: worktree_path_str,
        branch_name,
        base_commit,
    })
}

#[tauri::command]
pub async fn cleanup_session_worktree(
    state: State<'_, AppState>,
    session_id: String,
    project_path: String,
) -> std::result::Result<(), String> {
    // Find the session to get worktree path
    let session_model = session::Entity::find_by_id(&session_id)
        .one(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;

    let Some(session_model) = session_model else {
        return Ok(());
    };

    if let Some(worktree_path) = &session_model.worktree_path {
        let repo_path = std::path::Path::new(&project_path);
        let wt_path = std::path::Path::new(worktree_path);

        // Remove the worktree
        let _ = vibe_studio_git::cli::run_git(
            repo_path,
            &["worktree", "remove", &wt_path.to_string_lossy(), "--force"],
        );

        // Delete the branch
        let short_id = &session_id[..8.min(session_id.len())];
        let branch_name = format!("vibe-studio/{}", short_id);
        let _ = vibe_studio_git::cli::run_git(repo_path, &["branch", "-D", &branch_name]);

        // Clear worktree_path in session
        let now = chrono::Utc::now().to_rfc3339();
        session::Entity::update_many()
            .col_expr(
                session::Column::WorktreePath,
                Expr::value(Option::<String>::None),
            )
            .col_expr(session::Column::UpdatedAt, Expr::value(now))
            .filter(session::Column::Id.eq(&session_id))
            .exec(&state.db.conn)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn load_claude_session_history(
    project_path: String,
) -> std::result::Result<Vec<vibe_studio_agent::AgentLogEntry>, String> {
    vibe_studio_agent::claude_session_reader::read_claude_session(&project_path)
}

#[tauri::command]
pub async fn load_claude_session_full(
    state: State<'_, AppState>,
    workspace_id: String,
) -> std::result::Result<vibe_studio_agent::ConversationDetail, String> {
    // 从数据库获取 workspace 信息
    let workspace = vibe_studio_db::entities::workspace::Entity::find_by_id(&workspace_id)
        .one(&state.db.conn)
        .await
        .map_err(|e| {
            eprintln!("[ERROR] Database query failed: {}", e);
            e.to_string()
        })?
        .ok_or_else(|| {
            eprintln!("[ERROR] Workspace not found: {}", workspace_id);
            "Workspace not found".to_string()
        })?;

    // 使用 worktree 路径（如果存在），否则使用原始项目路径
    // 对于 workspace，需要提取 workspace root 目录（去掉最后的 repo 名称）
    // 因为 Claude Code 是在 workspace root 目录运行的，而不是在某个具体的 repo 目录下
    let path_to_use = if let Some(ref worktree_path) = workspace.worktree_path {
        // Extract workspace root by removing the last component (repo name)
        // e.g., /path/to/worktrees/<workspace-id>/blog -> /path/to/worktrees/<workspace-id>
        let path = std::path::Path::new(worktree_path);
        let workspace_root = path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| worktree_path.clone());
        workspace_root
    } else {
        let project = vibe_studio_db::entities::project::Entity::find_by_id(&workspace.project_id)
            .one(&state.db.conn)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Project not found".to_string())?;
        project.path
    };

    vibe_studio_agent::parsers::claude_full::read_claude_session_full(&path_to_use)
}

#[tauri::command]
pub async fn load_codex_session_full(
    state: State<'_, AppState>,
    workspace_id: String,
) -> std::result::Result<vibe_studio_agent::ConversationDetail, String> {
    // 从数据库获取 workspace 信息
    let workspace = vibe_studio_db::entities::workspace::Entity::find_by_id(&workspace_id)
        .one(&state.db.conn)
        .await
        .map_err(|e| {
            eprintln!("[ERROR] Database query failed: {}", e);
            e.to_string()
        })?
        .ok_or_else(|| {
            eprintln!("[ERROR] Workspace not found: {}", workspace_id);
            "Workspace not found".to_string()
        })?;

    // 使用 worktree 路径（如果存在），否则使用原始项目路径
    let path_to_use = if let Some(ref worktree_path) = workspace.worktree_path {
        let path = std::path::Path::new(worktree_path);
        path.parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| worktree_path.clone())
    } else {
        let project = vibe_studio_db::entities::project::Entity::find_by_id(&workspace.project_id)
            .one(&state.db.conn)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Project not found".to_string())?;
        project.path
    };

    vibe_studio_agent::parsers::codex_full::read_codex_session_full(std::path::Path::new(
        &path_to_use,
    ))
}

#[tauri::command]
pub async fn load_gemini_session_full(
    state: State<'_, AppState>,
    workspace_id: String,
) -> std::result::Result<vibe_studio_agent::ConversationDetail, String> {
    let workspace = vibe_studio_db::entities::workspace::Entity::find_by_id(&workspace_id)
        .one(&state.db.conn)
        .await
        .map_err(|e| {
            eprintln!("[ERROR] Database query failed: {}", e);
            e.to_string()
        })?
        .ok_or_else(|| {
            eprintln!("[ERROR] Workspace not found: {}", workspace_id);
            "Workspace not found".to_string()
        })?;

    let path_to_use = if let Some(ref worktree_path) = workspace.worktree_path {
        let path = std::path::Path::new(worktree_path);
        path.parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| worktree_path.clone())
    } else {
        let project = vibe_studio_db::entities::project::Entity::find_by_id(&workspace.project_id)
            .one(&state.db.conn)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Project not found".to_string())?;
        project.path
    };

    vibe_studio_agent::parsers::gemini_full::read_gemini_session_full(std::path::Path::new(
        &path_to_use,
    ))
}
