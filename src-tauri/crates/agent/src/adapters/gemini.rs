use super::AgentAdapter;
use crate::command;
use std::path::Path;
use tokio::process::Command;

/// Gemini CLI adapter
///
/// Uses Gemini's non-interactive headless mode with line-delimited JSON output,
/// which avoids TUI escape sequences and makes realtime rendering stable.
pub struct GeminiAdapter;

impl AgentAdapter for GeminiAdapter {
    fn build_command(
        &self,
        working_dir: &Path,
        prompt: &str,
        continue_session: bool,
        _permission_mode: Option<&str>,
    ) -> Command {
        let mut cmd = command::new_tokio_command("gemini");
        cmd.current_dir(working_dir);
        if continue_session {
            cmd.args(["--resume", "latest"]);
        }
        cmd.args([
            "--prompt",
            prompt,
            "--output-format",
            "stream-json",
            "--yolo",
        ]);
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());
        cmd
    }
}
