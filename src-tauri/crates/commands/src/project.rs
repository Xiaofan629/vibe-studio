use sea_orm::prelude::Expr;
use sea_orm::*;
use serde::Serialize;
use tauri::State;
use vibe_studio_db::entities::project;

#[derive(Serialize)]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub remote_url: Option<String>,
    pub remote_type: Option<String>,
    pub default_branch: String,
    pub last_opened_at: String,
}

impl From<project::Model> for ProjectInfo {
    fn from(m: project::Model) -> Self {
        Self {
            id: m.id,
            name: m.name,
            path: m.path,
            remote_url: m.remote_url,
            remote_type: m.remote_type,
            default_branch: m.default_branch,
            last_opened_at: m.last_opened_at,
        }
    }
}

#[tauri::command]
pub async fn list_projects(
    state: State<'_, crate::AppState>,
) -> std::result::Result<Vec<ProjectInfo>, String> {
    let projects = project::Entity::find()
        .filter(project::Column::DeletedAt.is_null())
        .order_by_desc(project::Column::LastOpenedAt)
        .all(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;

    Ok(projects.into_iter().map(ProjectInfo::from).collect())
}

#[tauri::command]
pub async fn add_local_project(
    state: State<'_, crate::AppState>,
    path: String,
) -> std::result::Result<ProjectInfo, String> {
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    let now = chrono::Utc::now().to_rfc3339();
    let id = uuid::Uuid::new_v4().to_string();

    let model = project::ActiveModel {
        id: Set(id.clone()),
        name: Set(name),
        path: Set(path),
        remote_url: Set(None),
        remote_type: Set(None),
        default_branch: Set("main".to_string()),
        default_agent: Set(None),
        last_opened_at: Set(now.clone()),
        created_at: Set(now.clone()),
        updated_at: Set(now),
        deleted_at: Set(None),
    };

    project::Entity::insert(model)
        .exec(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;

    let project = project::Entity::find_by_id(&id)
        .one(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Project not found after insert".to_string())?;

    Ok(ProjectInfo::from(project))
}

#[tauri::command]
pub async fn get_project(
    state: State<'_, crate::AppState>,
    project_id: String,
) -> std::result::Result<Option<ProjectInfo>, String> {
    let project = project::Entity::find_by_id(&project_id)
        .one(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;

    Ok(project.map(ProjectInfo::from))
}

#[tauri::command]
pub async fn delete_project(
    state: State<'_, crate::AppState>,
    project_id: String,
) -> std::result::Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    project::Entity::update_many()
        .col_expr(project::Column::DeletedAt, Expr::value(Some(now)))
        .filter(project::Column::Id.eq(&project_id))
        .exec(&state.db.conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_git_repo: bool,
}

#[tauri::command]
pub async fn list_directory(path: String) -> std::result::Result<Vec<DirEntry>, String> {
    let dir_path = std::path::Path::new(&path);
    if !dir_path.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(dir_path).map_err(|e| e.to_string())?;

    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden dirs (except we detect .git)
        if name.starts_with('.') {
            continue;
        }

        if file_type.is_dir() {
            let entry_path = entry.path();
            let is_git_repo = entry_path.join(".git").exists();
            entries.push(DirEntry {
                name,
                path: entry_path.to_string_lossy().to_string(),
                is_dir: true,
                is_git_repo,
            });
        }
    }

    entries.sort_by(|a, b| {
        // Git repos first, then alphabetical
        b.is_git_repo.cmp(&a.is_git_repo).then(a.name.cmp(&b.name))
    });

    Ok(entries)
}

#[tauri::command]
pub async fn get_home_dir() -> std::result::Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine home directory".to_string())
}

#[tauri::command]
pub async fn get_repo_branches(repo_path: String) -> std::result::Result<Vec<String>, String> {
    let path = std::path::Path::new(&repo_path);
    if !path.join(".git").exists() {
        return Err("Not a git repository".to_string());
    }

    let git = vibe_studio_git::GitService::new();
    let branches = git.get_all_branches(path).map_err(|e| e.to_string())?;

    Ok(branches.into_iter().map(|b| b.name).collect())
}
