use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde_json::Value;
use walkdir::WalkDir;

use crate::{
    ContentBlock, ConversationDetail, ConversationSummary, MessageTurn, SessionStats, TurnRole,
    TurnUsage,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MessageRole {
    User,
    Assistant,
    System,
}

#[derive(Debug, Clone)]
struct UnifiedMessage {
    role: MessageRole,
    content: Vec<ContentBlock>,
    timestamp: DateTime<Utc>,
    usage: Option<TurnUsage>,
    duration_ms: Option<u64>,
    model: Option<String>,
}

pub fn read_gemini_session_full(workspace_path: &Path) -> Result<ConversationDetail, String> {
    let parser = GeminiSessionReader::new();
    parser.read_for_workspace(workspace_path)
}

struct GeminiSessionReader {
    base_dir: PathBuf,
}

impl GeminiSessionReader {
    fn new() -> Self {
        Self {
            base_dir: resolve_gemini_base_dir(),
        }
    }

    #[cfg(test)]
    fn with_base_dir(base_dir: PathBuf) -> Self {
        Self { base_dir }
    }

    fn read_for_workspace(&self, workspace_path: &Path) -> Result<ConversationDetail, String> {
        let normalized_workspace = normalize_path_for_matching(workspace_path);
        let mut latest_match: Option<(PathBuf, Value, String, DateTime<Utc>)> = None;

        for chat_file in self.list_chat_files() {
            let raw = match fs::read_to_string(&chat_file) {
                Ok(raw) => raw,
                Err(_) => continue,
            };
            let value: Value = match serde_json::from_str(&raw) {
                Ok(value) => value,
                Err(_) => continue,
            };

            let Some(alias) = Self::project_alias_from_chat_path(&chat_file) else {
                continue;
            };
            let Some(project_root) = self.resolve_project_root(&alias) else {
                continue;
            };

            if normalize_path_for_matching(Path::new(&project_root)) != normalized_workspace {
                continue;
            }

            let Some(conversation_id) = value
                .get("sessionId")
                .and_then(|v| v.as_str())
                .map(str::to_string)
            else {
                continue;
            };

            let updated_at = self
                .conversation_updated_at(&value)
                .unwrap_or_else(Utc::now);

            let replace = latest_match
                .as_ref()
                .map(|(_, _, _, existing_updated_at)| updated_at > *existing_updated_at)
                .unwrap_or(true);

            if replace {
                latest_match = Some((chat_file, value, conversation_id, updated_at));
            }
        }

        match latest_match {
            Some((chat_file, value, conversation_id, _)) => {
                self.parse_conversation_detail(&chat_file, &value, &conversation_id)
            }
            None => Ok(create_empty_conversation(workspace_path)),
        }
    }

    fn tmp_dir(&self) -> PathBuf {
        self.base_dir.join("tmp")
    }

    fn history_dir(&self) -> PathBuf {
        self.base_dir.join("history")
    }

    fn projects_json_path(&self) -> PathBuf {
        self.base_dir.join("projects.json")
    }

    fn is_chat_file(path: &Path) -> bool {
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            return false;
        }
        let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !file_name.starts_with("session-") {
            return false;
        }
        path.parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            == Some("chats")
    }

    fn list_chat_files(&self) -> Vec<PathBuf> {
        let tmp_dir = self.tmp_dir();
        if !tmp_dir.exists() {
            return Vec::new();
        }

        let mut files: Vec<PathBuf> = WalkDir::new(&tmp_dir)
            .into_iter()
            .filter_map(Result::ok)
            .map(|entry| entry.path().to_path_buf())
            .filter(|path| path.is_file() && Self::is_chat_file(path))
            .collect();
        files.sort();
        files
    }

    fn project_alias_from_chat_path(path: &Path) -> Option<String> {
        path.parent()?
            .parent()?
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
    }

    fn read_project_root_file(path: PathBuf) -> Option<String> {
        let raw = fs::read_to_string(path).ok()?;
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    }

    fn resolve_project_root(&self, alias: &str) -> Option<String> {
        let tmp_root = self.tmp_dir().join(alias).join(".project_root");
        if let Some(path) = Self::read_project_root_file(tmp_root) {
            return Some(path);
        }

        let history_root = self.history_dir().join(alias).join(".project_root");
        if let Some(path) = Self::read_project_root_file(history_root) {
            return Some(path);
        }

        self.resolve_project_root_from_projects_json(alias)
    }

    fn resolve_project_root_from_projects_json(&self, alias: &str) -> Option<String> {
        let raw = fs::read_to_string(self.projects_json_path()).ok()?;
        let value: Value = serde_json::from_str(&raw).ok()?;
        let projects = value.get("projects")?.as_object()?;
        projects
            .iter()
            .find_map(|(path, mapped_alias)| (mapped_alias.as_str() == Some(alias)).then_some(path))
            .cloned()
    }

    fn parse_timestamp(value: Option<&Value>) -> Option<DateTime<Utc>> {
        value.and_then(|v| v.as_str()?.parse::<DateTime<Utc>>().ok())
    }

    fn conversation_updated_at(&self, value: &Value) -> Option<DateTime<Utc>> {
        Self::parse_timestamp(value.get("lastUpdated")).or_else(|| {
            value
                .get("messages")
                .and_then(|v| v.as_array())
                .and_then(|messages| {
                    messages
                        .iter()
                        .rev()
                        .find_map(|message| Self::parse_timestamp(message.get("timestamp")))
                })
        })
    }

    fn extract_text(value: &Value) -> Option<String> {
        match value {
            Value::String(text) => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            }
            Value::Array(items) => {
                let mut parts = Vec::new();
                for item in items {
                    if let Some(text) = item.get("text").and_then(Self::extract_text) {
                        parts.push(text);
                    } else if let Some(text) = Self::extract_text(item) {
                        parts.push(text);
                    }
                }
                if parts.is_empty() {
                    None
                } else {
                    Some(parts.join("\n"))
                }
            }
            Value::Object(map) => {
                if let Some(text) = map.get("text").and_then(Self::extract_text) {
                    return Some(text);
                }
                if let Some(text) = map.get("message").and_then(Self::extract_text) {
                    return Some(text);
                }
                None
            }
            _ => None,
        }
    }

    fn extract_message_text(message: &Value) -> Option<String> {
        message
            .get("content")
            .and_then(Self::extract_text)
            .or_else(|| message.get("message").and_then(Self::extract_text))
    }

    fn parse_data_uri_image(raw: &str) -> Option<(String, String)> {
        let trimmed = raw.trim();
        let without_prefix = trimmed.strip_prefix("data:")?;
        let marker = ";base64,";
        let marker_idx = without_prefix.find(marker)?;
        let mime_type = without_prefix.get(..marker_idx)?.trim();
        if !mime_type.starts_with("image/") {
            return None;
        }
        let data = without_prefix.get(marker_idx + marker.len()..)?.trim();
        if data.is_empty() {
            return None;
        }
        Some((mime_type.to_string(), data.to_string()))
    }

    fn parse_user_image_part(part: &Value) -> Option<ContentBlock> {
        let inline = part
            .get("inlineData")
            .or_else(|| part.get("inline_data"))
            .unwrap_or(part);
        let data = inline
            .get("data")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())?;

        if let Some((mime_type, data)) = Self::parse_data_uri_image(data) {
            return Some(ContentBlock::Image {
                data,
                mime_type,
                uri: None,
            });
        }

        let mime_type = inline
            .get("mimeType")
            .or_else(|| inline.get("mime_type"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|mime| !mime.is_empty() && mime.starts_with("image/"))?;
        let uri = inline
            .get("fileUri")
            .or_else(|| inline.get("uri"))
            .and_then(|u| u.as_str())
            .map(str::to_string);

        Some(ContentBlock::Image {
            data: data.to_string(),
            mime_type: mime_type.to_string(),
            uri,
        })
    }

    fn parse_user_blocks(message: &Value) -> Vec<ContentBlock> {
        let mut blocks = Vec::new();
        let Some(content) = message.get("content") else {
            if let Some(text) = message.get("message").and_then(Self::extract_text) {
                blocks.push(ContentBlock::Text { text });
            }
            return blocks;
        };

        if let Some(text) = content
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
        {
            blocks.push(ContentBlock::Text { text });
            return blocks;
        }

        if let Some(parts) = content.as_array() {
            for part in parts {
                if let Some(text) = part.get("text").and_then(Self::extract_text) {
                    blocks.push(ContentBlock::Text { text });
                } else if let Some(text) = Self::extract_text(part) {
                    blocks.push(ContentBlock::Text { text });
                }

                if let Some(image) = Self::parse_user_image_part(part) {
                    blocks.push(image);
                }
            }
            return blocks;
        }

        if let Some(image) = Self::parse_user_image_part(content) {
            blocks.push(image);
            return blocks;
        }

        if let Some(text) = Self::extract_text(content) {
            blocks.push(ContentBlock::Text { text });
        }

        blocks
    }

    fn result_preview(result: Option<&Value>) -> Option<String> {
        let value = result?;
        if let Some(text) = value.as_str() {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return None;
            }
            return Some(trimmed.to_string());
        }
        serde_json::to_string(value).ok()
    }

    fn tool_call_is_error(call: &Value, output_preview: Option<&str>) -> bool {
        if call
            .get("status")
            .and_then(|v| v.as_str())
            .map(|status| {
                matches!(
                    status.to_ascii_lowercase().as_str(),
                    "error" | "failed" | "failure" | "cancelled" | "canceled"
                )
            })
            .unwrap_or(false)
        {
            return true;
        }

        if call
            .get("result")
            .and_then(|r| r.as_array())
            .map(|items| {
                items.iter().any(|item| {
                    item.get("functionResponse")
                        .and_then(|fr| fr.get("response"))
                        .and_then(|resp| resp.get("error"))
                        .is_some()
                })
            })
            .unwrap_or(false)
        {
            return true;
        }

        output_preview
            .map(|preview| {
                preview
                    .trim_start()
                    .to_ascii_lowercase()
                    .starts_with("error")
            })
            .unwrap_or(false)
    }

    fn parse_assistant_blocks(message: &Value) -> Vec<ContentBlock> {
        let mut blocks = Vec::new();

        if let Some(tool_calls) = message.get("toolCalls").and_then(|v| v.as_array()) {
            for call in tool_calls {
                let tool_use_id = call.get("id").and_then(|v| v.as_str()).map(str::to_string);
                let tool_name = call
                    .get("displayName")
                    .or_else(|| call.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let input_preview = call
                    .get("args")
                    .and_then(|v| serde_json::to_string(v).ok())
                    .or_else(|| {
                        call.get("input")
                            .and_then(|v| Self::result_preview(Some(v)))
                    });

                blocks.push(ContentBlock::ToolUse {
                    tool_use_id: tool_use_id.clone(),
                    tool_name,
                    input_preview,
                });

                let output_preview = call
                    .get("resultDisplay")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .or_else(|| Self::result_preview(call.get("result")));

                blocks.push(ContentBlock::ToolResult {
                    tool_use_id,
                    output_preview: output_preview.clone(),
                    is_error: Self::tool_call_is_error(call, output_preview.as_deref()),
                });
            }
        }

        if let Some(text) = Self::extract_message_text(message) {
            blocks.push(ContentBlock::Text { text });
        }

        blocks
    }

    fn parse_usage(message: &Value) -> Option<TurnUsage> {
        let tokens = message.get("tokens")?;
        let input_tokens = tokens.get("input").and_then(|v| v.as_u64()).unwrap_or(0);
        let output_tokens = tokens.get("output").and_then(|v| v.as_u64()).unwrap_or(0);
        let cached_tokens = tokens.get("cached").and_then(|v| v.as_u64()).unwrap_or(0);

        Some(TurnUsage {
            input_tokens,
            output_tokens,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: cached_tokens,
        })
    }

    fn parse_summary_from_value(&self, path: &Path, value: &Value) -> Option<ConversationSummary> {
        let id = value.get("sessionId").and_then(|v| v.as_str())?.to_string();
        let messages = value
            .get("messages")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let first_message_ts = messages
            .first()
            .and_then(|message| Self::parse_timestamp(message.get("timestamp")));
        let last_message_ts = messages
            .iter()
            .rev()
            .find_map(|message| Self::parse_timestamp(message.get("timestamp")));

        let started_at = Self::parse_timestamp(value.get("startTime"))
            .or(first_message_ts)
            .unwrap_or_else(Utc::now);
        let ended_at = Self::parse_timestamp(value.get("lastUpdated")).or(last_message_ts);

        let title = messages
            .iter()
            .filter(|message| message.get("type").and_then(|v| v.as_str()) == Some("user"))
            .find_map(Self::extract_message_text)
            .map(|text| truncate_str(&text, 100));

        let model = messages.iter().rev().find_map(|message| {
            message
                .get("model")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        });

        let folder_alias = Self::project_alias_from_chat_path(path);
        let folder_path = folder_alias
            .as_deref()
            .and_then(|alias| self.resolve_project_root(alias));
        let folder_name = folder_path
            .as_ref()
            .map(|path| folder_name_from_path(path))
            .or(folder_alias);

        Some(ConversationSummary {
            id,
            folder_path,
            folder_name,
            title,
            started_at: started_at.to_rfc3339(),
            ended_at: ended_at.map(|timestamp| timestamp.to_rfc3339()),
            message_count: messages.len() as u32,
            model,
            git_branch: None,
        })
    }

    fn parse_conversation_detail(
        &self,
        path: &Path,
        value: &Value,
        conversation_id: &str,
    ) -> Result<ConversationDetail, String> {
        let mut summary = self
            .parse_summary_from_value(path, value)
            .ok_or_else(|| format!("Gemini conversation not found: {conversation_id}"))?;
        let messages_raw = value
            .get("messages")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let summary_started_at = summary
            .started_at
            .parse::<DateTime<Utc>>()
            .unwrap_or_else(|_| Utc::now());

        let mut messages = Vec::new();
        for raw in messages_raw {
            let timestamp =
                Self::parse_timestamp(raw.get("timestamp")).unwrap_or(summary_started_at);
            let msg_type = raw
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_ascii_lowercase();

            match msg_type.as_str() {
                "user" => {
                    let blocks = Self::parse_user_blocks(&raw);
                    if blocks.is_empty() {
                        continue;
                    }
                    messages.push(UnifiedMessage {
                        role: MessageRole::User,
                        content: blocks,
                        timestamp,
                        usage: None,
                        duration_ms: None,
                        model: None,
                    });
                }
                "gemini" | "assistant" | "model" => {
                    let blocks = Self::parse_assistant_blocks(&raw);
                    if blocks.is_empty() {
                        continue;
                    }
                    messages.push(UnifiedMessage {
                        role: MessageRole::Assistant,
                        content: blocks,
                        timestamp,
                        usage: Self::parse_usage(&raw),
                        duration_ms: None,
                        model: raw
                            .get("model")
                            .and_then(|v| v.as_str())
                            .map(str::to_string),
                    });
                }
                "system" => {
                    let Some(text) = Self::extract_message_text(&raw) else {
                        continue;
                    };
                    messages.push(UnifiedMessage {
                        role: MessageRole::System,
                        content: vec![ContentBlock::Text { text }],
                        timestamp,
                        usage: None,
                        duration_ms: None,
                        model: None,
                    });
                }
                _ => {}
            }
        }

        for index in 0..messages.len() {
            if !matches!(messages[index].role, MessageRole::Assistant)
                || messages[index].duration_ms.is_some()
            {
                continue;
            }

            let Some(next) = messages.get(index + 1) else {
                continue;
            };

            let duration = (next.timestamp - messages[index].timestamp).num_milliseconds();
            if duration > 0 && duration < 300_000 {
                messages[index].duration_ms = Some(duration as u64);
            }
        }

        let turns = group_into_turns(messages);
        summary.message_count = turns.len() as u32;
        summary.id = conversation_id.to_string();

        let context_window_used_tokens = latest_turn_total_usage_tokens(&turns);
        let context_window_max_tokens = infer_context_window_max_tokens(summary.model.as_deref());
        let session_stats = merge_context_window_stats(
            compute_session_stats(&turns),
            context_window_used_tokens,
            context_window_max_tokens,
            summary.model.clone(),
        );

        Ok(ConversationDetail {
            summary,
            turns,
            session_stats,
        })
    }
}

fn resolve_gemini_base_dir() -> PathBuf {
    resolve_gemini_base_dir_from(std::env::var_os("GEMINI_CLI_HOME"), dirs::home_dir())
}

fn resolve_gemini_base_dir_from(
    gemini_cli_home_env: Option<std::ffi::OsString>,
    home_dir: Option<PathBuf>,
) -> PathBuf {
    gemini_cli_home_env
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir.unwrap_or_default())
        .join(".gemini")
}

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

fn group_into_turns(messages: Vec<UnifiedMessage>) -> Vec<MessageTurn> {
    let mut turns = Vec::new();
    let mut index = 0;

    while index < messages.len() {
        let message = &messages[index];

        if matches!(message.role, MessageRole::User) {
            turns.push(MessageTurn {
                id: format!("turn-{}", turns.len()),
                role: TurnRole::User,
                blocks: message.content.clone(),
                timestamp: message.timestamp.to_rfc3339(),
                usage: None,
                duration_ms: None,
                model: None,
            });
            index += 1;
            continue;
        }

        if matches!(message.role, MessageRole::System) {
            turns.push(MessageTurn {
                id: format!("turn-{}", turns.len()),
                role: TurnRole::System,
                blocks: message.content.clone(),
                timestamp: message.timestamp.to_rfc3339(),
                usage: None,
                duration_ms: None,
                model: None,
            });
            index += 1;
            continue;
        }

        let mut blocks = message.content.clone();
        let mut usage = message.usage.clone();
        let mut duration_ms = message.duration_ms;
        let timestamp = message.timestamp;
        let mut model = message.model.clone();
        index += 1;

        while index < messages.len() && matches!(messages[index].role, MessageRole::Assistant) {
            blocks.extend(messages[index].content.clone());
            if usage.is_none() {
                usage = messages[index].usage.clone();
            }
            if duration_ms.is_none() {
                duration_ms = messages[index].duration_ms;
            }
            if model.is_none() {
                model = messages[index].model.clone();
            }
            index += 1;
        }

        turns.push(MessageTurn {
            id: format!("turn-{}", turns.len()),
            role: TurnRole::Assistant,
            blocks,
            timestamp: timestamp.to_rfc3339(),
            usage,
            duration_ms,
            model,
        });
    }

    turns
}

fn compute_session_stats(turns: &[MessageTurn]) -> Option<SessionStats> {
    if turns.is_empty() {
        return None;
    }

    let total_usage =
        turns
            .iter()
            .filter_map(|turn| turn.usage.clone())
            .fold(None, |acc, usage| {
                Some(acc.map_or_else(
                    || usage.clone(),
                    |current: TurnUsage| {
                        TurnUsage {
                            input_tokens: current.input_tokens.saturating_add(usage.input_tokens),
                            output_tokens: current
                                .output_tokens
                                .saturating_add(usage.output_tokens),
                            cache_creation_input_tokens: current
                                .cache_creation_input_tokens
                                .saturating_add(usage.cache_creation_input_tokens),
                            cache_read_input_tokens: current
                                .cache_read_input_tokens
                                .saturating_add(usage.cache_read_input_tokens),
                        }
                    },
                ))
            });

    let total_tokens = total_usage.as_ref().map(|usage| {
        usage
            .input_tokens
            .saturating_add(usage.output_tokens)
            .saturating_add(usage.cache_read_input_tokens)
    });

    let total_duration_ms = turns.iter().filter_map(|turn| turn.duration_ms).sum();

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

fn infer_context_window_max_tokens(model: Option<&str>) -> Option<u64> {
    let raw = model?.trim();
    if raw.is_empty() {
        return None;
    }

    let normalized = raw
        .rsplit('/')
        .next()
        .unwrap_or(raw)
        .split(':')
        .next()
        .unwrap_or(raw)
        .trim()
        .to_ascii_lowercase();

    if normalized.starts_with("gemini") {
        Some(1_000_000)
    } else {
        None
    }
}

fn latest_turn_total_usage_tokens(turns: &[MessageTurn]) -> Option<u64> {
    turns.iter().rev().find_map(|turn| {
        turn.usage.as_ref().map(|usage| {
            usage
                .input_tokens
                .saturating_add(usage.output_tokens)
                .saturating_add(usage.cache_creation_input_tokens)
                .saturating_add(usage.cache_read_input_tokens)
        })
    })
}

fn merge_context_window_stats(
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
        Some(mut stats) => {
            stats.context_window_used_tokens = used_tokens;
            stats.context_window_max_tokens = max_tokens;
            stats.context_window_usage_percent = usage_percent;
            stats.model = model;
            Some(stats)
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

fn truncate_str(input: &str, max_len: usize) -> String {
    if input.chars().count() <= max_len {
        input.to_string()
    } else {
        let truncated: String = input.chars().take(max_len).collect();
        format!("{truncated}...")
    }
}

fn folder_name_from_path(path: &str) -> String {
    path.rsplit(['/', '\\']).next().unwrap_or(path).to_string()
}

fn normalize_path_for_matching(path: &Path) -> String {
    fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::{read_gemini_session_full, resolve_gemini_base_dir_from, GeminiSessionReader};
    use crate::ContentBlock;
    use std::env;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn reads_gemini_session_detail_from_workspace_path() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time ok")
            .as_nanos();
        let base = env::temp_dir().join(format!("vibe-gemini-test-{nanos}"));
        let workspace_path = base.join("workspace");
        let chats_dir = base.join(".gemini").join("tmp").join("codeg").join("chats");
        fs::create_dir_all(&chats_dir).expect("create chat dir");
        fs::create_dir_all(&workspace_path).expect("create workspace dir");
        fs::write(
            base.join(".gemini")
                .join("tmp")
                .join("codeg")
                .join(".project_root"),
            workspace_path.to_string_lossy().to_string(),
        )
        .expect("write project root");

        let file_path = chats_dir.join("session-2026-03-02T04-30-32c7d221.json");
        let content = r#"{
  "sessionId": "32c7d221-0553-46c8-ba50-e664719cae7f",
  "projectHash": "abc",
  "startTime": "2026-03-02T04:30:20.796Z",
  "lastUpdated": "2026-03-02T04:33:13.631Z",
  "messages": [
    {
      "id": "u1",
      "timestamp": "2026-03-02T04:30:20.796Z",
      "type": "user",
      "content": [{"text": "你会做什么"}]
    },
    {
      "id": "a1",
      "timestamp": "2026-03-02T04:33:13.631Z",
      "type": "gemini",
      "content": "我是一个助手",
      "toolCalls": [
        {
          "id": "cli_help-1",
          "name": "cli_help",
          "args": {"question": "你会做什么"},
          "resultDisplay": "ok",
          "status": "success"
        }
      ],
      "tokens": {"input": 12, "output": 34, "cached": 5},
      "model": "gemini-3.1-pro-preview"
    }
  ]
}"#;
        fs::write(&file_path, content).expect("write chat file");

        let parser = GeminiSessionReader::with_base_dir(base.join(".gemini"));
        let detail = parser
            .read_for_workspace(&workspace_path)
            .expect("read conversation");
        assert_eq!(detail.turns.len(), 2);
        assert_eq!(
            detail.summary.folder_path.as_deref(),
            Some(workspace_path.to_string_lossy().as_ref())
        );
        assert_eq!(
            detail
                .session_stats
                .as_ref()
                .and_then(|s| s.context_window_max_tokens),
            Some(1_000_000)
        );
        assert_eq!(
            detail
                .session_stats
                .as_ref()
                .and_then(|s| s.context_window_used_tokens),
            Some(51)
        );
        assert!(matches!(
            &detail.turns[1].blocks[0],
            ContentBlock::ToolUse { tool_name, .. } if tool_name == "cli_help"
        ));

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn returns_empty_conversation_when_no_matching_workspace_exists() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time ok")
            .as_nanos();
        let workspace_path = env::temp_dir().join(format!("vibe-gemini-empty-{nanos}"));
        fs::create_dir_all(&workspace_path).expect("create workspace");

        let detail = read_gemini_session_full(&workspace_path).expect("read empty conversation");
        assert_eq!(detail.turns.len(), 0);
        assert_eq!(
            detail.summary.folder_path.as_deref(),
            Some(workspace_path.to_string_lossy().as_ref())
        );

        let _ = fs::remove_dir_all(workspace_path);
    }

    #[test]
    fn gemini_cli_home_env_overrides_user_home() {
        let resolved = resolve_gemini_base_dir_from(
            Some(std::ffi::OsString::from("/tmp/gemini-home")),
            Some(PathBuf::from("/Users/default")),
        );
        assert_eq!(resolved, PathBuf::from("/tmp/gemini-home/.gemini"));
    }
}
