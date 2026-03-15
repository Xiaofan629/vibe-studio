use crate::{AgentLogEntry, AgentLogEntryType};
use serde_json::Value;

/// Parse Claude Code stream-json output line
///
/// Handles message types:
/// - `system`     : system init info (model, session)
/// - `assistant`  : assistant turn with content blocks (text, tool_use, thinking)
/// - `tool_result`: tool execution results
/// - `result`     : final result / error
pub fn parse_line(line: &str) -> Vec<AgentLogEntry> {
    let Ok(json) = serde_json::from_str::<Value>(line) else {
        // Non-JSON lines are emitted as plain text
        if !line.trim().is_empty() {
            return vec![AgentLogEntry {
                entry_type: AgentLogEntryType::Text,
                content: line.to_string(),
                tool_name: None,
                file_path: None,
                timestamp: chrono::Utc::now().to_rfc3339(),
            }];
        }
        return vec![];
    };

    let mut entries = Vec::new();
    let msg_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match msg_type {
        "system" => {
            // System init — skip entirely
        }

        "user" => {
            // User message may contain tool_result
            if let Some(content) = json.pointer("/message/content").and_then(|v| v.as_array()) {
                for block in content {
                    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    if block_type == "tool_result" {
                        let tool_use_id = block
                            .get("tool_use_id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");

                        let content_text =
                            if let Some(text) = block.get("content").and_then(|v| v.as_str()) {
                                text.to_string()
                            } else if let Some(content_arr) =
                                block.get("content").and_then(|v| v.as_array())
                            {
                                content_arr
                                    .iter()
                                    .filter_map(|b| {
                                        if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                                            b.get("text").and_then(|t| t.as_str()).map(String::from)
                                        } else {
                                            Some(b.to_string())
                                        }
                                    })
                                    .collect::<Vec<_>>()
                                    .join("\n")
                            } else {
                                String::new()
                            };

                        let is_error = block
                            .get("is_error")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);

                        if !content_text.is_empty() {
                            entries.push(AgentLogEntry {
                                entry_type: if is_error {
                                    AgentLogEntryType::Error
                                } else {
                                    AgentLogEntryType::ToolResult
                                },
                                content: truncate_content(&content_text, 2000),
                                tool_name: Some(format!("result:{}", tool_use_id)),
                                file_path: None,
                                timestamp: chrono::Utc::now().to_rfc3339(),
                            });
                        }
                    }
                }
            }
        }

        "assistant" => {
            if let Some(content) = json.pointer("/message/content").and_then(|v| v.as_array()) {
                for block in content {
                    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    match block_type {
                        "text" => {
                            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                if !text.trim().is_empty() {
                                    entries.push(AgentLogEntry {
                                        entry_type: AgentLogEntryType::Text,
                                        content: text.to_string(),
                                        tool_name: None,
                                        file_path: None,
                                        timestamp: chrono::Utc::now().to_rfc3339(),
                                    });
                                }
                            }
                        }
                        "tool_use" => {
                            let tool_name =
                                block.get("name").and_then(|v| v.as_str()).map(String::from);
                            let input = block
                                .get("input")
                                .map(|v| v.to_string())
                                .unwrap_or_default();
                            let file_path = block
                                .pointer("/input/file_path")
                                .or_else(|| block.pointer("/input/path"))
                                .or_else(|| block.pointer("/input/command"))
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
                        "thinking" => {
                            if let Some(text) = block.get("thinking").and_then(|v| v.as_str()) {
                                if !text.trim().is_empty() {
                                    entries.push(AgentLogEntry {
                                        entry_type: AgentLogEntryType::Thinking,
                                        content: text.to_string(),
                                        tool_name: None,
                                        file_path: None,
                                        timestamp: chrono::Utc::now().to_rfc3339(),
                                    });
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }

        "result" => {
            let subtype = json
                .get("subtype")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");

            // Only emit for errors — success results duplicate the assistant message
            if subtype == "error" {
                let result_text = json
                    .get("result")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Agent finished with error");

                entries.push(AgentLogEntry {
                    entry_type: AgentLogEntryType::Error,
                    content: result_text.to_string(),
                    tool_name: Some("result".to_string()),
                    file_path: None,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                });
            }
            // Success results are intentionally skipped to avoid duplication
        }

        _ => {}
    }

    entries
}

/// Truncate content to a max character length, adding an ellipsis indicator
fn truncate_content(content: &str, max_len: usize) -> String {
    if content.len() <= max_len {
        content.to_string()
    } else {
        let truncated = &content[..max_len];
        format!(
            "{}...\n\n[truncated, {} total chars]",
            truncated,
            content.len()
        )
    }
}
