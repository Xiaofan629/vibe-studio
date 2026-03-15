use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::OnceLock;

use chrono::{DateTime, Utc};
use regex::Regex;
use serde_json::Value;

use crate::{
    ContentBlock, ConversationDetail, ConversationSummary, MessageTurn, SessionStats, TurnRole,
    TurnUsage,
};

/// Regex that matches Claude Code system-injected XML tags
fn system_tag_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(concat!(
            r"(?s)",
            r"<system-reminder>.*?</system-reminder>",
            r"|<local-command-caveat>.*?</local-command-caveat>",
            r"|<command-name>.*?</command-name>",
            r"|<command-message>.*?</command-message>",
            r"|<command-args>.*?</command-args>",
            r"|<local-command-stdout>.*?</local-command-stdout>",
            r"|<user-prompt-submit-hook>.*?</user-prompt-submit-hook>",
        ))
        .unwrap()
    })
}

/// Strip system-injected XML tags from text content
fn strip_system_tags(text: &str) -> Option<String> {
    let cleaned = system_tag_regex().replace_all(text, "");
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Check if a JSONL entry is a system meta message
fn is_meta_message(value: &Value) -> bool {
    value
        .get("isMeta")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

pub fn read_claude_session_full(project_path: &str) -> Result<ConversationDetail, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let claude_dir = home.join(".claude").join("projects");

    let encoded = project_path
        .replace('/', "-")
        .replace(' ', "-")
        .replace('.', "-");
    let project_dir = claude_dir.join(&encoded);

    if !project_dir.exists() {
        eprintln!(
            "[ERROR] Project directory does not exist: {:?}",
            project_dir
        );
        return Err(format!(
            "Project directory does not exist: {:?}",
            project_dir
        ));
    }

    let mut jsonl_files: Vec<_> = fs::read_dir(&project_dir)
        .map_err(|e| {
            eprintln!("[ERROR] Failed to read project dir: {}", e);
            e.to_string()
        })?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s == "jsonl")
                .unwrap_or(false)
        })
        .collect();

    if jsonl_files.is_empty() {
        eprintln!("[ERROR] No session files found in {:?}", project_dir);
        return Err(format!("No session files found in {:?}", project_dir));
    }

    jsonl_files.sort_by_key(|e| {
        e.metadata()
            .and_then(|m| m.modified())
            .ok()
            .map(|t| std::cmp::Reverse(t))
    });

    let latest_file = &jsonl_files[0].path();
    parse_conversation_detail(latest_file, project_path)
}

fn parse_conversation_detail(
    path: &PathBuf,
    project_path: &str,
) -> Result<ConversationDetail, String> {
    let file = fs::File::open(path).map_err(|e| {
        eprintln!("[ERROR] Failed to open file: {}", e);
        e.to_string()
    })?;
    let reader = BufReader::new(file);

    let mut messages = Vec::new();
    let mut cwd: Option<String> = None;
    let mut git_branch: Option<String> = None;
    let mut model: Option<String> = None;
    let mut title: Option<String> = None;
    let mut first_timestamp: Option<DateTime<Utc>> = None;
    let mut last_timestamp: Option<DateTime<Utc>> = None;

    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.trim().is_empty() {
            continue;
        }

        let value: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;

        let msg_type = value.get("type").and_then(|t| t.as_str()).unwrap_or("");

        if msg_type == "file-history-snapshot" || msg_type == "progress" {
            continue;
        }

        if is_meta_message(&value) {
            continue;
        }

        if cwd.is_none() {
            cwd = value
                .get("cwd")
                .and_then(|s| s.as_str())
                .map(|s| s.to_string());
        }
        if git_branch.is_none() {
            git_branch = value
                .get("gitBranch")
                .and_then(|s| s.as_str())
                .map(|s| s.to_string());
        }

        if let Some(ts_str) = value.get("timestamp").and_then(|t| t.as_str()) {
            if let Ok(ts) = ts_str.parse::<DateTime<Utc>>() {
                if first_timestamp.is_none() {
                    first_timestamp = Some(ts);
                }
                last_timestamp = Some(ts);
            }
        }

        match msg_type {
            "user" => {
                let content = extract_user_content(&value);
                if content.is_empty() {
                    continue;
                }

                let timestamp = parse_timestamp(&value).unwrap_or_else(Utc::now);
                let uuid = value
                    .get("uuid")
                    .and_then(|u| u.as_str())
                    .unwrap_or("")
                    .to_string();

                if title.is_none() {
                    if let Some(first_text) = content.iter().find_map(|c| match c {
                        ContentBlock::Text { text } => Some(text.clone()),
                        _ => None,
                    }) {
                        title = Some(truncate_str(&first_text, 100));
                    }
                }

                messages.push(UnifiedMessage {
                    id: uuid,
                    role: MessageRole::User,
                    content,
                    timestamp,
                    usage: None,
                    duration_ms: None,
                    model: None,
                });
            }
            "assistant" => {
                let timestamp = parse_timestamp(&value).unwrap_or_else(Utc::now);
                let uuid = value
                    .get("uuid")
                    .and_then(|u| u.as_str())
                    .unwrap_or("")
                    .to_string();

                let msg_model = value
                    .get("message")
                    .and_then(|m| m.get("model"))
                    .and_then(|m| m.as_str())
                    .map(|s| s.to_string());

                if model.is_none() {
                    model = msg_model.clone();
                }

                let content = extract_assistant_content(&value);
                let usage = extract_usage(&value);

                messages.push(UnifiedMessage {
                    id: uuid,
                    role: MessageRole::Assistant,
                    content,
                    timestamp,
                    usage,
                    duration_ms: None,
                    model: msg_model,
                });
            }
            "system" => {
                let subtype = value.get("subtype").and_then(|s| s.as_str()).unwrap_or("");
                if subtype == "turn_duration" {
                    if let Some(duration) = value.get("durationMs").and_then(|d| d.as_u64()) {
                        if let Some(last) = messages
                            .iter_mut()
                            .rev()
                            .find(|m| matches!(m.role, MessageRole::Assistant))
                        {
                            last.duration_ms = Some(duration);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    let folder_path = cwd.clone().or_else(|| Some(project_path.to_string()));
    let folder_name = folder_path.as_ref().map(|p| folder_name_from_path(p));

    let turns = group_into_turns(messages);
    let session_stats = compute_session_stats(&turns);

    let conversation_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    let summary = ConversationSummary {
        id: conversation_id,
        folder_path,
        folder_name,
        title,
        started_at: first_timestamp.unwrap_or_else(Utc::now).to_rfc3339(),
        ended_at: last_timestamp.map(|t| t.to_rfc3339()),
        message_count: turns.len() as u32,
        model,
        git_branch,
    };

    Ok(ConversationDetail {
        summary,
        turns,
        session_stats,
    })
}

#[derive(Debug, Clone)]
enum MessageRole {
    User,
    Assistant,
    System,
}

#[derive(Debug, Clone)]
struct UnifiedMessage {
    id: String,
    role: MessageRole,
    content: Vec<ContentBlock>,
    timestamp: DateTime<Utc>,
    usage: Option<TurnUsage>,
    duration_ms: Option<u64>,
    model: Option<String>,
}

fn parse_timestamp(value: &Value) -> Option<DateTime<Utc>> {
    value
        .get("timestamp")
        .and_then(|t| t.as_str())
        .and_then(|s| s.parse::<DateTime<Utc>>().ok())
}

fn extract_user_content(value: &Value) -> Vec<ContentBlock> {
    let mut blocks = Vec::new();
    let message = match value.get("message") {
        Some(m) => m,
        None => return blocks,
    };
    let content = match message.get("content") {
        Some(c) => c,
        None => return blocks,
    };

    if let Some(text) = content.as_str() {
        if let Some(cleaned) = strip_system_tags(text) {
            blocks.push(ContentBlock::Text { text: cleaned });
        }
        return blocks;
    }

    if let Some(arr) = content.as_array() {
        for item in arr {
            let block_type = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
            match block_type {
                "text" => {
                    if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                        if let Some(cleaned) = strip_system_tags(text) {
                            blocks.push(ContentBlock::Text { text: cleaned });
                        }
                    }
                }
                "tool_result" | "server_tool_result" => {
                    let tool_use_id = item
                        .get("tool_use_id")
                        .and_then(|n| n.as_str())
                        .map(|s| s.to_string());
                    let output = extract_tool_result_text(item);
                    let is_error = item
                        .get("is_error")
                        .and_then(|e| e.as_bool())
                        .unwrap_or(false);
                    blocks.push(ContentBlock::ToolResult {
                        tool_use_id,
                        output_preview: output,
                        is_error,
                    });
                }
                _ => {}
            }
        }
    }

    blocks
}

fn extract_assistant_content(value: &Value) -> Vec<ContentBlock> {
    let mut blocks = Vec::new();
    let message = match value.get("message") {
        Some(m) => m,
        None => return blocks,
    };
    let content = match message.get("content") {
        Some(c) => c,
        None => return blocks,
    };

    if let Some(arr) = content.as_array() {
        for item in arr {
            let block_type = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
            match block_type {
                "text" => {
                    if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                        blocks.push(ContentBlock::Text {
                            text: text.to_string(),
                        });
                    }
                }
                "thinking" => {
                    if let Some(text) = item.get("thinking").and_then(|t| t.as_str()) {
                        blocks.push(ContentBlock::Thinking {
                            text: text.to_string(),
                        });
                    }
                }
                "tool_use" | "server_tool_use" => {
                    let tool_use_id = item
                        .get("id")
                        .and_then(|n| n.as_str())
                        .map(|s| s.to_string());
                    let tool_name = item
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let input_preview = item.get("input").map(|i| i.to_string());
                    blocks.push(ContentBlock::ToolUse {
                        tool_use_id,
                        tool_name,
                        input_preview,
                    });
                }
                _ => {}
            }
        }
    }

    blocks
}

fn extract_usage(value: &Value) -> Option<TurnUsage> {
    let usage = value.get("message")?.get("usage")?;
    Some(TurnUsage {
        input_tokens: usage
            .get("input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        output_tokens: usage
            .get("output_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        cache_creation_input_tokens: usage
            .get("cache_creation_input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        cache_read_input_tokens: usage
            .get("cache_read_input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
    })
}

fn extract_tool_result_text(item: &Value) -> Option<String> {
    let content = item.get("content")?;
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }
    if let Some(arr) = content.as_array() {
        let texts: Vec<String> = arr
            .iter()
            .filter_map(|c| {
                if c.get("type").and_then(|t| t.as_str()) == Some("text") {
                    c.get("text")
                        .and_then(|t| t.as_str())
                        .map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect();
        if !texts.is_empty() {
            return Some(texts.join("\n"));
        }
    }
    None
}

fn is_tool_result_only(msg: &UnifiedMessage) -> bool {
    matches!(msg.role, MessageRole::User)
        && !msg.content.is_empty()
        && msg
            .content
            .iter()
            .all(|b| matches!(b, ContentBlock::ToolResult { .. }))
}

fn group_into_turns(messages: Vec<UnifiedMessage>) -> Vec<MessageTurn> {
    let mut turns = Vec::new();
    let mut i = 0;

    while i < messages.len() {
        let msg = &messages[i];

        if matches!(msg.role, MessageRole::Assistant) {
            let mut blocks: Vec<ContentBlock> = msg.content.clone();
            let timestamp = msg.timestamp;
            let id = format!("turn-{}", turns.len());
            let usage = msg.usage.clone();
            let duration_ms = msg.duration_ms;
            let turn_model = msg.model.clone();
            i += 1;

            while i < messages.len()
                && (matches!(messages[i].role, MessageRole::Assistant)
                    || is_tool_result_only(&messages[i]))
            {
                blocks.extend(messages[i].content.clone());
                i += 1;
            }

            turns.push(MessageTurn {
                id,
                role: TurnRole::Assistant,
                blocks,
                timestamp: timestamp.to_rfc3339(),
                usage,
                duration_ms,
                model: turn_model,
            });
        } else if matches!(msg.role, MessageRole::System) {
            turns.push(MessageTurn {
                id: format!("turn-{}", turns.len()),
                role: TurnRole::System,
                blocks: msg.content.clone(),
                timestamp: msg.timestamp.to_rfc3339(),
                usage: None,
                duration_ms: None,
                model: None,
            });
            i += 1;
        } else {
            turns.push(MessageTurn {
                id: format!("turn-{}", turns.len()),
                role: TurnRole::User,
                blocks: msg.content.clone(),
                timestamp: msg.timestamp.to_rfc3339(),
                usage: None,
                duration_ms: None,
                model: None,
            });
            i += 1;
        }
    }

    turns
}

fn compute_session_stats(turns: &[MessageTurn]) -> Option<SessionStats> {
    let mut total_input = 0u64;
    let mut total_output = 0u64;
    let mut total_cache_creation = 0u64;
    let mut total_cache_read = 0u64;
    let mut total_duration = 0u64;

    for turn in turns {
        if let Some(usage) = &turn.usage {
            total_input += usage.input_tokens;
            total_output += usage.output_tokens;
            total_cache_creation += usage.cache_creation_input_tokens;
            total_cache_read += usage.cache_read_input_tokens;
        }
        if let Some(duration) = turn.duration_ms {
            total_duration += duration;
        }
    }

    let total_tokens = total_input + total_output;

    if total_tokens == 0 {
        return None;
    }

    Some(SessionStats {
        total_usage: Some(TurnUsage {
            input_tokens: total_input,
            output_tokens: total_output,
            cache_creation_input_tokens: total_cache_creation,
            cache_read_input_tokens: total_cache_read,
        }),
        total_tokens: Some(total_tokens),
        total_duration_ms: total_duration,
        context_window_used_tokens: None,
        context_window_max_tokens: None,
        context_window_usage_percent: None,
    })
}

fn truncate_str(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len.saturating_sub(3)])
    }
}

fn folder_name_from_path(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string()
}
