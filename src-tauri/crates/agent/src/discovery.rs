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
    match crate::command::resolve_command_path(cmd) {
        Some(path) => {
            let mut version_command = std::process::Command::new(&path);
            crate::command::apply_augmented_path_std_command(&mut version_command);
            let version = version_command
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
        None => (false, None, None),
    }
}
