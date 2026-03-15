use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;

use crate::{AgentLogEntry, AgentLogEntryType};

/// Read Claude Code session history from ~/.claude/projects/
pub fn read_claude_session(project_path: &str) -> Result<Vec<AgentLogEntry>, String> {
    eprintln!(
        "[claude_session_reader] Reading session for project: {}",
        project_path
    );

    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let claude_dir = home.join(".claude").join("projects");

    // Convert project path to Claude's encoded format
    let encoded = project_path.replace('/', "-");
    let project_dir = claude_dir.join(&encoded);

    eprintln!(
        "[claude_session_reader] Looking for sessions in: {:?}",
        project_dir
    );

    if !project_dir.exists() {
        eprintln!("[claude_session_reader] Project directory does not exist");
        return Ok(Vec::new());
    }

    // Find the most recent .jsonl file
    let mut jsonl_files: Vec<_> = fs::read_dir(&project_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s == "jsonl")
                .unwrap_or(false)
        })
        .collect();

    eprintln!(
        "[claude_session_reader] Found {} .jsonl files",
        jsonl_files.len()
    );

    if jsonl_files.is_empty() {
        eprintln!("[claude_session_reader] No .jsonl files found");
        return Ok(Vec::new());
    }

    // Sort by modified time, newest first
    jsonl_files.sort_by_key(|e| {
        e.metadata()
            .and_then(|m| m.modified())
            .ok()
            .map(|t| std::cmp::Reverse(t))
    });

    let latest_file = &jsonl_files[0].path();
    eprintln!(
        "[claude_session_reader] Reading latest file: {:?}",
        latest_file
    );
    parse_jsonl_file(latest_file)
}

fn parse_jsonl_file(path: &PathBuf) -> Result<Vec<AgentLogEntry>, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let mut entries = Vec::new();

    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.trim().is_empty() {
            continue;
        }

        let json: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;

        // Parse based on message type
        if let Some(msg_type) = json.get("type").and_then(|v| v.as_str()) {
            match msg_type {
                "assistant" => {
                    if let Some(content) =
                        json.pointer("/message/content").and_then(|v| v.as_array())
                    {
                        for block in content {
                            if let Some(entry) = parse_content_block(block) {
                                entries.push(entry);
                            }
                        }
                    }
                }
                "tool_result" => {
                    if let Some(entry) = parse_tool_result(&json) {
                        entries.push(entry);
                    }
                }
                _ => {}
            }
        }
    }

    Ok(entries)
}

fn parse_content_block(block: &Value) -> Option<AgentLogEntry> {
    let block_type = block.get("type")?.as_str()?;

    match block_type {
        "text" => {
            let text = block.get("text")?.as_str()?;
            if text.trim().is_empty() {
                return None;
            }
            Some(AgentLogEntry {
                entry_type: AgentLogEntryType::Text,
                content: text.to_string(),
                tool_name: None,
                file_path: None,
                timestamp: chrono::Utc::now().to_rfc3339(),
            })
        }
        "tool_use" => {
            let tool_name = block.get("name")?.as_str()?.to_string();
            let input = block.get("input")?.to_string();
            Some(AgentLogEntry {
                entry_type: AgentLogEntryType::ToolCall,
                content: input,
                tool_name: Some(tool_name),
                file_path: None,
                timestamp: chrono::Utc::now().to_rfc3339(),
            })
        }
        "thinking" => {
            let text = block.get("thinking")?.as_str()?;
            if text.trim().is_empty() {
                return None;
            }
            Some(AgentLogEntry {
                entry_type: AgentLogEntryType::Thinking,
                content: text.to_string(),
                tool_name: None,
                file_path: None,
                timestamp: chrono::Utc::now().to_rfc3339(),
            })
        }
        _ => None,
    }
}

fn parse_tool_result(json: &Value) -> Option<AgentLogEntry> {
    let content = if let Some(arr) = json.get("content")?.as_array() {
        arr.iter()
            .filter_map(|v| v.get("text")?.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        json.get("content")?.as_str()?.to_string()
    };

    if content.is_empty() {
        return None;
    }

    let is_error = json.get("is_error")?.as_bool().unwrap_or(false);

    Some(AgentLogEntry {
        entry_type: if is_error {
            AgentLogEntryType::Error
        } else {
            AgentLogEntryType::ToolResult
        },
        content,
        tool_name: None,
        file_path: None,
        timestamp: chrono::Utc::now().to_rfc3339(),
    })
}
