use super::AgentAdapter;
use crate::command;
use std::path::Path;
use tokio::process::Command;

/// Claude Code CLI adapter
///
/// Uses `claude -p <prompt> --output-format stream-json --verbose` for structured streaming output.
/// The `--verbose` flag is required when combining `--print` with `stream-json` format.
/// When `continue_session` is true, adds `--continue` to resume the last conversation
/// in the working directory, preserving full context across multiple turns.
pub struct ClaudeCodeAdapter;

impl AgentAdapter for ClaudeCodeAdapter {
    fn build_command(
        &self,
        working_dir: &Path,
        prompt: &str,
        continue_session: bool,
        permission_mode: Option<&str>,
    ) -> Command {
        let mut cmd = command::new_tokio_command("claude");
        cmd.current_dir(working_dir);

        let mut args = vec![
            "-p",
            prompt,
            "--output-format",
            "stream-json",
            "--verbose",
            "--dangerously-skip-permissions",
        ];
        if continue_session {
            args.push("--continue");
        }
        if let Some(mode) = permission_mode.filter(|mode| !mode.is_empty()) {
            args.push("--permission-mode");
            args.push(mode);
        }
        cmd.args(&args);

        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());
        cmd
    }

    fn env_vars(&self) -> Vec<(&str, &str)> {
        // Disable interactive prompts
        vec![("CLAUDE_CODE_NON_INTERACTIVE", "1")]
    }
}
