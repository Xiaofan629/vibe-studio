pub mod claude;
pub mod claude_full;
pub mod codex;
pub mod gemini;

use crate::{AgentLogEntry, AgentType};

pub fn parse_output(agent_type: AgentType, line: &str) -> Vec<AgentLogEntry> {
    match agent_type {
        AgentType::ClaudeCode => claude::parse_line(line),
        AgentType::Gemini => gemini::parse_line(line),
        AgentType::Codex => codex::parse_line(line),
    }
}
