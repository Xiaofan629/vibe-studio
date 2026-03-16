#[tauri::command]
pub async fn open_in_editor(editor: String, path: String) -> std::result::Result<(), String> {
    let cmd = match editor.as_str() {
        "vscode" => "code",
        "cursor" => "cursor",
        "trae" => "trae",
        _ => return Err(format!("Unknown editor: {}", editor)),
    };

    // Try to open the editor directly, don't pre-check if it exists
    // This avoids false negatives from `which` command
    let install_hint = match editor.as_str() {
        "vscode" => "Install Visual Studio Code from https://code.visualstudio.com/",
        "cursor" => "Install Cursor from https://cursor.sh/",
        "trae" => "Install Trae from https://trae.ai/",
        _ => "",
    };

    let mut command = vibe_studio_agent::command::new_std_command(cmd);
    command
        .arg(&path)
        .spawn()
        .map_err(|e| {
            // Provide helpful error message if the command failed
            if e.kind() == std::io::ErrorKind::NotFound {
                format!(
                    "{} is not installed or not in PATH.\n\n{}\n\nPlease install {} and make sure it's available in your system PATH.",
                    editor, install_hint, editor
                )
            } else {
                format!("Failed to open {}: {}", editor, e)
            }
        })?;

    Ok(())
}
