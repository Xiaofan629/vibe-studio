pub mod claude;
pub mod claude_full;
pub mod codex;
pub mod codex_full;
pub mod gemini;
pub mod gemini_full;

use crate::{AgentLogEntry, AgentType};

pub fn parse_output(agent_type: AgentType, line: &str) -> Vec<AgentLogEntry> {
    match agent_type {
        AgentType::ClaudeCode => claude::parse_line(line),
        AgentType::Gemini => gemini::parse_line(line),
        AgentType::Codex => codex::parse_line(line),
    }
}

pub fn should_ignore_stderr(agent_type: AgentType, line: &str) -> bool {
    match agent_type {
        AgentType::Gemini => gemini::should_ignore_stderr_line(line),
        _ => line.trim().is_empty(),
    }
}
