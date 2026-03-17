use base64::Engine;
use sea_orm::prelude::Expr;
use sea_orm::*;
use serde::Serialize;
use std::path::{Path, PathBuf};
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

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub extension: Option<String>,
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
pub async fn list_directory_contents(
    directory_path: String,
) -> std::result::Result<Vec<FileEntry>, String> {
    if directory_path.trim().is_empty() {
        return Err("Directory path cannot be empty".to_string());
    }

    let path = PathBuf::from(&directory_path);
    if !path.exists() {
        return Err(format!("Path does not exist: {}", directory_path));
    }
    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", directory_path));
    }

    let mut entries = Vec::new();
    let dir_entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;

    for entry in dir_entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let metadata = entry.metadata().map_err(|e| e.to_string())?;

        if let Some(name) = entry_path.file_name().and_then(|n| n.to_str()) {
            if name.starts_with('.') && name != ".claude" {
                continue;
            }
        }

        let name = entry_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let extension = if metadata.is_file() {
            entry_path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_string())
        } else {
            None
        };

        entries.push(FileEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_directory: metadata.is_dir(),
            size: metadata.len(),
            extension,
        });
    }

    entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

#[tauri::command]
pub async fn search_files(
    base_path: String,
    query: String,
) -> std::result::Result<Vec<FileEntry>, String> {
    if base_path.trim().is_empty() {
        return Err("Base path cannot be empty".to_string());
    }
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let path = PathBuf::from(&base_path);
    if !path.exists() {
        return Err(format!("Path does not exist: {}", base_path));
    }

    let mut results = Vec::new();
    search_files_recursive(&path, &query.to_lowercase(), &mut results, 0)?;

    results.sort_by(|a, b| {
        let a_exact = a.name.to_lowercase() == query.to_lowercase();
        let b_exact = b.name.to_lowercase() == query.to_lowercase();
        match (a_exact, b_exact) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });
    results.truncate(50);

    Ok(results)
}

#[derive(Serialize)]
pub struct SavedImage {
    pub path: String,
    pub relative_path: String,
}

#[tauri::command]
pub async fn save_pasted_image(
    project_path: String,
    data_url: String,
) -> std::result::Result<SavedImage, String> {
    let project_dir = PathBuf::from(&project_path);
    if !project_dir.exists() || !project_dir.is_dir() {
        return Err(format!("Invalid project path: {}", project_path));
    }

    let (header, encoded) = data_url
        .split_once(',')
        .ok_or_else(|| "Invalid data URL".to_string())?;

    if !header.starts_with("data:image/") {
        return Err("Only image data URLs are supported".to_string());
    }

    if !header.contains(";base64") {
        return Err("Only base64 encoded image data URLs are supported".to_string());
    }

    let mime = header
        .trim_start_matches("data:")
        .split(';')
        .next()
        .unwrap_or("image/png");

    let extension = match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        _ => "png",
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("Failed to decode image data: {}", e))?;

    let image_dir = project_dir.join(".vibe-studio").join("images");
    std::fs::create_dir_all(&image_dir).map_err(|e| e.to_string())?;

    let file_name = format!("pasted-{}.{}", uuid::Uuid::new_v4(), extension);
    let full_path = image_dir.join(&file_name);

    std::fs::write(&full_path, bytes).map_err(|e| e.to_string())?;

    let relative_path = full_path
        .strip_prefix(&project_dir)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();

    Ok(SavedImage {
        path: full_path.to_string_lossy().to_string(),
        relative_path: relative_path.replace('\\', "/"),
    })
}

fn search_files_recursive(
    current_path: &Path,
    query: &str,
    results: &mut Vec<FileEntry>,
    depth: usize,
) -> std::result::Result<(), String> {
    if depth > 5 || results.len() >= 50 {
        return Ok(());
    }

    let entries = std::fs::read_dir(current_path).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();

        if let Some(name) = entry_path.file_name().and_then(|n| n.to_str()) {
            if name.starts_with('.') {
                continue;
            }

            if name.to_lowercase().contains(query) {
                let metadata = entry.metadata().map_err(|e| e.to_string())?;
                let extension = if metadata.is_file() {
                    entry_path
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.to_string())
                } else {
                    None
                };

                results.push(FileEntry {
                    name: name.to_string(),
                    path: entry_path.to_string_lossy().to_string(),
                    is_directory: metadata.is_dir(),
                    size: metadata.len(),
                    extension,
                });
            }
        }

        if entry_path.is_dir() {
            if let Some(dir_name) = entry_path.file_name().and_then(|n| n.to_str()) {
                if matches!(
                    dir_name,
                    "node_modules" | "target" | ".git" | "dist" | "build" | ".next" | "__pycache__"
                ) {
                    continue;
                }
            }

            search_files_recursive(&entry_path, query, results, depth + 1)?;
        }
    }

    Ok(())
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
