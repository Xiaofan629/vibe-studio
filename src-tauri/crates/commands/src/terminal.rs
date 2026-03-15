use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Clone, Serialize)]
struct TerminalOutput {
    id: String,
    data: Vec<u8>,
}

#[tauri::command]
pub async fn create_terminal(
    app: AppHandle,
    state: State<'_, crate::AppState>,
    terminal_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> std::result::Result<(), String> {
    let mut rx = state
        .terminal_manager
        .create(&terminal_id, std::path::Path::new(&cwd), cols, rows)
        .await
        .map_err(|e| e.to_string())?;

    // Forward PTY output to frontend via Tauri events
    let tid = terminal_id.clone();
    tokio::spawn(async move {
        while let Some(data) = rx.recv().await {
            let _ = app.emit(
                "terminal:output",
                TerminalOutput {
                    id: tid.clone(),
                    data,
                },
            );
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn write_terminal(
    state: State<'_, crate::AppState>,
    terminal_id: String,
    data: Vec<u8>,
) -> std::result::Result<(), String> {
    state
        .terminal_manager
        .write(&terminal_id, &data)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn resize_terminal(
    state: State<'_, crate::AppState>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> std::result::Result<(), String> {
    state
        .terminal_manager
        .resize(&terminal_id, cols, rows)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn close_terminal(
    state: State<'_, crate::AppState>,
    terminal_id: String,
) -> std::result::Result<(), String> {
    state
        .terminal_manager
        .close(&terminal_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn change_terminal_directory(
    state: State<'_, crate::AppState>,
    terminal_id: String,
    path: String,
) -> std::result::Result<(), String> {
    state
        .terminal_manager
        .change_directory(&terminal_id, std::path::Path::new(&path))
        .await
        .map_err(|e| e.to_string())
}
