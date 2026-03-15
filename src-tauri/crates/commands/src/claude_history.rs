use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeSession {
    pub id: String,
    pub project_path: String,
    pub messages: Vec<ClaudeMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeMessage {
    pub role: String,
    pub content: String,
    pub timestamp: String,
}

pub fn get_claude_config_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_default().join(".claude")
}

pub fn find_session_file(project_path: &str) -> Result<PathBuf, String> {
    let projects_dir = get_claude_config_dir().join("projects");

    // 将项目路径转换为 Claude 的目录格式
    let encoded_path = project_path.replace('/', "-");
    let session_dir = projects_dir.join(encoded_path);

    if !session_dir.exists() {
        return Err(format!("Session directory not found: {:?}", session_dir));
    }

    // 查找最新的 .jsonl 文件
    let entries =
        fs::read_dir(&session_dir).map_err(|e| format!("Failed to read session dir: {}", e))?;

    let mut jsonl_files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("jsonl"))
        .collect();

    jsonl_files.sort_by(|a, b| {
        let a_meta = fs::metadata(a).ok();
        let b_meta = fs::metadata(b).ok();
        match (a_meta, b_meta) {
            (Some(a_m), Some(b_m)) => b_m
                .modified()
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                .cmp(&a_m.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH)),
            _ => std::cmp::Ordering::Equal,
        }
    });

    jsonl_files
        .first()
        .cloned()
        .ok_or_else(|| "No session files found".to_string())
}

pub fn read_session_messages(file_path: &PathBuf) -> Result<Vec<ClaudeMessage>, String> {
    let file = fs::File::open(file_path).map_err(|e| format!("Failed to open file: {}", e))?;
    let reader = BufReader::new(file);

    let mut messages = Vec::new();

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read line: {}", e))?;
        if line.trim().is_empty() {
            continue;
        }

        let value: serde_json::Value =
            serde_json::from_str(&line).map_err(|e| format!("Failed to parse JSON: {}", e))?;

        let msg_type = value.get("type").and_then(|t| t.as_str()).unwrap_or("");

        if msg_type == "user" || msg_type == "assistant" {
            let timestamp = value
                .get("timestamp")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();

            let content = extract_message_content(&value);

            if !content.is_empty() {
                messages.push(ClaudeMessage {
                    role: msg_type.to_string(),
                    content,
                    timestamp,
                });
            }
        }
    }

    Ok(messages)
}

fn extract_message_content(value: &serde_json::Value) -> String {
    let message = match value.get("message") {
        Some(m) => m,
        None => return String::new(),
    };

    let content = match message.get("content") {
        Some(c) => c,
        None => return String::new(),
    };

    if let Some(text) = content.as_str() {
        return text.to_string();
    }

    if let Some(arr) = content.as_array() {
        let mut texts = Vec::new();
        for item in arr {
            let block_type = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if block_type == "text" {
                if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                    texts.push(text.to_string());
                }
            }
        }
        return texts.join("\n");
    }

    String::new()
}

#[tauri::command]
pub async fn load_claude_session(project_path: String) -> Result<ClaudeSession, String> {
    let session_file = find_session_file(&project_path)?;
    let messages = read_session_messages(&session_file)?;

    let session_id = session_file
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    Ok(ClaudeSession {
        id: session_id,
        project_path,
        messages,
    })
}
