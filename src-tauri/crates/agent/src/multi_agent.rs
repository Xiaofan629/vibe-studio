use crate::AgentProcessStatus;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub status: AgentProcessStatus,
    pub prompt: Option<String>,
    pub depth: u32,
    pub started_at: String,
    pub completed_at: Option<String>,
}

pub struct MultiAgentTracker {
    agents: HashMap<String, AgentNode>,
    root_id: Option<String>,
}

impl MultiAgentTracker {
    pub fn new() -> Self {
        Self {
            agents: HashMap::new(),
            root_id: None,
        }
    }

    pub fn set_root(&mut self, id: String, node: AgentNode) {
        self.root_id = Some(id.clone());
        self.agents.insert(id, node);
    }

    pub fn add_child(&mut self, id: String, node: AgentNode) {
        self.agents.insert(id, node);
    }

    pub fn update_status(&mut self, id: &str, status: AgentProcessStatus) {
        if let Some(agent) = self.agents.get_mut(id) {
            agent.status = status;
            agent.completed_at = Some(chrono::Utc::now().to_rfc3339());
        }
    }

    pub fn get_tree(&self) -> Vec<AgentNode> {
        self.agents.values().cloned().collect()
    }

    pub fn get_root_id(&self) -> Option<&String> {
        self.root_id.as_ref()
    }
}

impl Default for MultiAgentTracker {
    fn default() -> Self {
        Self::new()
    }
}
