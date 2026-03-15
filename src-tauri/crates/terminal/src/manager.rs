use crate::{Result, TerminalError};
use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

pub struct TerminalManager {
    terminals: Arc<Mutex<HashMap<String, TerminalInstance>>>,
}

struct TerminalInstance {
    input_tx: mpsc::UnboundedSender<Vec<u8>>,
    _pty_pair: PtyPair,
    _read_task: tokio::task::JoinHandle<()>,
    _write_task: tokio::task::JoinHandle<()>,
}

fn resolve_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|shell| !shell.trim().is_empty())
        .unwrap_or_else(|| "/bin/zsh".to_string())
}

fn configure_shell_launch(cmd: &mut CommandBuilder, shell: &str) {
    let shell_name = Path::new(shell)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();

    match shell_name {
        // Finder-launched macOS apps don't inherit the user's PATH, so we
        // start common shells as login + interactive shells to load ~/.zprofile
        // before ~/.zshrc and recover Homebrew-managed prompt tooling.
        "bash" | "sh" | "zsh" => cmd.arg("-il"),
        "fish" => {
            cmd.arg("--interactive");
            cmd.arg("--login");
        }
        _ => {}
    }
}

fn apply_terminal_defaults(cmd: &mut CommandBuilder) {
    let term = cmd.get_env("TERM");
    if term.is_none() || term == Some("dumb".as_ref()) {
        cmd.env("TERM", "xterm-256color");
    }
    if cmd.get_env("COLORTERM").is_none() {
        cmd.env("COLORTERM", "truecolor");
    }
    if cmd.get_env("TERM_PROGRAM").is_none() {
        cmd.env("TERM_PROGRAM", "vibe-studio");
    }
    if cmd.get_env("LANG").is_none()
        && cmd.get_env("LC_ALL").is_none()
        && cmd.get_env("LC_CTYPE").is_none()
    {
        cmd.env("LANG", "en_US.UTF-8");
        cmd.env("LC_CTYPE", "en_US.UTF-8");
    }
}

fn build_shell_command(shell: &str, cwd: &Path) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(shell);
    cmd.cwd(cwd);
    configure_shell_launch(&mut cmd, shell);
    apply_terminal_defaults(&mut cmd);

    cmd
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            terminals: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Create a new terminal with PTY, returning a receiver for output data
    pub async fn create(
        &self,
        id: &str,
        cwd: &Path,
        cols: u16,
        rows: u16,
    ) -> Result<mpsc::UnboundedReceiver<Vec<u8>>> {
        let pty_system = native_pty_system();

        let pty_pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| TerminalError::Pty(e.to_string()))?;

        let shell = resolve_shell();
        let cmd = build_shell_command(&shell, cwd);

        // Spawn the shell process in the PTY
        let _child = pty_pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| TerminalError::Pty(e.to_string()))?;

        let writer = pty_pair
            .master
            .take_writer()
            .map_err(|e| TerminalError::Pty(e.to_string()))?;

        let mut reader = pty_pair
            .master
            .try_clone_reader()
            .map_err(|e| TerminalError::Pty(e.to_string()))?;

        // Channel for streaming PTY output to frontend
        let (tx, rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (input_tx, mut input_rx) = mpsc::unbounded_channel::<Vec<u8>>();

        // Spawn a blocking task to read from PTY
        let read_task = tokio::task::spawn_blocking(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        let write_task = tokio::task::spawn_blocking(move || {
            let mut writer = writer;
            while let Some(data) = input_rx.blocking_recv() {
                if writer.write_all(&data).is_err() {
                    break;
                }

                if writer.flush().is_err() {
                    break;
                }
            }
        });

        let instance = TerminalInstance {
            input_tx,
            _pty_pair: pty_pair,
            _read_task: read_task,
            _write_task: write_task,
        };

        let mut terms = self.terminals.lock().await;
        terms.insert(id.to_string(), instance);

        Ok(rx)
    }

    /// Write data (user keystrokes) to a terminal
    pub async fn write(&self, id: &str, data: &[u8]) -> Result<()> {
        let input_tx = {
            let terms = self.terminals.lock().await;
            let instance = terms
                .get(id)
                .ok_or_else(|| TerminalError::NotFound(id.to_string()))?;
            instance.input_tx.clone()
        };

        input_tx
            .send(data.to_vec())
            .map_err(|_| TerminalError::Pty("terminal input queue closed".to_string()))?;
        Ok(())
    }

    /// Resize a terminal
    pub async fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        let terms = self.terminals.lock().await;
        let instance = terms
            .get(id)
            .ok_or_else(|| TerminalError::NotFound(id.to_string()))?;
        instance
            ._pty_pair
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| TerminalError::Pty(e.to_string()))?;
        Ok(())
    }

    /// Close a terminal (but keep it in memory for reuse)
    pub async fn close(&self, _id: &str) -> Result<()> {
        // Don't actually remove the terminal, just mark it as inactive
        // This allows the terminal session to persist
        Ok(())
    }

    /// Change working directory for a terminal
    pub async fn change_directory(&self, id: &str, path: &Path) -> Result<()> {
        let cd_command = format!("cd '{}'\r", path.display());
        self.write(id, cd_command.as_bytes()).await
    }

    /// Completely destroy a terminal session
    pub async fn destroy(&self, id: &str) -> Result<()> {
        let mut terms = self.terminals.lock().await;
        terms.remove(id);
        Ok(())
    }
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::{apply_terminal_defaults, build_shell_command, configure_shell_launch};
    use portable_pty::CommandBuilder;
    use std::path::Path;

    #[test]
    fn zsh_shells_are_started_as_login_interactive() {
        let cmd = build_shell_command("/bin/zsh", Path::new("/tmp"));
        let argv: Vec<_> = cmd
            .get_argv()
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();

        assert_eq!(argv, vec!["/bin/zsh".to_string(), "-il".to_string()]);
    }

    #[test]
    fn terminal_defaults_enable_utf8_and_color() {
        let mut cmd = CommandBuilder::new("/bin/zsh");
        cmd.env_clear();
        configure_shell_launch(&mut cmd, "/bin/zsh");
        apply_terminal_defaults(&mut cmd);

        assert_eq!(cmd.get_env("TERM"), Some("xterm-256color".as_ref()));
        assert_eq!(cmd.get_env("COLORTERM"), Some("truecolor".as_ref()));
        assert_eq!(cmd.get_env("TERM_PROGRAM"), Some("vibe-studio".as_ref()));
        assert_eq!(cmd.get_env("LANG"), Some("en_US.UTF-8".as_ref()));
        assert_eq!(cmd.get_env("LC_CTYPE"), Some("en_US.UTF-8".as_ref()));
    }
}
