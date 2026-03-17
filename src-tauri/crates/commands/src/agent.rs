use crate::AppState;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use vibe_studio_agent::{AgentLogEntry, AgentType};

#[derive(Serialize)]
pub struct AgentInfoResponse {
    pub agent_type: String,
    pub name: String,
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentOutputEvent {
    process_id: String,
    entry: AgentLogEntry,
}

#[tauri::command]
pub async fn discover_agents() -> std::result::Result<Vec<AgentInfoResponse>, String> {
    let agents = vibe_studio_agent::discovery::discover_agents();
    Ok(agents
        .into_iter()
        .map(|a| AgentInfoResponse {
            agent_type: format!("{:?}", a.agent_type).to_lowercase(),
            name: a.name,
            available: a.available,
            version: a.version,
            path: a.path,
        })
        .collect())
}

#[tauri::command]
pub async fn start_agent(
    app: AppHandle,
    state: State<'_, AppState>,
    process_id: String,
    agent_type: String,
    working_dir: String,
    prompt: String,
    continue_session: Option<bool>,
    permission_mode: Option<String>,
) -> std::result::Result<(), String> {
    let agent_type = match agent_type.as_str() {
        "claude_code" | "claudecode" => AgentType::ClaudeCode,
        "gemini" => AgentType::Gemini,
        "codex" => AgentType::Codex,
        _ => return Err(format!("Unknown agent type: {}", agent_type)),
    };

    let (tx, mut rx) = mpsc::unbounded_channel::<AgentLogEntry>();

    // Forward agent output to frontend via Tauri events
    let app_handle = app.clone();
    let pid = process_id.clone();
    tokio::spawn(async move {
        while let Some(entry) = rx.recv().await {
            let _ = app_handle.emit(
                "agent:output",
                &AgentOutputEvent {
                    process_id: pid.clone(),
                    entry,
                },
            );
        }
        let _ = app_handle.emit("agent:finished", &pid);
    });

    state
        .agent_manager
        .start_agent(
            &process_id,
            agent_type,
            std::path::Path::new(&working_dir),
            &prompt,
            continue_session.unwrap_or(false),
            permission_mode,
            tx,
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn stop_agent(
    state: State<'_, AppState>,
    process_id: String,
) -> std::result::Result<(), String> {
    state
        .agent_manager
        .stop_agent(&process_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn is_agent_running(
    state: State<'_, AppState>,
    process_id: String,
) -> std::result::Result<bool, String> {
    Ok(state.agent_manager.is_running(&process_id).await)
}
