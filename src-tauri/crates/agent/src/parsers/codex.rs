use crate::{AgentLogEntry, AgentLogEntryType};
use serde_json::Value;

fn is_placeholder_text(text: &str) -> bool {
    matches!(text.trim(), "" | "undefined" | "null")
}

/// Parse Codex CLI output line.
///
/// Codex CLI can output:
/// - JSON objects for structured events (similar to Claude's stream-json)
/// - Plain text for conversational responses
/// - Lines with special prefixes for tool operations
pub fn parse_line(line: &str) -> Vec<AgentLogEntry> {
    let trimmed = line.trim();
    if is_placeholder_text(trimmed) {
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
    let event_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match event_type {
        "message" | "text" => build_text_entry(
            json.get("content").or_else(|| json.get("text")),
            timestamp_from_json(json),
        )
        .into_iter()
        .collect(),
        "function_call" | "tool_call" => parse_tool_call(json, timestamp_from_json(json)),
        "function_result" | "tool_result" => {
            parse_tool_result(json, false, timestamp_from_json(json))
        }
        "error" => parse_error_entry(
            json.get("message").or_else(|| json.get("error")),
            timestamp_from_json(json),
        )
        .into_iter()
        .collect(),
        "event_msg" => parse_event_payload(json.get("payload"), timestamp_from_json(json)),
        "item.completed" | "item.started" | "item.updated" => {
            parse_item_payload(json.get("item"), timestamp_from_json(json))
        }
        "thread.started" | "turn.started" | "turn.completed" => vec![],
        _ => vec![],
    }
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

fn timestamp_from_json(json: &Value) -> String {
    json.get("timestamp")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339())
}

fn value_to_string(value: Option<&Value>) -> String {
    value
        .map(|v| {
            if v.is_string() {
                v.as_str().unwrap_or("").to_string()
            } else {
                v.to_string()
            }
        })
        .unwrap_or_default()
}

fn build_text_entry(value: Option<&Value>, timestamp: String) -> Option<AgentLogEntry> {
    let content = value_to_string(value);
    if is_placeholder_text(&content) {
        return None;
    }

    Some(AgentLogEntry {
        entry_type: AgentLogEntryType::Text,
        content,
        tool_name: None,
        file_path: None,
        timestamp,
    })
}

fn parse_error_entry(value: Option<&Value>, timestamp: String) -> Option<AgentLogEntry> {
    let content = value_to_string(value);
    if content.trim().is_empty() {
        return None;
    }

    Some(AgentLogEntry {
        entry_type: AgentLogEntryType::Error,
        content,
        tool_name: None,
        file_path: None,
        timestamp,
    })
}

fn parse_tool_call(json: &Value, timestamp: String) -> Vec<AgentLogEntry> {
    let tool_name = json
        .get("name")
        .or_else(|| json.pointer("/function/name"))
        .or_else(|| json.get("tool_name"))
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
        .or_else(|| json.get("path"))
        .and_then(|v| v.as_str())
        .map(String::from);

    if input.trim().is_empty() && tool_name.is_none() && file_path.is_none() {
        return vec![];
    }

    vec![AgentLogEntry {
        entry_type: AgentLogEntryType::ToolCall,
        content: input,
        tool_name,
        file_path,
        timestamp,
    }]
}

fn parse_tool_result(json: &Value, is_error: bool, timestamp: String) -> Vec<AgentLogEntry> {
    let content = json
        .get("output")
        .or_else(|| json.get("result"))
        .or_else(|| json.get("content"))
        .map(|v| {
            if v.is_string() {
                v.as_str().unwrap_or("").to_string()
            } else {
                v.to_string()
            }
        })
        .unwrap_or_default();

    if content.trim().is_empty() {
        return vec![];
    }

    vec![AgentLogEntry {
        entry_type: if is_error {
            AgentLogEntryType::Error
        } else {
            AgentLogEntryType::ToolResult
        },
        content,
        tool_name: None,
        file_path: None,
        timestamp,
    }]
}

fn parse_event_payload(payload: Option<&Value>, timestamp: String) -> Vec<AgentLogEntry> {
    let Some(payload) = payload else {
        return vec![];
    };

    let payload_type = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match payload_type {
        "agent_message" => build_text_entry(
            payload.get("message").or_else(|| payload.get("text")),
            timestamp,
        )
        .into_iter()
        .collect(),
        "agent_reasoning" => {
            let text = value_to_string(payload.get("text"));
            if text.trim().is_empty() {
                vec![]
            } else {
                vec![AgentLogEntry {
                    entry_type: AgentLogEntryType::Thinking,
                    content: text,
                    tool_name: None,
                    file_path: None,
                    timestamp,
                }]
            }
        }
        "function_call" | "custom_tool_call" => parse_tool_call(payload, timestamp),
        "function_call_output" | "custom_tool_call_output" => {
            parse_tool_result(payload, false, timestamp)
        }
        "error" => parse_error_entry(
            payload.get("message").or_else(|| payload.get("error")),
            timestamp,
        )
        .into_iter()
        .collect(),
        _ => vec![],
    }
}

fn parse_item_payload(item: Option<&Value>, timestamp: String) -> Vec<AgentLogEntry> {
    let Some(item) = item else {
        return vec![];
    };

    let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match item_type {
        "agent_message" => {
            build_text_entry(item.get("text").or_else(|| item.get("message")), timestamp)
                .into_iter()
                .collect()
        }
        "agent_reasoning" => {
            let text = value_to_string(item.get("text"));
            if text.trim().is_empty() {
                vec![]
            } else {
                vec![AgentLogEntry {
                    entry_type: AgentLogEntryType::Thinking,
                    content: text,
                    tool_name: None,
                    file_path: None,
                    timestamp,
                }]
            }
        }
        "function_call" | "custom_tool_call" | "tool_call" => parse_tool_call(item, timestamp),
        "function_call_output" | "custom_tool_call_output" | "tool_result" => {
            let is_error = item
                .get("is_error")
                .or_else(|| item.get("isError"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            parse_tool_result(item, is_error, timestamp)
        }
        "error" => parse_error_entry(
            item.get("message")
                .or_else(|| item.get("text"))
                .or_else(|| item.get("error")),
            timestamp,
        )
        .into_iter()
        .collect(),
        _ => vec![],
    }
}
