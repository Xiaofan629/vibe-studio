use super::AgentAdapter;
use crate::command;
use std::path::Path;
use tokio::process::Command;

/// OpenAI Codex CLI adapter
///
/// Uses `codex exec --json <prompt>` for non-interactive structured output.
/// When continuing, resumes the most recent session via `codex exec resume --last`.
pub struct CodexAdapter;

impl AgentAdapter for CodexAdapter {
    fn build_command(
        &self,
        working_dir: &Path,
        prompt: &str,
        continue_session: bool,
        _permission_mode: Option<&str>,
    ) -> Command {
        let mut cmd = command::new_tokio_command("codex");
        cmd.current_dir(working_dir);
        let requires_skip_repo_check = !working_dir.join(".git").exists();

        if continue_session {
            cmd.args(["exec", "resume", "--last"]);
        } else {
            cmd.arg("exec");
        }

        if requires_skip_repo_check {
            cmd.arg("--skip-git-repo-check");
        }

        cmd.arg("--dangerously-bypass-approvals-and-sandbox");
        cmd.args(["--json", prompt]);

        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());
        cmd
    }
}
