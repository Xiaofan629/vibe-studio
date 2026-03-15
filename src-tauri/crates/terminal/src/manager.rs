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

        // Determine the shell
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

        let mut cmd = CommandBuilder::new(&shell);
        cmd.cwd(cwd);

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
