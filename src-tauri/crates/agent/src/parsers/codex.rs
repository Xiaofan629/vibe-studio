use crate::{AgentLogEntry, AgentLogEntryType};
use serde_json::Value;

/// Parse Codex CLI output line.
///
/// Codex CLI can output:
/// - JSON objects for structured events (similar to Claude's stream-json)
/// - Plain text for conversational responses
/// - Lines with special prefixes for tool operations
pub fn parse_line(line: &str) -> Vec<AgentLogEntry> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return vec![];
    }

    // Try parsing as JSON (Codex may emit structured output)
    if let Ok(json) = serde_json::from_str::<Value>(trimmed) {
        return parse_json_line(&json);
    }

    // Detect thinking/reasoning patterns
    if trimmed.starts_with("Thinking:") || trimmed.starts_with("> ") {
        return vec![AgentLogEntry {
            entry_type: AgentLogEntryType::Thinking,
            content: trimmed.to_string(),
            tool_name: None,
            file_path: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
        }];
    }

    // Detect tool/command execution patterns
    if trimmed.starts_with("$ ") || trimmed.starts_with("Running: ") {
        return vec![AgentLogEntry {
            entry_type: AgentLogEntryType::ToolCall,
            content: trimmed.to_string(),
            tool_name: Some("shell".to_string()),
            file_path: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
        }];
    }

    // Detect file operation patterns
    if trimmed.starts_with("Reading ")
        || trimmed.starts_with("Writing ")
        || trimmed.starts_with("Patching ")
    {
        let file_path = extract_file_path(trimmed);
        return vec![AgentLogEntry {
            entry_type: AgentLogEntryType::FileOp,
            content: trimmed.to_string(),
            tool_name: None,
            file_path,
            timestamp: chrono::Utc::now().to_rfc3339(),
        }];
    }

    // Detect error patterns
    if trimmed.starts_with("Error:")
        || trimmed.starts_with("ERROR")
        || trimmed.starts_with("error:")
    {
        return vec![AgentLogEntry {
            entry_type: AgentLogEntryType::Error,
            content: trimmed.to_string(),
            tool_name: None,
            file_path: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
        }];
    }

    // Default: plain text
    vec![AgentLogEntry {
        entry_type: AgentLogEntryType::Text,
        content: line.to_string(),
        tool_name: None,
        file_path: None,
        timestamp: chrono::Utc::now().to_rfc3339(),
    }]
}

fn parse_json_line(json: &Value) -> Vec<AgentLogEntry> {
    let mut entries = Vec::new();
    let event_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match event_type {
        "message" | "text" => {
            let content = json
                .get("content")
                .or_else(|| json.get("text"))
                .map(|v| {
                    if v.is_string() {
                        v.as_str().unwrap_or("").to_string()
                    } else {
                        v.to_string()
                    }
                })
                .unwrap_or_default();
            entries.push(AgentLogEntry {
                entry_type: AgentLogEntryType::Text,
                content,
                tool_name: None,
                file_path: None,
                timestamp: chrono::Utc::now().to_rfc3339(),
            });
        }
        "function_call" | "tool_call" => {
            let tool_name = json
                .get("name")
                .or_else(|| json.pointer("/function/name"))
                .and_then(|v| v.as_str())
                .map(String::from);
            let input = json
                .get("arguments")
                .or_else(|| json.pointer("/function/arguments"))
                .or_else(|| json.get("input"))
                .map(|v| v.to_string())
                .unwrap_or_default();
            let file_path = json
                .pointer("/arguments/file_path")
                .or_else(|| json.pointer("/input/path"))
                .and_then(|v| v.as_str())
                .map(String::from);

            entries.push(AgentLogEntry {
                entry_type: AgentLogEntryType::ToolCall,
                content: input,
                tool_name,
                file_path,
                timestamp: chrono::Utc::now().to_rfc3339(),
            });
        }
        "function_result" | "tool_result" => {
            let content = json
                .get("output")
                .or_else(|| json.get("result"))
                .map(|v| {
                    if v.is_string() {
                        v.as_str().unwrap_or("").to_string()
                    } else {
                        v.to_string()
                    }
                })
                .unwrap_or_default();
            entries.push(AgentLogEntry {
                entry_type: AgentLogEntryType::ToolResult,
                content,
                tool_name: None,
                file_path: None,
                timestamp: chrono::Utc::now().to_rfc3339(),
            });
        }
        "error" => {
            let content = json
                .get("message")
                .or_else(|| json.get("error"))
                .map(|v| {
                    if v.is_string() {
                        v.as_str().unwrap_or("").to_string()
                    } else {
                        v.to_string()
                    }
                })
                .unwrap_or_else(|| json.to_string());
            entries.push(AgentLogEntry {
                entry_type: AgentLogEntryType::Error,
                content,
                tool_name: None,
                file_path: None,
                timestamp: chrono::Utc::now().to_rfc3339(),
            });
        }
        _ => {
            // Unknown JSON: output as text
            entries.push(AgentLogEntry {
                entry_type: AgentLogEntryType::Text,
                content: json.to_string(),
                tool_name: None,
                file_path: None,
                timestamp: chrono::Utc::now().to_rfc3339(),
            });
        }
    }

    entries
}

fn extract_file_path(text: &str) -> Option<String> {
    for word in text.split_whitespace() {
        let cleaned = word.trim_matches(|c: char| c == '\'' || c == '"' || c == '`');
        if (cleaned.starts_with('/') || cleaned.starts_with("./")) && cleaned.contains('.') {
            return Some(cleaned.to_string());
        }
    }
    None
}
