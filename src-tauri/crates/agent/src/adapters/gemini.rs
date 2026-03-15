use super::AgentAdapter;
use std::path::Path;
use tokio::process::Command;

/// Gemini CLI adapter
///
/// Uses `gemini -r latest <prompt>` when continuing a session, otherwise
/// starts a new Gemini CLI prompt with `gemini <prompt>`.
/// Gemini CLI outputs plain text / markdown with embedded tool call indicators.
pub struct GeminiAdapter;

impl AgentAdapter for GeminiAdapter {
    fn build_command(&self, working_dir: &Path, prompt: &str, continue_session: bool) -> Command {
        let mut cmd = Command::new("gemini");
        cmd.current_dir(working_dir);
        if continue_session {
            cmd.args(["-r", "latest"]);
        }
        cmd.arg(prompt);
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());
        cmd
    }
}
