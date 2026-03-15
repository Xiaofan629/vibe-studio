use crate::{AgentInfo, AgentType};

pub fn discover_agents() -> Vec<AgentInfo> {
    let agents = [AgentType::ClaudeCode, AgentType::Gemini, AgentType::Codex];

    agents
        .iter()
        .map(|agent_type| {
            let cmd = agent_type.cli_command();
            let (available, version, path) = check_agent_availability(cmd);
            AgentInfo {
                agent_type: *agent_type,
                name: agent_type.display_name().to_string(),
                available,
                version,
                path,
            }
        })
        .collect()
}

fn check_agent_availability(cmd: &str) -> (bool, Option<String>, Option<String>) {
    match which::which(cmd) {
        Ok(path) => {
            let version = std::process::Command::new(cmd)
                .arg("--version")
                .output()
                .ok()
                .and_then(|o| {
                    if o.status.success() {
                        Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                    } else {
                        None
                    }
                });
            (true, version, Some(path.to_string_lossy().to_string()))
        }
        Err(_) => (false, None, None),
    }
}
