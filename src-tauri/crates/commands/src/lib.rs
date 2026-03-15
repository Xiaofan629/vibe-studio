mod agent;
mod claude_history;
mod editor;
mod git;
mod project;
mod review;
mod session;
mod terminal;
mod workspace;

use vibe_studio_agent::process::AgentProcessManager;
use vibe_studio_db::DbService;
use vibe_studio_review::ReviewService;
use vibe_studio_terminal::manager::TerminalManager;

pub struct AppState {
    pub db: DbService,
    pub agent_manager: AgentProcessManager,
    pub review: ReviewService,
    pub terminal_manager: TerminalManager,
}

pub use agent::*;
pub use claude_history::*;
pub use editor::*;
pub use git::*;
pub use project::*;
pub use review::*;
pub use session::*;
pub use terminal::*;
pub use workspace::*;
