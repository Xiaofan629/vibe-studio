pub mod claude;
pub mod codex;
pub mod gemini;

use crate::AgentType;
use std::path::Path;
use tokio::process::Command;

/// Trait for agent-specific CLI configuration
pub trait AgentAdapter {
    /// Build the CLI command for this agent
    fn build_command(&self, working_dir: &Path, prompt: &str, continue_session: bool) -> Command;

    /// Get environment variables to set for the process
    fn env_vars(&self) -> Vec<(&str, &str)> {
        vec![]
    }
}

/// Create the appropriate adapter for the given agent type
pub fn create_adapter(agent_type: AgentType) -> Box<dyn AgentAdapter + Send> {
    match agent_type {
        AgentType::ClaudeCode => Box::new(claude::ClaudeCodeAdapter),
        AgentType::Gemini => Box::new(gemini::GeminiAdapter),
        AgentType::Codex => Box::new(codex::CodexAdapter),
    }
}
