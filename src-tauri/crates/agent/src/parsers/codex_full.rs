use crate::{
    ContentBlock, ConversationDetail, ConversationSummary, MessageTurn, SessionStats, TurnRole,
    TurnUsage,
};
use chrono::{DateTime, Utc};
use regex::Regex;
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use walkdir::WalkDir;

/// 中间类型：用于解析过程的内部表示
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MessageRole {
    User,
    Assistant,
    System,
    Tool,
}

#[derive(Debug, Clone)]
struct UnifiedMessage {
    id: String,
    role: MessageRole,
    content: Vec<ContentBlockInternal>,
    timestamp: DateTime<Utc>,
    usage: Option<TurnUsage>,
    duration_ms: Option<u64>,
    model: Option<String>,
}

/// 内部 ContentBlock，使用 snake_case 字段名
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ContentBlockInternal {
    Text {
        text: String,
    },
    Image {
        data: String,
        mime_type: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        uri: Option<String>,
    },
    ToolUse {
        tool_use_id: Option<String>,
        tool_name: String,
        input_preview: Option<String>,
    },
    ToolResult {
        tool_use_id: Option<String>,
        output_preview: Option<String>,
        is_error: bool,
    },
    Thinking {
        text: String,
    },
}

/// 解析 Codex 历史记录目录结构
///
/// Codex 会话存储在 ~/.codex/sessions/YYYY/MM/DD/ 目录
/// 文件名格式：rollout-YYYY-MM-DDTHH-MM-SS-<uuid>.jsonl
pub fn resolve_codex_home_dir() -> PathBuf {
    resolve_codex_home_dir_from(std::env::var_os("CODEX_HOME"), dirs::home_dir())
}

fn resolve_codex_home_dir_from(
    codex_home_env: Option<std::ffi::OsString>,
    home_dir: Option<PathBuf>,
) -> PathBuf {
    codex_home_env
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir.unwrap_or_default().join(".codex"))
}

/// 从工作目录路径找到对应的 Codex 会话文件
pub fn find_codex_session_for_dir(project_path: &Path) -> Option<PathBuf> {
    let sessions_dir = resolve_codex_home_dir().join("sessions");
    if !sessions_dir.exists() {
        return None;
    }

    // 获取项目路径的规范化绝对路径
    let normalized_path = match fs::canonicalize(project_path) {
        Ok(p) => p,
        Err(_) => return None,
    };
    let normalized_path_str = normalized_path.to_string_lossy().to_lowercase();

    // 使用 WalkDir 遍历所有会话文件
    for entry in WalkDir::new(&sessions_dir)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let fname = path.file_name().unwrap_or_default().to_string_lossy();
        if !fname.starts_with("rollout-") {
            continue;
        }

        // 快速检查文件内容看是否包含目标路径
        if let Ok(session_info) = parse_codex_session_info(&path) {
            if let Some(cwd) = &session_info.cwd {
                let normalized_cwd = match fs::canonicalize(Path::new(cwd)) {
                    Ok(p) => p.to_string_lossy().to_lowercase(),
                    Err(_) => cwd.to_lowercase(),
                };

                if normalized_cwd == normalized_path_str
                    || cwd == project_path.to_string_lossy().as_ref()
                {
                    return Some(path.to_path_buf());
                }
            }
        }
    }

    None
}

/// 读取 Codex 会话的完整数据
pub fn read_codex_session_full(workspace_path: &Path) -> Result<ConversationDetail, String> {
    match find_codex_session_for_dir(workspace_path) {
        Some(session_file) => parse_codex_session_full(&session_file),
        None => {
            // 没有找到历史记录，返回空会话（正常情况）
            Ok(create_empty_conversation(workspace_path))
        }
    }
}

/// 创建一个空的会话记录（当没有历史记录时）
fn create_empty_conversation(workspace_path: &Path) -> ConversationDetail {
    let folder_path = workspace_path.to_string_lossy().to_string();
    let folder_name = folder_name_from_path(&folder_path);
    let now = Utc::now();

    ConversationDetail {
        summary: ConversationSummary {
            id: format!("empty-{}", now.timestamp()),
            folder_path: Some(folder_path),
            folder_name: Some(folder_name),
            title: None,
            started_at: now.to_rfc3339(),
            ended_at: None,
            message_count: 0,
            model: None,
            git_branch: None,
        },
        turns: Vec::new(),
        session_stats: None,
    }
}

/// 解析 Codex JSONL 会话文件
pub fn parse_codex_session_full(session_file: &Path) -> Result<ConversationDetail, String> {
    let file =
        fs::File::open(session_file).map_err(|e| format!("Failed to open session file: {}", e))?;

    let reader = BufReader::new(file);

    let mut messages: Vec<UnifiedMessage> = Vec::new();
    let mut cwd: Option<String> = None;
    let mut git_branch: Option<String> = None;
    let mut model: Option<String> = None;
    let mut title: Option<String> = None;
    let mut last_turn_context_ts: Option<DateTime<Utc>> = None;
    let mut context_window_used_tokens: Option<u64> = None;
    let mut context_window_max_tokens: Option<u64> = None;
    let mut latest_total_usage: Option<TurnUsage> = None;
    let mut latest_total_tokens: Option<u64> = None;

    let mut first_timestamp: Option<DateTime<Utc>> = None;
    let mut last_timestamp: Option<DateTime<Utc>> = None;

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read line: {}", e))?;
        if line.trim().is_empty() {
            continue;
        }

        let value: Value =
            serde_json::from_str(&line).map_err(|e| format!("Failed to parse JSON: {}", e))?;

        let timestamp = value
            .get("timestamp")
            .and_then(|t| t.as_str())
            .and_then(|t| t.parse::<DateTime<Utc>>().ok());

        if let Some(ts) = timestamp {
            if first_timestamp.is_none() {
                first_timestamp = Some(ts);
            }
            last_timestamp = Some(ts);
        }

        let event_type = value.get("type").and_then(|t| t.as_str()).unwrap_or("");

        match event_type {
            "session_meta" => {
                if let Some(payload) = value.get("payload") {
                    cwd = payload
                        .get("cwd")
                        .and_then(|s| s.as_str())
                        .map(|s| s.to_string());
                    git_branch = payload
                        .get("git")
                        .and_then(|g| g.get("branch"))
                        .and_then(|b| b.as_str())
                        .map(|s| s.to_string());
                }
            }
            "turn_context" => {
                if model.is_none() {
                    model = value
                        .get("payload")
                        .and_then(|p| p.get("model"))
                        .and_then(|m| m.as_str())
                        .map(|s| s.to_string());
                }
                last_turn_context_ts = timestamp;
            }
            "event_msg" => {
                if let Some(payload) = value.get("payload") {
                    let payload_type = payload.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    let ts = timestamp.unwrap_or_else(Utc::now);

                    match payload_type {
                        "task_started" => {
                            if context_window_max_tokens.is_none() {
                                context_window_max_tokens =
                                    payload.get("model_context_window").and_then(|v| v.as_u64());
                            }
                        }
                        "user_message" => {
                            let text = payload
                                .get("message")
                                .and_then(|m| m.as_str())
                                .unwrap_or("")
                                .to_string();
                            let normalized = strip_blocked_resource_mentions(&text);
                            let mut blocks: Vec<ContentBlockInternal> = Vec::new();
                            if !normalized.is_empty() {
                                blocks.push(ContentBlockInternal::Text { text: normalized });
                            }

                            if let Some(images) = payload.get("images").and_then(|v| v.as_array()) {
                                for image in images {
                                    let Some(raw) = image.as_str() else {
                                        continue;
                                    };
                                    let Some((mime_type, data)) = parse_data_uri_image(raw) else {
                                        continue;
                                    };
                                    blocks.push(ContentBlockInternal::Image {
                                        data,
                                        mime_type,
                                        uri: None,
                                    });
                                }
                            }

                            if blocks.is_empty() {
                                blocks.push(ContentBlockInternal::Text {
                                    text: "Attached resources".to_string(),
                                });
                            }

                            if title.is_none() {
                                title = extract_codex_title_candidate(&text, true);
                            }

                            if should_skip_duplicate_user_message(&messages, &blocks, ts) {
                                continue;
                            }

                            messages.push(UnifiedMessage {
                                id: format!("user-{}", messages.len()),
                                role: MessageRole::User,
                                content: blocks,
                                timestamp: ts,
                                usage: None,
                                duration_ms: None,
                                model: None,
                            });
                        }
                        "agent_message" => {
                            let text = payload
                                .get("message")
                                .and_then(|m| m.as_str())
                                .unwrap_or("")
                                .to_string();
                            messages.push(UnifiedMessage {
                                id: format!("assistant-{}", messages.len()),
                                role: MessageRole::Assistant,
                                content: vec![ContentBlockInternal::Text { text }],
                                timestamp: ts,
                                usage: None,
                                duration_ms: None,
                                model: None,
                            });
                        }
                        "agent_reasoning" => {
                            let text = payload
                                .get("text")
                                .and_then(|t| t.as_str())
                                .unwrap_or("")
                                .to_string();
                            if !text.is_empty() {
                                messages.push(UnifiedMessage {
                                    id: format!("thinking-{}", messages.len()),
                                    role: MessageRole::Assistant,
                                    content: vec![ContentBlockInternal::Thinking { text }],
                                    timestamp: ts,
                                    usage: None,
                                    duration_ms: None,
                                    model: None,
                                });
                            }
                        }
                        "token_count" => {
                            if let Some(info) = payload.get("info") {
                                if let Some(total_usage_payload) = info.get("total_token_usage") {
                                    if let Some(total_usage) =
                                        extract_turn_usage_from_codex_usage(total_usage_payload)
                                    {
                                        latest_total_usage = Some(total_usage);
                                    }
                                    if let Some(total_tokens) =
                                        extract_total_tokens_from_usage(total_usage_payload)
                                    {
                                        latest_total_tokens = Some(total_tokens);
                                    }
                                }

                                let total_tokens =
                                    extract_context_window_used_tokens_from_token_count_info(info);
                                if total_tokens.is_some() {
                                    context_window_used_tokens = total_tokens;
                                }

                                let context_window =
                                    info.get("model_context_window").and_then(|v| v.as_u64());
                                if context_window.is_some() {
                                    context_window_max_tokens = context_window;
                                }

                                if !info.is_null() {
                                    if let Some(usage) = info
                                        .get("last_token_usage")
                                        .and_then(extract_turn_usage_from_codex_usage)
                                    {
                                        // Attach to the last assistant message
                                        if let Some(last_msg) = messages
                                            .iter_mut()
                                            .rev()
                                            .find(|m| matches!(m.role, MessageRole::Assistant))
                                        {
                                            if last_msg.usage.is_none() {
                                                last_msg.usage = Some(usage);
                                            }
                                        }
                                    }
                                }
                            }
                            // Compute duration from turn_context to token_count
                            if let (Some(start_ts), Some(end_ts)) =
                                (last_turn_context_ts, timestamp)
                            {
                                let duration = (end_ts - start_ts).num_milliseconds();
                                if duration > 0 {
                                    if let Some(last_msg) = messages
                                        .iter_mut()
                                        .rev()
                                        .find(|m| matches!(m.role, MessageRole::Assistant))
                                    {
                                        if last_msg.duration_ms.is_none() {
                                            last_msg.duration_ms = Some(duration as u64);
                                        }
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            "response_item" => {
                if let Some(payload) = value.get("payload") {
                    let payload_type = payload.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    let ts = timestamp.unwrap_or_else(Utc::now);

                    match payload_type {
                        "function_call" | "custom_tool_call" => {
                            let tool_use_id = payload
                                .get("call_id")
                                .or_else(|| payload.get("tool_call_id"))
                                .or_else(|| payload.get("id"))
                                .and_then(|id| id.as_str())
                                .map(|s| s.to_string());
                            let tool_name = payload
                                .get("name")
                                .or_else(|| payload.get("tool_name"))
                                .and_then(|n| n.as_str())
                                .unwrap_or("unknown")
                                .to_string();
                            let input_preview = value_to_preview(
                                payload.get("arguments").or_else(|| payload.get("input")),
                            );
                            messages.push(UnifiedMessage {
                                id: format!("tool-{}", messages.len()),
                                role: MessageRole::Assistant,
                                content: vec![ContentBlockInternal::ToolUse {
                                    tool_use_id,
                                    tool_name,
                                    input_preview,
                                }],
                                timestamp: ts,
                                usage: None,
                                duration_ms: None,
                                model: None,
                            });
                        }
                        "function_call_output" | "custom_tool_call_output" => {
                            let tool_use_id = payload
                                .get("call_id")
                                .or_else(|| payload.get("tool_call_id"))
                                .or_else(|| payload.get("id"))
                                .and_then(|id| id.as_str())
                                .map(|s| s.to_string());
                            let output_value = payload.get("output");
                            let output = value_to_preview(output_value);
                            let is_error = infer_tool_call_output_is_error(
                                payload,
                                output_value,
                                output.as_deref(),
                            );
                            messages.push(UnifiedMessage {
                                id: format!("tool-result-{}", messages.len()),
                                role: MessageRole::Tool,
                                content: vec![ContentBlockInternal::ToolResult {
                                    tool_use_id,
                                    output_preview: output,
                                    is_error,
                                }],
                                timestamp: ts,
                                usage: None,
                                duration_ms: None,
                                model: None,
                            });
                        }
                        "message" => {
                            let role = payload.get("role").and_then(|r| r.as_str()).unwrap_or("");
                            if role == "user" {
                                if let Some(blocks) =
                                    extract_response_item_user_image_blocks(payload)
                                {
                                    if should_skip_duplicate_user_message(&messages, &blocks, ts) {
                                        continue;
                                    }

                                    if title.is_none() {
                                        if let Some(text) = first_text_block(&blocks) {
                                            title =
                                                extract_codex_title_candidate(text.as_str(), true);
                                        }
                                    }

                                    messages.push(UnifiedMessage {
                                        id: format!("user-{}", messages.len()),
                                        role: MessageRole::User,
                                        content: blocks,
                                        timestamp: ts,
                                        usage: None,
                                        duration_ms: None,
                                        model: None,
                                    });
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }

    let folder_path = cwd.clone();
    let folder_name = folder_path.as_ref().map(|p| folder_name_from_path(p));

    let turns = group_into_turns(messages);
    let mut session_stats = compute_session_stats(&turns);
    session_stats =
        merge_codex_total_usage_stats(session_stats, latest_total_usage, latest_total_tokens);
    session_stats = merge_codex_context_window_stats(
        session_stats,
        context_window_used_tokens,
        context_window_max_tokens,
        model.clone(),
    );

    let summary = ConversationSummary {
        id: session_file
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        folder_path,
        folder_name,
        title,
        started_at: first_timestamp.unwrap_or_else(|| Utc::now()).to_rfc3339(),
        ended_at: last_timestamp.map(|ts| ts.to_rfc3339()),
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

/// 计算 session 统计信息
fn compute_session_stats(turns: &[MessageTurn]) -> Option<SessionStats> {
    if turns.is_empty() {
        return None;
    }

    let total_usage: Option<TurnUsage> =
        turns
            .iter()
            .filter_map(|t| t.usage.clone())
            .fold(None, |acc, usage| {
                Some(acc.map_or_else(
                    || usage.clone(),
                    |a: TurnUsage| {
                        TurnUsage {
                            input_tokens: a.input_tokens.saturating_add(usage.input_tokens),
                            output_tokens: a.output_tokens.saturating_add(usage.output_tokens),
                            cache_creation_input_tokens: a
                                .cache_creation_input_tokens
                                .saturating_add(usage.cache_creation_input_tokens),
                            cache_read_input_tokens: a
                                .cache_read_input_tokens
                                .saturating_add(usage.cache_read_input_tokens),
                        }
                    },
                ))
            });

    let total_tokens = total_usage.as_ref().map(|u| {
        u.input_tokens
            .saturating_add(u.output_tokens)
            .saturating_add(u.cache_read_input_tokens)
    });

    let total_duration_ms: u64 = turns.iter().filter_map(|t| t.duration_ms).sum();

    Some(SessionStats {
        total_usage,
        total_tokens,
        total_duration_ms,
        context_window_used_tokens: None,
        context_window_max_tokens: None,
        context_window_usage_percent: None,
        model: None,
    })
}

/// 解析 Codex 会话基本信息（用于快速匹配）
struct CodexSessionInfo {
    cwd: Option<String>,
    model: Option<String>,
    title: Option<String>,
}

fn parse_codex_session_info(path: &Path) -> Result<CodexSessionInfo, String> {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => {
            return Ok(CodexSessionInfo {
                cwd: None,
                model: None,
                title: None,
            })
        }
    };

    let reader = BufReader::new(file);

    let mut cwd: Option<String> = None;

    for line in reader.lines().take(50) {
        // 只读取前50行应该足够获取基本信息
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }

        let value: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let event_type = value.get("type").and_then(|t| t.as_str()).unwrap_or("");

        if event_type == "session_meta" {
            if let Some(payload) = value.get("payload") {
                cwd = payload
                    .get("cwd")
                    .and_then(|c| c.as_str())
                    .map(|s| s.to_string());
                // 获取到 cwd 后就可以停止了
                break;
            }
        }
    }

    Ok(CodexSessionInfo {
        cwd,
        model: None,
        title: None,
    })
}

// ==================== Helper Functions from codeg ====================

fn value_to_preview(value: Option<&Value>) -> Option<String> {
    let v = value?;
    if v.is_null() {
        return None;
    }
    if let Some(s) = v.as_str() {
        return Some(s.to_string());
    }
    serde_json::to_string(v).ok()
}

fn is_failed_status(status: &str) -> bool {
    let status = status.trim();
    status.eq_ignore_ascii_case("error")
        || status.eq_ignore_ascii_case("failed")
        || status.eq_ignore_ascii_case("failure")
        || status.eq_ignore_ascii_case("cancelled")
        || status.eq_ignore_ascii_case("canceled")
}

fn parse_nonzero_exit_code_from_line(line: &str) -> Option<i64> {
    let trimmed = line.trim();
    let (label, rest) = trimmed.split_once(':')?;
    if !label.trim_end().eq_ignore_ascii_case("exit code") {
        return None;
    }
    let number_text = rest.split_whitespace().next()?;
    let code = number_text.parse::<i64>().ok()?;
    if code == 0 {
        None
    } else {
        Some(code)
    }
}

fn infer_output_text_is_error(text: &str) -> bool {
    for line in text.lines().take(16) {
        if parse_nonzero_exit_code_from_line(line).is_some() {
            return true;
        }
    }

    for line in text.lines().take(32) {
        let lower = line.trim().to_ascii_lowercase();
        let shell_prefix =
            lower.starts_with("bash:") || lower.starts_with("zsh:") || lower.starts_with("sh:");
        if shell_prefix
            && (lower.contains("command not found")
                || lower.contains("no such file or directory")
                || lower.contains("permission denied"))
        {
            return true;
        }
    }

    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }

    if (trimmed.starts_with('{') || trimmed.starts_with('['))
        && serde_json::from_str::<Value>(trimmed)
            .ok()
            .map(|v| infer_output_value_is_error(&v, 0))
            .unwrap_or(false)
    {
        return true;
    }

    trimmed
        .get(..6)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("error:"))
}

fn infer_output_value_is_error(value: &Value, depth: usize) -> bool {
    if depth > 4 {
        return false;
    }

    match value {
        Value::Null => false,
        Value::Bool(_) | Value::Number(_) => false,
        Value::String(text) => infer_output_text_is_error(text),
        Value::Array(items) => items
            .iter()
            .any(|item| infer_output_value_is_error(item, depth + 1)),
        Value::Object(map) => {
            if map
                .get("is_error")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                return true;
            }

            if map.get("ok").and_then(|v| v.as_bool()) == Some(false)
                || map.get("success").and_then(|v| v.as_bool()) == Some(false)
            {
                return true;
            }

            if let Some(status) = map.get("status").and_then(|v| v.as_str()) {
                if is_failed_status(status) {
                    return true;
                }
            }

            if let Some(exit_code) = map.get("exit_code").and_then(|v| v.as_i64()) {
                if exit_code != 0 {
                    return true;
                }
            }

            if let Some(stderr) = map.get("stderr").and_then(|v| v.as_str()) {
                if !stderr.trim().is_empty() {
                    return true;
                }
            }

            if let Some(error) = map.get("error") {
                match error {
                    Value::Null => {}
                    Value::Bool(false) => {}
                    Value::String(s) if s.trim().is_empty() => {}
                    _ => return true,
                }
            }

            for key in ["output", "result", "details", "data"] {
                if let Some(child) = map.get(key) {
                    if infer_output_value_is_error(child, depth + 1) {
                        return true;
                    }
                }
            }

            false
        }
    }
}

fn infer_tool_call_output_is_error(
    payload: &Value,
    output_value: Option<&Value>,
    output_preview: Option<&str>,
) -> bool {
    if payload
        .get("is_error")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        return true;
    }

    if let Some(status) = payload.get("status").and_then(|s| s.as_str()) {
        if is_failed_status(status) {
            return true;
        }
    }

    if let Some(error) = payload.get("error") {
        match error {
            Value::Null => {}
            Value::Bool(false) => {}
            Value::String(s) if s.trim().is_empty() => {}
            _ => return true,
        }
    }

    if let Some(output) = output_value {
        if infer_output_value_is_error(output, 0) {
            return true;
        }
    }

    output_preview
        .map(infer_output_text_is_error)
        .unwrap_or(false)
}

fn extract_total_tokens_from_usage(usage: &Value) -> Option<u64> {
    if let Some(total_tokens) = usage.get("total_tokens").and_then(|v| v.as_u64()) {
        return Some(total_tokens);
    }

    let input_tokens = usage
        .get("input_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let cached_input_tokens = usage
        .get("cached_input_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let output_tokens = usage
        .get("output_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let reasoning_output_tokens = usage
        .get("reasoning_output_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    // Codex payloads use `input_tokens` as the full input (cache read included),
    // so fallback totals should not double-count cached tokens.
    let total = if cached_input_tokens <= input_tokens {
        input_tokens + output_tokens + reasoning_output_tokens
    } else {
        input_tokens + cached_input_tokens + output_tokens + reasoning_output_tokens
    };
    if total > 0 {
        Some(total)
    } else {
        None
    }
}

fn extract_turn_usage_from_codex_usage(usage: &Value) -> Option<TurnUsage> {
    let input_tokens = usage
        .get("input_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let output_tokens = usage
        .get("output_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let cache_read_input_tokens = usage
        .get("cached_input_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    if input_tokens == 0 && output_tokens == 0 && cache_read_input_tokens == 0 {
        return None;
    }

    Some(TurnUsage {
        input_tokens: input_tokens.saturating_sub(cache_read_input_tokens),
        output_tokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens,
    })
}

fn extract_context_window_used_tokens_from_token_count_info(info: &Value) -> Option<u64> {
    // `last_token_usage` is the current turn usage and best matches context window occupancy.
    if let Some(last_usage) = info.get("last_token_usage") {
        if let Some(total) = extract_total_tokens_from_usage(last_usage) {
            return Some(total);
        }
    }

    // Fallback: some payloads may only have cumulative totals.
    info.get("total_token_usage")
        .and_then(extract_total_tokens_from_usage)
}

fn merge_codex_context_window_stats(
    stats: Option<SessionStats>,
    used_tokens: Option<u64>,
    max_tokens: Option<u64>,
    model: Option<String>,
) -> Option<SessionStats> {
    if used_tokens.is_none() && max_tokens.is_none() {
        return stats;
    }

    let usage_percent = match (used_tokens, max_tokens) {
        (Some(used), Some(max)) if max > 0 => Some((used as f64 / max as f64) * 100.0),
        _ => None,
    };

    match stats {
        Some(mut s) => {
            s.context_window_used_tokens = used_tokens;
            s.context_window_max_tokens = max_tokens;
            s.context_window_usage_percent = usage_percent;
            s.model = model;
            Some(s)
        }
        None => Some(SessionStats {
            total_usage: None,
            total_tokens: None,
            total_duration_ms: 0,
            context_window_used_tokens: used_tokens,
            context_window_max_tokens: max_tokens,
            context_window_usage_percent: usage_percent,
            model,
        }),
    }
}

fn merge_codex_total_usage_stats(
    stats: Option<SessionStats>,
    total_usage: Option<TurnUsage>,
    total_tokens: Option<u64>,
) -> Option<SessionStats> {
    match stats {
        Some(mut s) => {
            if let Some(total) = total_usage {
                s.total_usage = Some(total);
            }
            if total_tokens.is_some() {
                s.total_tokens = total_tokens;
            }
            Some(s)
        }
        None if total_usage.is_some() || total_tokens.is_some() => Some(SessionStats {
            total_usage,
            total_tokens,
            total_duration_ms: 0,
            context_window_used_tokens: None,
            context_window_max_tokens: None,
            context_window_usage_percent: None,
            model: None,
        }),
        None => None,
    }
}

fn agents_instructions_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?s)\A# AGENTS\.md instructions for [^\n]+\n\s*\n<INSTRUCTIONS>.*?</INSTRUCTIONS>\s*",
        )
        .expect("valid agents instructions regex")
    })
}

fn strip_agents_instructions_block(input: &str) -> String {
    let text = agents_instructions_regex().replace(input, "");
    text.trim().to_string()
}

fn is_agents_instruction_message(input: &str) -> bool {
    input
        .trim_start()
        .starts_with("# AGENTS.md instructions for ")
}

fn is_environment_context_message(input: &str) -> bool {
    let trimmed = input.trim();
    trimmed.starts_with("<environment_context>") && trimmed.ends_with("</environment_context>")
}

fn extract_codex_title_candidate(input: &str, fallback_attached: bool) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty()
        || is_agents_instruction_message(trimmed)
        || is_environment_context_message(trimmed)
    {
        return None;
    }

    let without_agents = strip_agents_instructions_block(trimmed);
    if without_agents.is_empty()
        || is_agents_instruction_message(&without_agents)
        || is_environment_context_message(&without_agents)
    {
        return None;
    }

    let cleaned = strip_blocked_resource_mentions(&without_agents);
    if cleaned.is_empty() {
        if fallback_attached {
            Some("Attached resources".to_string())
        } else {
            None
        }
    } else {
        Some(truncate_str(&cleaned, 100))
    }
}

fn extract_codex_text_content(payload: &Value) -> Option<String> {
    let content = payload.get("content")?;
    if let Some(arr) = content.as_array() {
        for item in arr {
            let t = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if t == "input_text" {
                return item
                    .get("text")
                    .and_then(|t| t.as_str())
                    .map(|t| t.to_string());
            }
        }
    }
    None
}

fn parse_data_uri_image(raw: &str) -> Option<(String, String)> {
    let trimmed = raw.trim();
    if !trimmed.starts_with("data:") {
        return None;
    }
    let marker = ";base64,";
    let marker_idx = trimmed.find(marker)?;
    let mime_type = trimmed.get(5..marker_idx)?.trim();
    if !mime_type.starts_with("image/") {
        return None;
    }
    let data = trimmed.get(marker_idx + marker.len()..)?.trim();
    if data.is_empty() {
        return None;
    }
    Some((mime_type.to_string(), data.to_string()))
}

fn parse_input_image_data_uri(item: &Value) -> Option<(String, String)> {
    let data_uri = item
        .get("image_url")
        .and_then(|v| v.as_str())
        .or_else(|| {
            item.get("image_url")
                .and_then(|v| v.get("url"))
                .and_then(|v| v.as_str())
        })
        .or_else(|| item.get("url").and_then(|v| v.as_str()))?;
    parse_data_uri_image(data_uri)
}

fn first_text_block(blocks: &[ContentBlockInternal]) -> Option<String> {
    blocks.iter().find_map(|block| match block {
        ContentBlockInternal::Text { text } => Some(text.clone()),
        _ => None,
    })
}

fn blocks_equal(a: &[ContentBlockInternal], b: &[ContentBlockInternal]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    serde_json::to_value(a).ok() == serde_json::to_value(b).ok()
}

fn should_skip_duplicate_user_message(
    messages: &[UnifiedMessage],
    blocks: &[ContentBlockInternal],
    timestamp: DateTime<Utc>,
) -> bool {
    // Some Codex logs emit the same user message through both `response_item`
    // and `event_msg`, sometimes with a non-trivial delay. Deduplicate by
    // content in a bounded recent time window.
    const DUP_WINDOW_MS: i64 = 120_000;

    for msg in messages.iter().rev() {
        if !matches!(msg.role, MessageRole::User) {
            continue;
        }
        let delta_ms = (timestamp - msg.timestamp).num_milliseconds().abs();
        if delta_ms > DUP_WINDOW_MS {
            break;
        }
        if blocks_equal(&msg.content, blocks) {
            return true;
        }
    }

    false
}

fn extract_response_item_user_image_blocks(payload: &Value) -> Option<Vec<ContentBlockInternal>> {
    let content = payload.get("content")?.as_array()?;
    let mut blocks: Vec<ContentBlockInternal> = Vec::new();
    let mut text_parts: Vec<String> = Vec::new();
    let mut has_input_image = false;

    for item in content {
        let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match item_type {
            "input_text" => {
                let Some(text) = item.get("text").and_then(|v| v.as_str()) else {
                    continue;
                };
                if text.trim() == "<image>" {
                    continue;
                }
                if !text.is_empty() {
                    text_parts.push(text.to_string());
                }
            }
            "input_image" => {
                has_input_image = true;
                let Some((mime_type, data)) = parse_input_image_data_uri(item) else {
                    continue;
                };
                blocks.push(ContentBlockInternal::Image {
                    data,
                    mime_type,
                    uri: None,
                });
            }
            _ => {}
        }
    }

    if !has_input_image {
        return None;
    }

    let text = strip_blocked_resource_mentions(&text_parts.join("\n"));
    if !text.is_empty() {
        blocks.insert(0, ContentBlockInternal::Text { text });
    }

    if blocks.is_empty() {
        blocks.push(ContentBlockInternal::Text {
            text: "Attached resources".to_string(),
        });
    }

    Some(blocks)
}

fn strip_blocked_resource_mentions(input: &str) -> String {
    let blocked_re = Regex::new(r"@([^\s@]+)\s*\[blocked[^\]]*\]").expect("valid blocked regex");
    let image_tag_re = Regex::new(r"(?i)</?image\s*/?>").expect("valid image tag regex");
    let collapsed_ws_re = Regex::new(r"[ \t]{2,}").expect("valid whitespace regex");
    let text = blocked_re.replace_all(input, "").to_string();
    let text = image_tag_re.replace_all(&text, "").to_string();
    let text = collapsed_ws_re.replace_all(&text, " ").to_string();
    text.trim().to_string()
}

/// Group flat messages into conversation turns.
/// Codex rule: consecutive Assistant + Tool messages merge into one Assistant turn.
fn group_into_turns(messages: Vec<UnifiedMessage>) -> Vec<MessageTurn> {
    let mut turns = Vec::new();
    let mut i = 0;

    while i < messages.len() {
        let msg = &messages[i];

        if matches!(msg.role, MessageRole::User) {
            turns.push(MessageTurn {
                id: format!("turn-{}", turns.len()),
                role: TurnRole::User,
                blocks: convert_content_blocks(&msg.content),
                timestamp: msg.timestamp.to_rfc3339(),
                usage: None,
                duration_ms: None,
                model: None,
            });
            i += 1;
        } else if matches!(msg.role, MessageRole::System) {
            turns.push(MessageTurn {
                id: format!("turn-{}", turns.len()),
                role: TurnRole::System,
                blocks: convert_content_blocks(&msg.content),
                timestamp: msg.timestamp.to_rfc3339(),
                usage: None,
                duration_ms: None,
                model: None,
            });
            i += 1;
        } else {
            // Assistant or Tool — start a group
            let mut blocks: Vec<ContentBlock> = convert_content_blocks(&msg.content);
            let mut usage = msg.usage.clone();
            let mut duration_ms = msg.duration_ms;
            let mut turn_model = msg.model.clone();
            let timestamp = msg.timestamp;
            i += 1;

            while i < messages.len()
                && (matches!(messages[i].role, MessageRole::Assistant)
                    || matches!(messages[i].role, MessageRole::Tool))
            {
                blocks.extend(convert_content_blocks(&messages[i].content));
                if usage.is_none() {
                    usage = messages[i].usage.clone();
                }
                if duration_ms.is_none() {
                    duration_ms = messages[i].duration_ms;
                }
                if turn_model.is_none() {
                    turn_model = messages[i].model.clone();
                }
                i += 1;
            }

            turns.push(MessageTurn {
                id: format!("turn-{}", turns.len()),
                role: TurnRole::Assistant,
                blocks,
                timestamp: timestamp.to_rfc3339(),
                usage,
                duration_ms,
                model: turn_model,
            });
        }
    }

    turns
}

/// 将内部 ContentBlock 转换为外部 ContentBlock
fn convert_content_blocks(internal: &[ContentBlockInternal]) -> Vec<ContentBlock> {
    internal
        .iter()
        .map(|block| match block {
            ContentBlockInternal::Text { text } => ContentBlock::Text { text: text.clone() },
            ContentBlockInternal::Thinking { text } => {
                ContentBlock::Thinking { text: text.clone() }
            }
            ContentBlockInternal::ToolUse {
                tool_use_id,
                tool_name,
                input_preview,
            } => ContentBlock::ToolUse {
                tool_use_id: tool_use_id.clone(),
                tool_name: tool_name.clone(),
                input_preview: input_preview.clone(),
            },
            ContentBlockInternal::ToolResult {
                tool_use_id,
                output_preview,
                is_error,
            } => ContentBlock::ToolResult {
                tool_use_id: tool_use_id.clone(),
                output_preview: output_preview.clone(),
                is_error: *is_error,
            },
            ContentBlockInternal::Image {
                data,
                mime_type,
                uri,
            } => ContentBlock::Image {
                data: data.clone(),
                mime_type: mime_type.clone(),
                uri: uri.clone(),
            },
        })
        .collect()
}

/// 截断字符串到指定长度
fn truncate_str(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        return s.to_string();
    }

    let mut end = max_len;
    while end > 10 && !s.is_char_boundary(end) {
        end -= 1;
    }

    format!("{}...", &s[..end])
}

/// 从路径中提取文件夹名称
fn folder_name_from_path(path: &str) -> String {
    let path = Path::new(path);
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string()
}
