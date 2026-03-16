pub mod adapters;
pub mod claude_session_reader;
pub mod command;
pub mod discovery;
pub mod multi_agent;
pub mod parsers;
pub mod process;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AgentError {
    #[error("Agent not found: {0}")]
    NotFound(String),
    #[error("Agent process failed: {0}")]
    ProcessFailed(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Parse error: {0}")]
    ParseError(String),
}

pub type Result<T> = std::result::Result<T, AgentError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentType {
    ClaudeCode,
    Gemini,
    Codex,
}

impl AgentType {
    pub fn display_name(&self) -> &str {
        match self {
            AgentType::ClaudeCode => "Claude Code",
            AgentType::Gemini => "Gemini CLI",
            AgentType::Codex => "Codex",
        }
    }

    pub fn cli_command(&self) -> &str {
        match self {
            AgentType::ClaudeCode => "claude",
            AgentType::Gemini => "gemini",
            AgentType::Codex => "codex",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    pub agent_type: AgentType,
    pub name: String,
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentProcessStatus {
    Running,
    Completed,
    Failed,
    Killed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentLogEntryType {
    Text,
    ToolCall,
    ToolResult,
    Thinking,
    Error,
    FileOp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLogEntry {
    pub entry_type: AgentLogEntryType,
    pub content: String,
    pub tool_name: Option<String>,
    pub file_path: Option<String>,
    pub timestamp: String,
}

// 完整的会话数据结构（参考 codeg）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationDetail {
    pub summary: ConversationSummary,
    pub turns: Vec<MessageTurn>,
    pub session_stats: Option<SessionStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSummary {
    pub id: String,
    pub folder_path: Option<String>,
    pub folder_name: Option<String>,
    pub title: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub message_count: u32,
    pub model: Option<String>,
    pub git_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageTurn {
    pub id: String,
    pub role: TurnRole,
    pub blocks: Vec<ContentBlock>,
    pub timestamp: String,
    pub usage: Option<TurnUsage>,
    pub duration_ms: Option<u64>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TurnRole {
    User,
    Assistant,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text {
        text: String,
    },
    Thinking {
        text: String,
    },
    ToolUse {
        #[serde(rename = "toolUseId")]
        tool_use_id: Option<String>,
        #[serde(rename = "toolName")]
        tool_name: String,
        #[serde(rename = "inputPreview")]
        input_preview: Option<String>,
    },
    ToolResult {
        #[serde(rename = "toolUseId")]
        tool_use_id: Option<String>,
        #[serde(rename = "outputPreview")]
        output_preview: Option<String>,
        #[serde(rename = "isError")]
        is_error: bool,
    },
    Image {
        data: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
        uri: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_input_tokens: u64,
    pub cache_read_input_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStats {
    pub total_usage: Option<TurnUsage>,
    pub total_tokens: Option<u64>,
    pub total_duration_ms: u64,
    pub context_window_used_tokens: Option<u64>,
    pub context_window_max_tokens: Option<u64>,
    pub context_window_usage_percent: Option<f64>,
}
