#[tauri::command]
pub async fn open_in_editor(editor: String, path: String) -> std::result::Result<(), String> {
    let cmd = match editor.as_str() {
        "vscode" => "code",
        "cursor" => "cursor",
        "trae" => "trae",
        _ => return Err(format!("Unknown editor: {}", editor)),
    };

    std::process::Command::new(cmd)
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open {}: {}", editor, e))?;

    Ok(())
}
