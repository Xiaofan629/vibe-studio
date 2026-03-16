use super::AgentAdapter;
use crate::command;
use std::path::Path;
use tokio::process::Command;

/// OpenAI Codex CLI adapter
///
/// Uses `codex -q <prompt>` for quiet mode (non-interactive) output.
/// The `-q` flag suppresses interactive prompts and streams results to stdout.
pub struct CodexAdapter;

impl AgentAdapter for CodexAdapter {
    fn build_command(&self, working_dir: &Path, prompt: &str, _continue_session: bool) -> Command {
        let mut cmd = command::new_tokio_command("codex");
        cmd.current_dir(working_dir);
        cmd.args(["-q", prompt]);
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());
        cmd
    }
}
