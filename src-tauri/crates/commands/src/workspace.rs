use sea_orm::prelude::*;
use sea_orm::*;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use vibe_studio_db::entities::{project, session, workspace, workspace_repo};

use crate::AppState;

#[derive(Serialize)]
pub struct WorkspaceInfo {
    pub id: String,
    pub title: Option<String>,
    pub status: String,
    pub agent_type: String,
    pub initial_prompt: Option<String>,
    pub repos: Vec<WorkspaceRepoInfo>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Clone)]
pub struct WorkspaceRepoInfo {
    pub id: String,
    pub workspace_id: String,
    pub project_id: String,
    pub path: String,
    pub name: String,
    pub branch: String,
    pub base_branch: Option<String>,
    pub worktree_path: Option<String>,
    pub base_commit: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateWorkspaceRepo {
    pub path: String,
    pub branch: String,
    pub use_local_project: Option<bool>,
}

#[derive(Deserialize)]
pub struct CreateWorkspaceRequest {
    pub repos: Vec<CreateWorkspaceRepo>,
    pub agent_type: String,
    pub initial_prompt: Option<String>,
    pub title: Option<String>,
}

fn repo_name_from_path(path: &str) -> String {
    path.split('/')
        .filter(|s| !s.is_empty())
        .last()
        .unwrap_or("Unknown")
        .to_string()
}

fn refresh_remote_branch(
    repo_path: &std::path::Path,
    target_branch: &str,
) -> std::result::Result<(), String> {
    let remote_branch = target_branch
        .strip_prefix("origin/")
        .ok_or_else(|| format!("Unsupported remote branch reference: {}", target_branch))?;
    let refspec = format!(
        "refs/heads/{}:refs/remotes/origin/{}",
        remote_branch, remote_branch
    );

    vibe_studio_git::cli::run_git(repo_path, &["fetch", "--prune", "origin", &refspec])
        .map_err(|e| format!("Failed to fetch latest code for {}: {}", target_branch, e))?;

    Ok(())
}

fn resolve_base_commit(
    repo_path: &std::path::Path,
    target_branch: &str,
) -> std::result::Result<String, String> {
    if target_branch.starts_with("origin/") {
        refresh_remote_branch(repo_path, target_branch)?;
    }

    vibe_studio_git::cli::run_git(repo_path, &["rev-parse", target_branch])
        .map(|s| s.trim().to_string())
        .map_err(|e| format!("Failed to resolve base commit for {}: {}", target_branch, e))
}

fn create_isolated_worktree(
    repo_path: &std::path::Path,
    target_branch: &str,
    branch_name: &str,
    worktree_dir: &std::path::Path,
) -> std::result::Result<String, String> {
    match vibe_studio_git::cli::run_git(
        repo_path,
        &[
            "worktree",
            "add",
            "-b",
            branch_name,
            &worktree_dir.to_string_lossy(),
            target_branch,
        ],
    ) {
        Ok(_) => Ok(worktree_dir.to_string_lossy().to_string()),
        Err(e) => {
            eprintln!(
                "Git worktree add returned error for {}: {}",
                repo_path.display(),
                e
            );
            if worktree_dir.exists() {
                eprintln!(
                    "Worktree directory exists, using it anyway: {:?}",
                    worktree_dir
                );
                Ok(worktree_dir.to_string_lossy().to_string())
            } else {
                Err(format!(
                    "Failed to create worktree from {} in {}: {}",
                    target_branch,
                    repo_path.display(),
                    e
                ))
            }
        }
    }
}

#[tauri::command]
pub async fn create_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    request: CreateWorkspaceRequest,
) -> std::result::Result<WorkspaceInfo, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let workspace_id = uuid::Uuid::new_v4().to_string();

    // Auto-generate title from prompt or repo names
    let title = request.title.or_else(|| {
        request
            .initial_prompt
            .as_ref()
            .map(|p| p.chars().take(50).collect::<String>())
    });

    // Get first repo info for workspace fields
    let first_repo = request.repos.first().ok_or("At least one repo required")?;
    let first_repo_path = std::path::Path::new(&first_repo.path);
    let first_repo_name = repo_name_from_path(&first_repo.path);

    // Ensure project exists
    let first_project_id = ensure_project(&state, &first_repo.path, &first_repo_name, &now).await?;

    // Worktrees base directory
    let worktrees_base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("worktrees")
        .join(&workspace_id);

    std::fs::create_dir_all(&worktrees_base).map_err(|e| e.to_string())?;

    // Generate branch name with date and random string
    let date_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    let random_id: String = uuid::Uuid::new_v4()
        .to_string()
        .split('-')
        .next()
        .unwrap_or("unknown")
        .to_string();

    let branch_name = format!("vibe-studio/{}-{}", date_str, random_id);
    let worktree_dir = worktrees_base.join(&first_repo_name);
    // Get base commit from the user-selected branch
    let first_base_commit = resolve_base_commit(first_repo_path, &first_repo.branch)?;

    // Create git worktree from the user-selected branch
    let target_branch = &first_repo.branch;
    let first_worktree_path_str = Some(create_isolated_worktree(
        first_repo_path,
        target_branch,
        &branch_name,
        &worktree_dir,
    )?);

    // Insert workspace with first repo's info
    let ws_model = workspace::ActiveModel {
        id: Set(workspace_id.clone()),
        title: Set(title.clone()),
        status: Set("idle".to_string()),
        agent_type: Set(request.agent_type.clone()),
        initial_prompt: Set(request.initial_prompt.clone()),
        project_id: Set(first_project_id.clone()),
        branch: Set(branch_name.clone()),
        worktree_path: Set(first_worktree_path_str.clone()),
        base_commit: Set(Some(first_base_commit.clone())),
        created_at: Set(now.clone()),
        updated_at: Set(now.clone()),
        deleted_at: Set(None),
    };
    workspace::Entity::insert(ws_model)
        .exec(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;

    let mut repo_infos = Vec::new();

    for (idx, repo_req) in request.repos.iter().enumerate() {
        let repo_id = uuid::Uuid::new_v4().to_string();
        let repo_name = repo_name_from_path(&repo_req.path);
        let repo_path = std::path::Path::new(&repo_req.path);

        // Ensure project exists in DB
        let project_id = ensure_project(&state, &repo_req.path, &repo_name, &now).await?;

        // Create unique branch name for each repo (to avoid Git worktree conflicts)
        let repo_branch_name = if idx == 0 {
            branch_name.clone()
        } else {
            format!("{}-{}", branch_name, repo_name)
        };

        let worktree_dir = worktrees_base.join(&repo_name);

        let (base_commit, worktree_path_str) = if idx == 0 {
            (first_base_commit.clone(), first_worktree_path_str.clone())
        } else {
            let base_commit = resolve_base_commit(repo_path, &repo_req.branch)?;
            let worktree_path_str = Some(create_isolated_worktree(
                repo_path,
                &repo_req.branch,
                &repo_branch_name,
                &worktree_dir,
            )?);
            (base_commit, worktree_path_str)
        };

        // Insert workspace_repo
        let wr_model = workspace_repo::ActiveModel {
            id: Set(repo_id.clone()),
            workspace_id: Set(workspace_id.clone()),
            project_id: Set(project_id.clone()),
            path: Set(repo_req.path.clone()),
            branch: Set(repo_branch_name.clone()),
            base_branch: Set(Some(repo_req.branch.clone())),
            worktree_path: Set(worktree_path_str.clone()),
            base_commit: Set(Some(base_commit.clone())),
            created_at: Set(now.clone()),
        };
        workspace_repo::Entity::insert(wr_model)
            .exec(&state.db.conn)
            .await
            .map_err(|e| e.to_string())?;

        repo_infos.push(WorkspaceRepoInfo {
            id: repo_id,
            workspace_id: workspace_id.clone(),
            project_id,
            path: repo_req.path.clone(),
            name: repo_name,
            branch: repo_branch_name.clone(),
            base_branch: Some(repo_req.branch.clone()),
            worktree_path: worktree_path_str,
            base_commit: Some(base_commit),
        });
    }

    Ok(WorkspaceInfo {
        id: workspace_id,
        title,
        status: "idle".to_string(),
        agent_type: request.agent_type,
        initial_prompt: request.initial_prompt,
        repos: repo_infos,
        created_at: now.clone(),
        updated_at: now,
    })
}

async fn ensure_project(
    state: &State<'_, AppState>,
    path: &str,
    name: &str,
    now: &str,
) -> std::result::Result<String, String> {
    // Check if project already exists
    let existing = project::Entity::find()
        .filter(project::Column::Path.eq(path))
        .filter(project::Column::DeletedAt.is_null())
        .one(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(p) = existing {
        // Update last_opened_at
        project::Entity::update_many()
            .col_expr(project::Column::LastOpenedAt, Expr::value(now.to_string()))
            .col_expr(project::Column::UpdatedAt, Expr::value(now.to_string()))
            .filter(project::Column::Id.eq(&p.id))
            .exec(&state.db.conn)
            .await
            .map_err(|e| e.to_string())?;
        return Ok(p.id);
    }

    // Create new project
    let id = uuid::Uuid::new_v4().to_string();
    let model = project::ActiveModel {
        id: Set(id.clone()),
        name: Set(name.to_string()),
        path: Set(path.to_string()),
        remote_url: Set(None),
        remote_type: Set(None),
        default_branch: Set("main".to_string()),
        default_agent: Set(None),
        last_opened_at: Set(now.to_string()),
        created_at: Set(now.to_string()),
        updated_at: Set(now.to_string()),
        deleted_at: Set(None),
    };
    project::Entity::insert(model)
        .exec(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;

    Ok(id)
}

async fn reconcile_workspace_state(
    state: &State<'_, AppState>,
    workspace_id: &str,
    current_status: &str,
) -> std::result::Result<String, String> {
    let sessions = session::Entity::find()
        .filter(session::Column::WorkspaceId.eq(workspace_id))
        .filter(session::Column::DeletedAt.is_null())
        .order_by_desc(session::Column::UpdatedAt)
        .all(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;

    let latest_is_running = sessions
        .first()
        .map(|s| s.status == "running")
        .unwrap_or(false);

    let stale_running_ids: Vec<String> = sessions
        .iter()
        .enumerate()
        .filter_map(|(index, session)| {
            if session.status != "running" {
                return None;
            }

            let keep_latest_running =
                current_status == "running" && latest_is_running && index == 0;
            if keep_latest_running {
                None
            } else {
                Some(session.id.clone())
            }
        })
        .collect();

    if !stale_running_ids.is_empty() {
        let now = chrono::Utc::now().to_rfc3339();
        session::Entity::update_many()
            .col_expr(session::Column::Status, Expr::value("completed"))
            .col_expr(session::Column::UpdatedAt, Expr::value(now))
            .filter(session::Column::Id.is_in(stale_running_ids))
            .exec(&state.db.conn)
            .await
            .map_err(|e| e.to_string())?;
    }

    let next_status = if current_status == "running" && !latest_is_running {
        "need_review".to_string()
    } else {
        current_status.to_string()
    };

    if next_status != current_status {
        let now = chrono::Utc::now().to_rfc3339();
        workspace::Entity::update_many()
            .col_expr(workspace::Column::Status, Expr::value(next_status.clone()))
            .col_expr(workspace::Column::UpdatedAt, Expr::value(now))
            .filter(workspace::Column::Id.eq(workspace_id))
            .exec(&state.db.conn)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(next_status)
}

#[tauri::command]
pub async fn list_workspaces(
    state: State<'_, AppState>,
) -> std::result::Result<Vec<WorkspaceInfo>, String> {
    let workspaces = workspace::Entity::find()
        .filter(workspace::Column::DeletedAt.is_null())
        .order_by_desc(workspace::Column::UpdatedAt)
        .all(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for ws in workspaces {
        let status = reconcile_workspace_state(&state, &ws.id, &ws.status).await?;
        let repos = workspace_repo::Entity::find()
            .filter(workspace_repo::Column::WorkspaceId.eq(&ws.id))
            .all(&state.db.conn)
            .await
            .map_err(|e| e.to_string())?;

        let repo_infos: Vec<WorkspaceRepoInfo> = repos
            .into_iter()
            .map(|r| WorkspaceRepoInfo {
                id: r.id,
                workspace_id: r.workspace_id,
                project_id: r.project_id.clone(),
                name: repo_name_from_path(&r.path),
                path: r.path,
                branch: r.branch,
                base_branch: r.base_branch,
                worktree_path: r.worktree_path,
                base_commit: r.base_commit,
            })
            .collect();

        result.push(WorkspaceInfo {
            id: ws.id,
            title: ws.title,
            status,
            agent_type: ws.agent_type,
            initial_prompt: ws.initial_prompt,
            repos: repo_infos,
            created_at: ws.created_at,
            updated_at: ws.updated_at,
        });
    }

    Ok(result)
}

#[tauri::command]
pub async fn get_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
) -> std::result::Result<Option<WorkspaceInfo>, String> {
    let ws = workspace::Entity::find_by_id(&workspace_id)
        .one(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;

    let Some(ws) = ws else {
        return Ok(None);
    };

    let status = reconcile_workspace_state(&state, &ws.id, &ws.status).await?;

    let repos = workspace_repo::Entity::find()
        .filter(workspace_repo::Column::WorkspaceId.eq(&ws.id))
        .all(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;

    let repo_infos: Vec<WorkspaceRepoInfo> = repos
        .into_iter()
        .map(|r| WorkspaceRepoInfo {
            id: r.id,
            workspace_id: r.workspace_id,
            project_id: r.project_id.clone(),
            name: repo_name_from_path(&r.path),
            path: r.path,
            branch: r.branch,
            base_branch: r.base_branch,
            worktree_path: r.worktree_path,
            base_commit: r.base_commit,
        })
        .collect();

    Ok(Some(WorkspaceInfo {
        id: ws.id,
        title: ws.title,
        status,
        agent_type: ws.agent_type,
        initial_prompt: ws.initial_prompt,
        repos: repo_infos,
        created_at: ws.created_at,
        updated_at: ws.updated_at,
    }))
}

#[tauri::command]
pub async fn update_workspace_status(
    state: State<'_, AppState>,
    workspace_id: String,
    status: String,
) -> std::result::Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    workspace::Entity::update_many()
        .col_expr(workspace::Column::Status, Expr::value(status))
        .col_expr(workspace::Column::UpdatedAt, Expr::value(now))
        .filter(workspace::Column::Id.eq(&workspace_id))
        .exec(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn update_workspace_title(
    state: State<'_, AppState>,
    workspace_id: String,
    title: Option<String>,
) -> std::result::Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let normalized_title = title
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    workspace::Entity::update_many()
        .col_expr(workspace::Column::Title, Expr::value(normalized_title))
        .col_expr(workspace::Column::UpdatedAt, Expr::value(now))
        .filter(workspace::Column::Id.eq(&workspace_id))
        .exec(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn update_workspace_agent(
    state: State<'_, AppState>,
    workspace_id: String,
    agent_type: String,
) -> std::result::Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();

    workspace::Entity::update_many()
        .col_expr(workspace::Column::AgentType, Expr::value(agent_type))
        .col_expr(workspace::Column::UpdatedAt, Expr::value(now))
        .filter(workspace::Column::Id.eq(&workspace_id))
        .exec(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
) -> std::result::Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    workspace::Entity::update_many()
        .col_expr(workspace::Column::DeletedAt, Expr::value(Some(now)))
        .filter(workspace::Column::Id.eq(&workspace_id))
        .exec(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
