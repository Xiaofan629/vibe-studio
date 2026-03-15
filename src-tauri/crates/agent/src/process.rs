use crate::adapters;
use crate::{AgentLogEntry, AgentType, Result};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;
use tokio::sync::{mpsc, Mutex};

pub struct AgentProcessManager {
    processes: Arc<Mutex<HashMap<String, RunningAgent>>>,
}

struct RunningAgent {
    child: Child,
    agent_type: AgentType,
    output_tx: mpsc::UnboundedSender<AgentLogEntry>,
    pid: Option<u32>,
}

impl AgentProcessManager {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn start_agent(
        &self,
        process_id: &str,
        agent_type: AgentType,
        working_dir: &Path,
        prompt: &str,
        continue_session: bool,
        output_tx: mpsc::UnboundedSender<AgentLogEntry>,
    ) -> Result<()> {
        let adapter = adapters::create_adapter(agent_type);
        let mut cmd = adapter.build_command(working_dir, prompt, continue_session);

        #[cfg(unix)]
        cmd.process_group(0);

        // Apply adapter-specific environment variables
        for (key, value) in adapter.env_vars() {
            cmd.env(key, value);
        }

        let mut child = cmd.spawn()?;
        let pid = child.id();

        // Stream stdout through parser
        let stdout = child.stdout.take();
        if let Some(stdout) = stdout {
            let agent_type_clone = agent_type;
            let tx = output_tx.clone();
            tokio::spawn(async move {
                let reader = BufReader::new(stdout);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let entries = crate::parsers::parse_output(agent_type_clone, &line);
                    for entry in entries {
                        let _ = tx.send(entry);
                    }
                }
            });
        }

        // Stream stderr as error entries
        let stderr = child.stderr.take();
        if let Some(stderr) = stderr {
            let tx = output_tx.clone();
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if !line.trim().is_empty() {
                        let _ = tx.send(AgentLogEntry {
                            entry_type: crate::AgentLogEntryType::Error,
                            content: line,
                            tool_name: None,
                            file_path: None,
                            timestamp: chrono::Utc::now().to_rfc3339(),
                        });
                    }
                }
            });
        }

        let mut procs = self.processes.lock().await;
        procs.insert(
            process_id.to_string(),
            RunningAgent {
                child,
                agent_type,
                output_tx,
                pid,
            },
        );

        // Monitor process exit and close channel
        let pid = process_id.to_string();
        let procs = self.processes.clone();
        tokio::spawn(async move {
            let agent_to_wait = {
                let mut procs_lock = procs.lock().await;
                procs_lock.remove(&pid)
            };

            if let Some(mut agent) = agent_to_wait {
                let _ = agent.child.wait().await;
                // Channel will be closed when output_tx is dropped
                drop(agent.output_tx);
            }
        });

        Ok(())
    }

    pub async fn stop_agent(&self, process_id: &str) -> Result<()> {
        let mut procs = self.processes.lock().await;
        if let Some(mut agent) = procs.remove(process_id) {
            #[cfg(unix)]
            if let Some(pid) = agent.pid {
                unsafe {
                    libc::killpg(pid as i32, libc::SIGKILL);
                }
            }
            let _ = agent.child.kill().await;
            // Channel will be closed when output_tx is dropped
            drop(agent.output_tx);
        }
        Ok(())
    }

    pub async fn is_running(&self, process_id: &str) -> bool {
        let procs = self.processes.lock().await;
        procs.contains_key(process_id)
    }
}

impl Default for AgentProcessManager {
    fn default() -> Self {
        Self::new()
    }
}
