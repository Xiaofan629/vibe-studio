use crate::{AgentLogEntry, AgentLogEntryType};
use serde_json::Value;

/// Parse Gemini CLI output line.
///
/// Gemini CLI can output:
/// - Plain text/markdown for conversational responses
/// - JSON objects for structured events (tool calls, results)
/// - Lines prefixed with special markers for file operations
pub fn parse_line(line: &str) -> Vec<AgentLogEntry> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return vec![];
    }

    // Try parsing as JSON first (Gemini may emit structured output)
    if let Ok(json) = serde_json::from_str::<Value>(trimmed) {
        return parse_json_line(&json);
    }

    // Detect tool call patterns in text output
    // Gemini CLI often outputs lines like "Using tool: Read file /path/to/file"
    if let Some(tool_info) = trimmed.strip_prefix("Using tool: ") {
        let (tool_name, file_path) = parse_tool_indicator(tool_info);
        return vec![AgentLogEntry {
            entry_type: AgentLogEntryType::ToolCall,
            content: tool_info.to_string(),
            tool_name: Some(tool_name),
            file_path,
            timestamp: chrono::Utc::now().to_rfc3339(),
        }];
    }

    // Detect file operation patterns
    if trimmed.starts_with("Reading ")
        || trimmed.starts_with("Writing ")
        || trimmed.starts_with("Editing ")
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

    // Handle structured tool call events
    if let Some(tool_name) = json.get("tool").and_then(|v| v.as_str()) {
        let file_path = json
            .pointer("/input/file_path")
            .or_else(|| json.pointer("/input/path"))
            .and_then(|v| v.as_str())
            .map(String::from);

        entries.push(AgentLogEntry {
            entry_type: AgentLogEntryType::ToolCall,
            content: json.get("input").map(|v| v.to_string()).unwrap_or_default(),
            tool_name: Some(tool_name.to_string()),
            file_path,
            timestamp: chrono::Utc::now().to_rfc3339(),
        });
        return entries;
    }

    // Handle tool result events
    if json.get("result").is_some() || json.get("output").is_some() {
        let content = json
            .get("result")
            .or_else(|| json.get("output"))
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
        return entries;
    }

    // Handle text content
    if let Some(text) = json.get("text").and_then(|v| v.as_str()) {
        entries.push(AgentLogEntry {
            entry_type: AgentLogEntryType::Text,
            content: text.to_string(),
            tool_name: None,
            file_path: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
        });
        return entries;
    }

    // Fallback: dump the JSON as text
    entries.push(AgentLogEntry {
        entry_type: AgentLogEntryType::Text,
        content: json.to_string(),
        tool_name: None,
        file_path: None,
        timestamp: chrono::Utc::now().to_rfc3339(),
    });
    entries
}

fn parse_tool_indicator(info: &str) -> (String, Option<String>) {
    // "Read file /path/to/file" → ("Read file", Some("/path/to/file"))
    let parts: Vec<&str> = info.splitn(2, ' ').collect();
    if parts.len() == 2 {
        let path = extract_file_path(parts[1]);
        (parts[0].to_string(), path)
    } else {
        (info.to_string(), None)
    }
}

fn extract_file_path(text: &str) -> Option<String> {
    // Look for file path patterns like /foo/bar.rs or ./foo/bar.rs
    for word in text.split_whitespace() {
        let cleaned = word.trim_matches(|c: char| c == '\'' || c == '"' || c == '`');
        if (cleaned.starts_with('/') || cleaned.starts_with("./")) && cleaned.contains('.') {
            return Some(cleaned.to_string());
        }
    }
    None
}
