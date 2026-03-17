use crate::{AgentLogEntry, AgentLogEntryType};
use serde_json::Value;

fn is_ignorable_gemini_text_line(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.is_empty()
        || trimmed == "undefined"
        || trimmed == "null"
        || trimmed == "YOLO mode is enabled. All tool calls will be automatically approved."
        || trimmed == "Server 'mcpServers' supports tool updates. Listening for changes..."
        || trimmed.contains("Failed to connect to IDE companion extension")
}

pub fn should_ignore_stderr_line(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.is_empty()
        || trimmed == "YOLO mode is enabled. All tool calls will be automatically approved."
        || trimmed == "Server 'mcpServers' supports tool updates. Listening for changes..."
        || trimmed.contains("Failed to connect to IDE companion extension")
}

/// Parse Gemini CLI output line.
///
/// Gemini CLI can output:
/// - Plain text/markdown for conversational responses
/// - JSON objects for structured events (tool calls, results)
/// - Lines prefixed with special markers for file operations
pub fn parse_line(line: &str) -> Vec<AgentLogEntry> {
    let trimmed = line.trim();
    if is_ignorable_gemini_text_line(trimmed) {
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
    let timestamp = json
        .get("timestamp")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    if let Some(event_type) = json.get("type").and_then(|v| v.as_str()) {
        match event_type {
            "init" => return vec![],
            "message" => {
                let role = json.get("role").and_then(|v| v.as_str()).unwrap_or("");
                if role == "user" {
                    return vec![];
                }

                if role == "assistant" {
                    let content = json
                        .get("content")
                        .and_then(|v| v.as_str())
                        .map(str::to_string)
                        .unwrap_or_default();

                    if is_ignorable_gemini_text_line(&content) {
                        return vec![];
                    }

                    entries.push(AgentLogEntry {
                        entry_type: AgentLogEntryType::Text,
                        content,
                        tool_name: None,
                        file_path: None,
                        timestamp,
                    });
                    return entries;
                }
            }
            "tool_use" => {
                let tool_name = json
                    .get("tool_name")
                    .or_else(|| json.get("tool"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let file_path = json
                    .pointer("/parameters/file_path")
                    .or_else(|| json.pointer("/parameters/path"))
                    .or_else(|| json.pointer("/parameters/command"))
                    .and_then(|v| v.as_str())
                    .map(String::from);

                entries.push(AgentLogEntry {
                    entry_type: AgentLogEntryType::ToolCall,
                    content: json
                        .get("parameters")
                        .map(|v| v.to_string())
                        .unwrap_or_default(),
                    tool_name: Some(tool_name),
                    file_path,
                    timestamp,
                });
                return entries;
            }
            "tool_result" => {
                let status = json.get("status").and_then(|v| v.as_str()).unwrap_or("");
                let content = json
                    .get("output")
                    .or_else(|| json.get("result"))
                    .map(|v| {
                        if let Some(text) = v.as_str() {
                            text.to_string()
                        } else {
                            v.to_string()
                        }
                    })
                    .unwrap_or_default();

                if content.trim().is_empty() && status.eq_ignore_ascii_case("success") {
                    return vec![];
                }

                entries.push(AgentLogEntry {
                    entry_type: if status.eq_ignore_ascii_case("success") {
                        AgentLogEntryType::ToolResult
                    } else {
                        AgentLogEntryType::Error
                    },
                    content,
                    tool_name: None,
                    file_path: None,
                    timestamp,
                });
                return entries;
            }
            "result" => {
                let status = json.get("status").and_then(|v| v.as_str()).unwrap_or("");
                if status.eq_ignore_ascii_case("success") {
                    return vec![];
                }

                entries.push(AgentLogEntry {
                    entry_type: AgentLogEntryType::Error,
                    content: json.to_string(),
                    tool_name: None,
                    file_path: None,
                    timestamp,
                });
                return entries;
            }
            _ => {}
        }
    }

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
            timestamp,
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
            timestamp,
        });
        return entries;
    }

    // Handle text content
    if let Some(text) = json.get("text").and_then(|v| v.as_str()) {
        if is_ignorable_gemini_text_line(text) {
            return vec![];
        }
        entries.push(AgentLogEntry {
            entry_type: AgentLogEntryType::Text,
            content: text.to_string(),
            tool_name: None,
            file_path: None,
            timestamp,
        });
        return entries;
    }

    // Fallback: dump the JSON as text
    entries.push(AgentLogEntry {
        entry_type: AgentLogEntryType::Text,
        content: json.to_string(),
        tool_name: None,
        file_path: None,
        timestamp,
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

#[cfg(test)]
mod tests {
    use super::{parse_line, should_ignore_stderr_line};
    use crate::AgentLogEntryType;

    #[test]
    fn parses_stream_json_message_and_tool_events() {
        let assistant = parse_line(
            r#"{"type":"message","timestamp":"2026-03-16T18:38:48.906Z","role":"assistant","content":"hello","delta":true}"#,
        );
        assert_eq!(assistant.len(), 1);
        assert!(matches!(assistant[0].entry_type, AgentLogEntryType::Text));
        assert_eq!(assistant[0].content, "hello");

        let tool_use = parse_line(
            r#"{"type":"tool_use","timestamp":"2026-03-16T18:39:30.709Z","tool_name":"run_shell_command","tool_id":"abc","parameters":{"command":"pwd","description":"Print pwd"}}"#,
        );
        assert_eq!(tool_use.len(), 1);
        assert!(matches!(
            tool_use[0].entry_type,
            AgentLogEntryType::ToolCall
        ));
        assert_eq!(tool_use[0].tool_name.as_deref(), Some("run_shell_command"));

        let tool_result = parse_line(
            r#"{"type":"tool_result","timestamp":"2026-03-16T18:39:31.113Z","tool_id":"abc","status":"success","output":"/tmp/demo"}"#,
        );
        assert_eq!(tool_result.len(), 1);
        assert!(matches!(
            tool_result[0].entry_type,
            AgentLogEntryType::ToolResult
        ));
        assert_eq!(tool_result[0].content, "/tmp/demo");
    }

    #[test]
    fn ignores_gemini_startup_noise() {
        assert!(
            parse_line("Server 'mcpServers' supports tool updates. Listening for changes...")
                .is_empty()
        );
        assert!(
            parse_line("[ERROR] [IDEClient] Failed to connect to IDE companion extension.")
                .is_empty()
        );
        assert!(should_ignore_stderr_line(
            "[ERROR] [IDEClient] Failed to connect to IDE companion extension."
        ));
    }
}
